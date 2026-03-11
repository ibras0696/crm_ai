from __future__ import annotations

import uuid
from contextlib import suppress
from hashlib import sha256
from typing import TYPE_CHECKING

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import SQLAlchemyError

from src.common.enums import AuditAction
from src.common.optimistic_lock import optimistic_lock_matches
from src.config import settings
from src.infrastructure.metrics_custom import DOCS_TEXT_SAVES_TOTAL
from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER
from src.modules.docs.document_render import render_document_bytes
from src.modules.docs.domain import FileStatus, FileType
from src.modules.docs.errors import DocsModuleError, InvalidTypeError, QuotaExceededError
from src.modules.docs.models import FileVersion
from src.modules.docs.rate_limit import DEFAULT_DOCS_TEXT_SAVE_RATE_LIMITER
from src.modules.docs.service_parts.base import FinishUploadResult, _inc_upload_metric, _inc_version_metric, logger
from src.modules.docs.storage import DEFAULT_BUCKET
from src.modules.docs.tasks import docs_delete_file_background
from src.modules.files.models import File

if TYPE_CHECKING:
    from datetime import datetime


class DocsFilesMixin:
    async def delete_file(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> None:
        _ = user_id
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)

        if file_obj.status == FileStatus.DELETED.value:
            return

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        if file_obj.status in {FileStatus.UPLOADING.value, FileStatus.DRAFT.value}:
            usage.reserved_bytes = max(0, int(usage.reserved_bytes) - int(file_obj.size or 0))
        elif file_obj.status in {FileStatus.READY.value, FileStatus.BLOCKED.value, FileStatus.SCANNING.value}:
            usage.used_bytes = max(0, int(usage.used_bytes) - int(file_obj.size or 0))

        file_obj.status = FileStatus.DELETED.value
        await self.repo.update_file(file_obj)
        await self.repo.update_storage_usage(usage)

        try:
            ai_jobs = await self.repo.list_ai_jobs_by_file(file_id=file_id)
            for job in ai_jobs:
                if job.status in {"queued", "running", "scanning"}:
                    job.status = "failed"
                    job.error_message = "Файл был удален пользователем во время генерации"
                    await self.repo.update_ai_generation_job(job)
        except SQLAlchemyError:
            logger.exception("docs_delete_file_ai_cleanup_failed", extra={"file_id": str(file_id)})

        with suppress(Exception):
            docs_delete_file_background.delay(str(file_id))

    async def init_upload(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        filename: str,
        content_type: str,
        size_bytes: int,
        folder_id: uuid.UUID | None,
        title: str | None,
        expires_in: int = 900,
    ) -> dict:
        self._validate_upload_size(size_bytes)
        file_type = self._resolve_file_type(filename=filename, content_type=content_type)

        if folder_id is not None:
            folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
            if folder is None:
                raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Папка не найдена", status_code=404)

        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        projected = int(usage.used_bytes) + int(usage.reserved_bytes) + int(size_bytes)
        if limit_bytes > 0 and projected > limit_bytes:
            raise QuotaExceededError("Достигнут лимит тарифа по хранилищу.")

        file_id = uuid.uuid4()
        version_id = uuid.uuid4()
        key = self.storage.build_version_key(org_id=org_id, file_id=file_id, version_id=version_id)
        safe_title = title or self._default_title_from_filename(filename)

        file_obj = File(
            id=file_id,
            org_id=org_id,
            uploaded_by=user_id,
            filename=filename,
            original_name=filename,
            content_type=content_type,
            size=int(size_bytes),
            s3_key=key,
            s3_bucket=DEFAULT_BUCKET,
            folder_id=folder_id,
            type=file_type.value,
            status=FileStatus.UPLOADING.value,
            title=safe_title,
            current_version_id=None,
        )
        await self.repo.create_file(file_obj)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "upload_started",
                "filename": filename,
                "content_type": content_type,
                "size_bytes": int(size_bytes),
            },
        )

        usage.reserved_bytes = int(usage.reserved_bytes) + int(size_bytes)
        await self.repo.update_storage_usage(usage)
        _inc_upload_metric("uploading")

        try:
            upload_url, upload_headers = self.storage.generate_presigned_put_url(
                bucket=DEFAULT_BUCKET,
                key=key,
                content_type=content_type,
                expires_in=expires_in,
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_URL_ERROR",
                message="Не удалось сформировать ссылку на загрузку файла",
            ) from exc
        return {
            "file_id": file_id,
            "upload_url": upload_url,
            "upload_headers": upload_headers,
            "expires_in": int(expires_in),
        }

    async def finish_upload(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        size_bytes: int,
        sha256: str | None,
    ) -> FinishUploadResult:
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)
        if file_obj.status != FileStatus.UPLOADING.value:
            raise DocsModuleError(code="INVALID_STATUS", message="Файл не находится в статусе загрузки")

        if int(size_bytes) != int(file_obj.size):
            raise DocsModuleError(
                code="UPLOAD_SIZE_MISMATCH",
                message="Размер при завершении загрузки не совпадает с init-upload.",
            )

        version_id = self._extract_version_id_from_key(file_obj.s3_key)
        version = FileVersion(
            id=version_id,
            file_id=file_obj.id,
            s3_key=file_obj.s3_key,
            s3_bucket=file_obj.s3_bucket,
            size_bytes=int(size_bytes),
            sha256=sha256,
            mime=file_obj.content_type,
            created_by=user_id,
        )
        await self.repo.create_file_version(version)

        file_obj.current_version_id = version.id
        file_obj.status = FileStatus.SCANNING.value
        file_obj.size = int(size_bytes)
        await self.repo.update_file(file_obj)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "upload_finished",
                "version_id": str(version.id),
                "status": file_obj.status,
            },
        )
        _inc_upload_metric("scanning")
        return FinishUploadResult(file=file_obj, version_id=version.id)

    async def abort_upload(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> File:
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)
        if file_obj.status != FileStatus.UPLOADING.value:
            raise DocsModuleError(
                code="INVALID_STATUS",
                message="Отменить можно только файл в статусе UPLOADING",
            )

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        file_size = int(file_obj.size or 0)
        usage.reserved_bytes = max(0, int(usage.reserved_bytes) - file_size)
        await self.repo.update_storage_usage(usage)

        file_obj.status = FileStatus.DELETED.value
        await self.repo.update_file(file_obj)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.DELETE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "upload_aborted",
                "released_reserved_bytes": file_size,
            },
        )
        _inc_upload_metric("aborted")
        return file_obj

    async def move_file(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        folder_id: uuid.UUID | None,
    ) -> File:
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)

        if folder_id is not None:
            folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
            if folder is None:
                raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Папка не найдена", status_code=404)

        if file_obj.folder_id == folder_id:
            return file_obj

        previous_folder_id = file_obj.folder_id
        file_obj.folder_id = folder_id
        await self.repo.update_file(file_obj)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "file_moved",
                "from_folder_id": str(previous_folder_id) if previous_folder_id else None,
                "to_folder_id": str(folder_id) if folder_id else None,
            },
        )
        return file_obj

    async def create_empty_file(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_type: str,
        folder_id: uuid.UUID | None,
        title: str | None,
    ) -> File:
        normalized_type = self._resolve_generated_file_type(file_type)
        if folder_id is not None:
            folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
            if folder is None:
                raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Папка не найдена", status_code=404)

        safe_title = (str(title or "").strip() or "Новый документ")[:500]
        payload, content_type, extension = render_document_bytes(
            file_type=normalized_type,
            text="",
            title=safe_title,
        )
        size_bytes = len(payload)
        self._validate_upload_size(size_bytes)

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        projected = int(usage.used_bytes) + int(usage.reserved_bytes) + int(size_bytes)
        if limit_bytes > 0 and projected > limit_bytes:
            raise QuotaExceededError("Недостаточно свободного места для создания документа.")

        file_id = uuid.uuid4()
        version_id = uuid.uuid4()
        key = self.storage.build_version_key(org_id=org_id, file_id=file_id, version_id=version_id)
        filename = self._build_filename_by_type(title=safe_title, extension=extension)

        try:
            self.storage.put_object_bytes(
                bucket=DEFAULT_BUCKET,
                key=key,
                payload=payload,
                content_type=content_type,
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_WRITE_ERROR",
                message="Не удалось создать файл в хранилище",
            ) from exc

        file_obj = File(
            id=file_id,
            org_id=org_id,
            uploaded_by=user_id,
            filename=filename,
            original_name=filename,
            content_type=content_type,
            size=int(size_bytes),
            s3_key=key,
            s3_bucket=DEFAULT_BUCKET,
            folder_id=folder_id,
            type=normalized_type.value,
            status=FileStatus.READY.value,
            title=safe_title,
            current_version_id=None,
        )
        await self.repo.create_file(file_obj)

        version = FileVersion(
            id=version_id,
            file_id=file_obj.id,
            s3_key=key,
            s3_bucket=DEFAULT_BUCKET,
            size_bytes=int(size_bytes),
            sha256=sha256(payload).hexdigest(),
            mime=content_type,
            meta_json={"source": "create_empty"},
            created_by=user_id,
        )
        await self.repo.create_file_version(version)
        file_obj.current_version_id = version.id
        await self.repo.update_file(file_obj)

        usage.used_bytes = int(usage.used_bytes) + int(size_bytes)
        await self.repo.update_storage_usage(usage)

        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "empty_file_created",
                "file_type": normalized_type.value,
                "folder_id": str(folder_id) if folder_id else None,
                "size_bytes": int(size_bytes),
            },
        )
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_file_version",
            entity_id=str(version.id),
            meta={
                "event": "version_created",
                "source": "create_empty",
                "file_id": str(file_obj.id),
                "size_bytes": int(size_bytes),
            },
        )
        _inc_version_metric("create_empty")
        return file_obj

    async def save_text(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        content: str,
        title: str | None,
        expected_updated_at: datetime,
    ) -> File:
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if not optimistic_lock_matches(current=file_obj.updated_at, expected=expected_updated_at):
            raise DocsModuleError(
                code="CONFLICT",
                message="Файл уже изменён другим сотрудником. Обновите данные и повторите сохранение.",
                status_code=409,
            )
        if file_obj.type != FileType.TXT.value:
            raise InvalidTypeError("Сохранение текста доступно только для TXT-файлов")
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для редактирования")

        current_version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if current_version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        normalized_content = str(content or "")
        payload = normalized_content.encode("utf-8")
        self._validate_upload_size(len(payload))

        await DEFAULT_DOCS_TEXT_SAVE_RATE_LIMITER.check(
            org_id=org_id,
            user_id=user_id,
            rpm_limit=int(getattr(settings, "DOCS_TEXT_SAVE_RPM", 20) or 20),
        )

        version_id = uuid.uuid4()
        key = self.storage.build_version_key(org_id=org_id, file_id=file_obj.id, version_id=version_id)
        try:
            self.storage.put_object_bytes(
                bucket=current_version.s3_bucket,
                key=key,
                payload=payload,
                content_type="text/plain",
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_WRITE_ERROR",
                message="Не удалось сохранить текстовую версию файла",
            ) from exc

        replaced_ready_size = int(current_version.size_bytes or file_obj.size or 0)
        version = FileVersion(
            id=version_id,
            file_id=file_obj.id,
            s3_key=key,
            s3_bucket=current_version.s3_bucket,
            size_bytes=int(len(payload)),
            sha256=sha256(payload).hexdigest(),
            mime="text/plain",
            meta_json={"source": "save_text", "replaced_ready_size": replaced_ready_size},
            created_by=user_id,
        )
        await self.repo.create_file_version(version)

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        usage.used_bytes = max(0, int(usage.used_bytes) + int(len(payload)) - replaced_ready_size)
        await self.repo.update_storage_usage(usage)

        if title is not None:
            file_obj.title = title
        file_obj.current_version_id = version.id
        file_obj.s3_key = key
        file_obj.s3_bucket = current_version.s3_bucket
        file_obj.content_type = "text/plain"
        file_obj.size = int(len(payload))
        file_obj.status = FileStatus.READY.value
        await self.repo.update_file(file_obj)

        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_file_version",
            entity_id=str(version.id),
            meta={
                "event": "version_created",
                "source": "save_text",
                "file_id": str(file_obj.id),
                "size_bytes": int(len(payload)),
            },
        )
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "text_saved",
                "version_id": str(version.id),
                "size_bytes": int(len(payload)),
            },
        )
        with suppress(Exception):
            DOCS_TEXT_SAVES_TOTAL.labels(status="ok").inc()
        _inc_version_metric("save_text")
        return file_obj

    async def get_text_content(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, str]:
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.TXT.value:
            raise InvalidTypeError("Чтение текста доступно только для TXT-файлов")
        if file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        try:
            payload = self.storage.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(code="STORAGE_READ_ERROR", message="Не удалось прочитать файл из хранилища") from exc

        try:
            content = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise DocsModuleError(code="INVALID_TEXT_ENCODING", message="Файл содержит невалидный UTF-8 текст") from exc
        return {"content": content}

    async def list_versions(self, *, org_id: uuid.UUID, file_id: uuid.UUID, limit: int = 50) -> list[FileVersion]:
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        return await self.repo.list_file_versions(file_id=file_obj.id, limit=limit)

    async def build_download(
        self,
        *,
        org_id: uuid.UUID,
        file_id: uuid.UUID,
        expires_in: int = 900,
    ) -> dict[str, object]:
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для скачивания")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        try:
            url = self.storage.generate_presigned_get_url(
                bucket=version.s3_bucket,
                key=version.s3_key,
                expires_in=expires_in,
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_URL_ERROR",
                message="Не удалось сформировать ссылку на скачивание",
            ) from exc
        return {"url": url, "expires_in": int(expires_in)}

    async def export_pdf(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, object]:
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.status != FileStatus.READY.value:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для экспорта")
        if file_obj.type == FileType.PDF.value:
            return await self.build_download(org_id=org_id, file_id=file_id)

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        try:
            payload = self.storage.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(code="STORAGE_READ_ERROR", message="Не удалось прочитать файл из хранилища") from exc

        pdf_bytes = b""
        if file_obj.type == FileType.TXT.value:
            try:
                text = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise DocsModuleError(
                    code="INVALID_TEXT_ENCODING", message="TXT файл содержит невалидный UTF-8"
                ) from exc
            pdf_bytes, _, _ = render_document_bytes(
                file_type=FileType.PDF,
                text=text,
                title=file_obj.title or file_obj.original_name,
            )
        elif file_obj.type == FileType.DOCX.value:
            DEFAULT_DOC_EDITOR_PROVIDER.ensure_configured()
            download_url_info = await self.build_download(org_id=org_id, file_id=file_id)
            try:
                pdf_bytes = await DEFAULT_DOC_EDITOR_PROVIDER.convert_to_pdf(
                    file_url=str(download_url_info["url"]), file_type="docx"
                )
            except DocsModuleError:
                raise
            except (httpx.HTTPError, RuntimeError, TypeError, ValueError) as exc:
                raise DocsModuleError(
                    code="ONLYOFFICE_CONVERT_ERROR", message=f"Ошибка конвертации DOCX: {exc}"
                ) from exc
        else:
            raise DocsModuleError(code="UNSUPPORTED_TYPE", message="Данный тип файла не поддерживает экспорт в PDF")

        export_key = f"exports/{org_id}/{file_id}/{uuid.uuid4()}.pdf"
        try:
            self.storage.put_object_bytes(
                bucket=DEFAULT_BUCKET,
                key=export_key,
                payload=pdf_bytes,
                content_type="application/pdf",
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_WRITE_ERROR", message="Не удалось сохранить экспортированный PDF"
            ) from exc

        try:
            url = self.storage.generate_presigned_get_url(
                bucket=DEFAULT_BUCKET, key=export_key, expires_in=3600, filename=f"{file_obj.title or 'Документ'}.pdf"
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
            raise DocsModuleError(
                code="STORAGE_URL_ERROR", message="Не удалось сформировать ссылку для экспортированного PDF"
            ) from exc

        return {"url": url, "expires_in": 3600, "filename": f"{file_obj.title or 'Документ'}.pdf"}
