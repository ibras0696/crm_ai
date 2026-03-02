"""Сервисный слой модуля Docs (folders/tree/upload/download/usage)."""

from __future__ import annotations

import os
import uuid
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from typing import TYPE_CHECKING

import httpx

from src.common.enums import AuditAction
from src.config import settings
from src.infrastructure.metrics_custom import (
    DOCS_AI_GENERATE_TOTAL,
    DOCS_TEXT_SAVES_TOTAL,
    DOCS_VERSIONS_CREATED_TOTAL,
    UPLOADS_TOTAL,
)
from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.limits import check_ai_limits, is_org_ai_enabled
from src.modules.ai.service import estimate_tokens
from src.modules.audit.repository import AuditRepository
from src.modules.docs.ai_generator import DEFAULT_AI_DOCUMENT_GENERATOR
from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER, OnlyOfficeOpenDocxResult
from src.modules.docs.document_render import render_document_bytes
from src.modules.docs.domain import MAX_FOLDER_DEPTH, FileStatus, FileType
from src.modules.docs.errors import (
    DocsModuleError,
    InvalidDepthError,
    InvalidTypeError,
    QuotaExceededError,
)
from src.modules.docs.models import DocsAIGenerationJob, FileVersion, Folder, OrgStorageUsage
from src.modules.docs.repository import DocsRepository
from src.modules.docs.storage import DEFAULT_BUCKET, DEFAULT_STORAGE_PROVIDER, StorageProvider
from src.modules.files.models import File

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class FinishUploadResult:
    """Результат завершения upload-пайплайна."""

    file: File
    version_id: uuid.UUID


@dataclass(slots=True)
class SaveTextResult:
    """Результат сохранения текста TXT-файла."""

    file: File
    version: FileVersion


@dataclass(slots=True)
class PdfSignRequestResult:
    """Результат постановки подписи PDF в очередь."""

    file: File
    source_version_id: uuid.UUID


@dataclass(slots=True)
class OpenDocxResult:
    """Результат открытия DOCX-редактора."""

    file: File
    document_server_url: str
    config: dict
    token: str | None


@dataclass(slots=True)
class AIGenerateRequestResult:
    """Результат постановки AI-задачи генерации документа."""

    job: DocsAIGenerationJob
    file: File
    estimated_request_tokens: int


def _inc_upload_metric(status: str) -> None:
    """Безопасно инкрементировать метрику docs upload pipeline."""
    with suppress(Exception):
        UPLOADS_TOTAL.labels(status=status).inc()


def _inc_text_save_metric(status: str) -> None:
    """Безопасно инкрементировать метрику сохранения TXT."""
    with suppress(Exception):
        DOCS_TEXT_SAVES_TOTAL.labels(status=status).inc()


def _inc_version_metric(source: str) -> None:
    """Безопасно инкрементировать метрику создания версии файла."""
    with suppress(Exception):
        DOCS_VERSIONS_CREATED_TOTAL.labels(source=source).inc()


def _inc_ai_generate_metric(status: str, file_type: str) -> None:
    """Безопасно инкрементировать метрику AI-генерации документов."""
    with suppress(Exception):
        DOCS_AI_GENERATE_TOTAL.labels(status=status, file_type=file_type).inc()


class DocsService:
    """Application service для модуля документов."""

    ALLOWED_CONTENT_TYPES: dict[str, FileType] = {
        "text/plain": FileType.TXT,
        "application/pdf": FileType.PDF,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileType.DOCX,
    }
    ALLOWED_EXTENSIONS: dict[str, FileType] = {
        ".txt": FileType.TXT,
        ".pdf": FileType.PDF,
        ".docx": FileType.DOCX,
    }

    def __init__(self, session: AsyncSession, *, storage_provider: StorageProvider = DEFAULT_STORAGE_PROVIDER):
        self.session = session
        self.repo = DocsRepository(session)
        self.audit_repo = AuditRepository(session)
        self.storage = storage_provider

    async def list_tree(self, *, org_id: uuid.UUID) -> tuple[list[Folder], list[File]]:
        """Получить дерево docs: папки и файлы."""
        folders = await self.repo.list_folders(org_id=org_id)
        files = await self.repo.list_doc_files(org_id=org_id)
        return folders, files

    async def create_folder(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        name: str,
        parent_id: uuid.UUID | None,
    ) -> Folder:
        """Создать папку документов."""
        validated_parent_id = await self._validate_parent_folder(
            org_id=org_id,
            parent_id=parent_id,
            current_folder_id=None,
        )
        max_pos = await self.repo.get_max_folder_position(org_id=org_id)
        folder = Folder(
            org_id=org_id,
            created_by=user_id,
            parent_id=validated_parent_id,
            name=name,
            position=max_pos + 1,
        )
        return await self.repo.create_folder(folder)

    async def update_folder(
        self,
        *,
        org_id: uuid.UUID,
        folder_id: uuid.UUID,
        updates: dict,
    ) -> Folder:
        """Обновить папку документов."""
        folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
        if folder is None:
            raise DocsModuleError(code="NOT_FOUND", message="Папка не найдена", status_code=404)

        if "name" in updates:
            folder.name = updates.get("name")
        if "position" in updates:
            folder.position = int(updates.get("position"))
        if "parent_id" in updates:
            folder.parent_id = await self._validate_parent_folder(
                org_id=org_id,
                parent_id=updates.get("parent_id"),
                current_folder_id=folder.id,
            )
        return await self.repo.update_folder(folder)

        await self.repo.delete_folder(folder)

    async def delete_file(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> None:
        """Пометить файл как удаленный и запустить фоновую очистку в S3."""
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)

        if file_obj.status == FileStatus.DELETED.value:
            return  # Уже удален

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        if file_obj.status == FileStatus.UPLOADING.value or file_obj.status == FileStatus.DRAFT.value:
            usage.reserved_bytes = max(0, int(usage.reserved_bytes) - int(file_obj.size or 0))
        elif file_obj.status in (FileStatus.READY.value, FileStatus.BLOCKED.value, FileStatus.SCANNING.value):
            usage.used_bytes = max(0, int(usage.used_bytes) - int(file_obj.size or 0))

        file_obj.status = FileStatus.DELETED.value
        await self.repo.update_file(file_obj)
        await self.repo.update_storage_usage(usage)

        from src.modules.docs.tasks import docs_delete_file_background
        try:
            docs_delete_file_background.delay(str(file_id))
        except Exception:
            pass

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
        """Инициализировать загрузку файла и зарезервировать место по квоте."""
        file_type = self._resolve_file_type(filename=filename, content_type=content_type)
        if file_type == FileType.PDF:
            raise DocsModuleError(
                code="UNSUPPORTED_TYPE",
                message="Загрузка PDF-файлов запрещена",
                status_code=400,
            )
        self._validate_upload_size(size_bytes)

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

        upload_url, upload_headers = self.storage.generate_presigned_put_url(
            bucket=DEFAULT_BUCKET,
            key=key,
            content_type=content_type,
            expires_in=expires_in,
        )
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
        """Завершить загрузку: создать версию и перевести файл в статус SCANNING."""
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
        """Прервать незавершенную загрузку и освободить резерв квоты."""
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
        """Переместить файл в другую папку или в корень."""
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
        """Создать пустой TXT/PDF/DOCX документ как READY-файл с версией v1."""
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
        except Exception as exc:
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
            # Версия создается отдельной записью ниже, поэтому FK ставим после insert версии.
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

    async def get_file(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> File:
        """Получить файл Docs по id."""
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)
        return file_obj

    async def list_versions(self, *, org_id: uuid.UUID, file_id: uuid.UUID, limit: int = 50) -> list[FileVersion]:
        """Получить историю версий Docs-файла (новые -> старые)."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        return await self.repo.list_file_versions(file_id=file_obj.id, limit=limit)

    async def get_text_content(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, object]:
        """Прочитать актуальный текст TXT-файла для встроенного редактора."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.TXT.value:
            raise InvalidTypeError("Текстовый редактор доступен только для TXT-файлов")
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для редактирования")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        try:
            payload = self.storage.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
        except Exception as exc:
            raise DocsModuleError(code="STORAGE_READ_ERROR", message="Не удалось прочитать файл из хранилища") from exc

        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise DocsModuleError(
                code="TEXT_DECODE_ERROR",
                message="Текущая версия TXT не может быть прочитана",
            ) from exc

        return {
            "file_id": file_obj.id,
            "version_id": version.id,
            "content": text,
            "size_bytes": int(version.size_bytes),
            "updated_at": file_obj.updated_at,
        }

    async def save_text(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        content: str,
        title: str | None,
    ) -> SaveTextResult:
        """Сохранить TXT как новую версию с инкрементальным учетом usage."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.TXT.value:
            raise InvalidTypeError("Сохранение текста поддерживается только для TXT-файлов")
        if file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="У файла отсутствует текущая версия")
        if file_obj.status not in {FileStatus.READY.value, FileStatus.BLOCKED.value}:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл сейчас нельзя редактировать")

        current_version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if current_version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        payload = str(content or "").encode("utf-8")
        new_size = len(payload)
        self._validate_upload_size(new_size)
        old_size = int(file_obj.size or current_version.size_bytes or 0)
        counted_old = old_size if file_obj.status == FileStatus.READY.value else 0

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        growth = max(0, int(new_size) - int(counted_old))
        projected = int(usage.used_bytes) + int(usage.reserved_bytes) + growth
        if limit_bytes > 0 and projected > limit_bytes:
            _inc_text_save_metric("quota_exceeded")
            raise QuotaExceededError("Недостаточно свободного места для сохранения TXT.")

        version_id = uuid.uuid4()
        key = self.storage.build_version_key(org_id=org_id, file_id=file_obj.id, version_id=version_id)
        try:
            self.storage.put_object_bytes(
                bucket=DEFAULT_BUCKET,
                key=key,
                payload=payload,
                content_type="text/plain; charset=utf-8",
            )
        except Exception as exc:
            _inc_text_save_metric("storage_error")
            raise DocsModuleError(
                code="STORAGE_WRITE_ERROR",
                message="Не удалось сохранить новую версию файла",
            ) from exc

        version = FileVersion(
            id=version_id,
            file_id=file_obj.id,
            s3_key=key,
            s3_bucket=DEFAULT_BUCKET,
            size_bytes=int(new_size),
            sha256=sha256(payload).hexdigest(),
            mime="text/plain",
            created_by=user_id,
        )
        await self.repo.create_file_version(version)

        file_obj.current_version_id = version.id
        file_obj.s3_key = key
        file_obj.s3_bucket = DEFAULT_BUCKET
        file_obj.content_type = "text/plain"
        file_obj.size = int(new_size)
        file_obj.status = FileStatus.READY.value
        if title is not None:
            file_obj.title = title
        await self.repo.update_file(file_obj)

        usage.used_bytes = max(0, int(usage.used_bytes) + int(new_size) - int(counted_old))
        await self.repo.update_storage_usage(usage)

        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_file_version",
            entity_id=str(version.id),
            meta={
                "event": "version_created",
                "file_id": str(file_obj.id),
                "size_bytes": int(new_size),
                "source": "save_text",
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
                "size_bytes": int(new_size),
                "chars_count": len(str(content or "")),
            },
        )
        _inc_text_save_metric("ok")
        _inc_version_metric("save_text")
        return SaveTextResult(file=file_obj, version=version)

    async def request_pdf_sign(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> PdfSignRequestResult:
        """Поставить задачу подписи PDF и перевести файл в `SCANNING`."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.PDF.value:
            raise InvalidTypeError("Подпись поддерживается только для PDF")
        if file_obj.status != FileStatus.READY.value:
            raise DocsModuleError(
                code="FILE_NOT_READY",
                message="Нельзя подписывать PDF в статусе, отличном от READY",
            )
        if file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="У файла отсутствует текущая версия")

        file_obj.status = FileStatus.SCANNING.value
        await self.repo.update_file(file_obj)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "pdf_sign_requested",
                "source_version_id": str(file_obj.current_version_id),
            },
        )
        _inc_upload_metric("scanning")
        return PdfSignRequestResult(file=file_obj, source_version_id=file_obj.current_version_id)

    async def open_docx(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        user_name: str,
    ) -> OpenDocxResult:
        """Подготовить конфиг открытия DOCX в OnlyOffice."""
        DEFAULT_DOC_EDITOR_PROVIDER.ensure_configured()

        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.DOCX.value:
            raise InvalidTypeError("OnlyOffice-редактор доступен только для DOCX")
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="DOCX недоступен для редактирования")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        import jwt
        from datetime import datetime, timezone, timedelta
        token_payload = {
            "sub": str(version.id),
            "action": "internal_download",
            "exp": datetime.now(timezone.utc) + timedelta(hours=2)
        }
        internal_token = jwt.encode(token_payload, settings.SECRET_KEY, algorithm="HS256")
        download_url = f"http://api:8000/api/v1/docs/files/internal-download/{version.id}?token={internal_token}"
        state_token = DEFAULT_DOC_EDITOR_PROVIDER.build_state_token(
            org_id=str(org_id),
            file_id=str(file_obj.id),
            source_version_id=str(version.id),
            user_id=str(user_id),
            ttl_seconds=7200,
        )
        open_payload: OnlyOfficeOpenDocxResult = DEFAULT_DOC_EDITOR_PROVIDER.build_open_docx_payload(
            document_key=str(version.id),
            title=file_obj.title or file_obj.original_name,
            file_url=download_url,
            callback_state_token=state_token,
            user_id=str(user_id),
            user_name=user_name or "CRM User",
        )
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "docx_opened",
                "version_id": str(version.id),
            },
        )
        return OpenDocxResult(
            file=file_obj,
            document_server_url=open_payload.document_server_url,
            config=open_payload.config,
            token=open_payload.token,
        )

    async def process_onlyoffice_callback(
        self,
        *,
        body: dict,
        state_token: str,
        auth_header: str | None,
    ) -> dict[str, object]:
        """Обработать callback OnlyOffice и создать новую версию DOCX при сохранении."""
        DEFAULT_DOC_EDITOR_PROVIDER.ensure_configured()
        DEFAULT_DOC_EDITOR_PROVIDER.validate_callback_signature(body=body, auth_header=auth_header)
        state = DEFAULT_DOC_EDITOR_PROVIDER.decode_state_token(state_token)

        status_code = int(body.get("status") or 0)
        if status_code not in {2, 6}:
            return {"error": 0, "status": status_code, "processed": False}

        file_url = str(body.get("url") or "").strip()
        if not file_url:
            raise DocsModuleError(code="ONLYOFFICE_BAD_PAYLOAD", message="Callback payload missing file url")

        org_id = uuid.UUID(str(state.get("org_id")))
        file_id = uuid.UUID(str(state.get("file_id")))
        source_version_id = uuid.UUID(str(state.get("source_version_id")))
        actor_id = uuid.UUID(str(state.get("user_id")))

        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.DOCX.value:
            raise InvalidTypeError("Callback разрешен только для DOCX")

        source_version = await self.repo.get_file_version(version_id=source_version_id, file_id=file_obj.id)
        if source_version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Исходная версия DOCX не найдена")

        docx_bytes = await self._download_onlyoffice_file(file_url)
        version_id = uuid.uuid4()
        key = self.storage.build_version_key(org_id=org_id, file_id=file_obj.id, version_id=version_id)
        self.storage.put_object_bytes(
            bucket=source_version.s3_bucket,
            key=key,
            payload=docx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        replaced_ready_size = int(source_version.size_bytes if file_obj.status == FileStatus.READY.value else 0)
        version = FileVersion(
            id=version_id,
            file_id=file_obj.id,
            s3_key=key,
            s3_bucket=source_version.s3_bucket,
            size_bytes=int(len(docx_bytes)),
            sha256=sha256(docx_bytes).hexdigest(),
            mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            meta_json={
                "onlyoffice": {
                    "status": status_code,
                    "saved_at": datetime.now(UTC).isoformat(),
                    "users": body.get("users"),
                    "actions": body.get("actions"),
                },
                "replaced_ready_size": replaced_ready_size,
            },
            created_by=actor_id,
        )
        await self.repo.create_file_version(version)

        file_obj.current_version_id = version.id
        file_obj.s3_key = key
        file_obj.s3_bucket = source_version.s3_bucket
        file_obj.content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        file_obj.size = int(len(docx_bytes))
        file_obj.status = FileStatus.SCANNING.value
        await self.repo.update_file(file_obj)

        await self.audit_repo.log(
            org_id=org_id,
            actor_id=actor_id,
            action=AuditAction.CREATE,
            entity_type="docs_file_version",
            entity_id=str(version.id),
            meta={
                "event": "version_created",
                "source": "onlyoffice_callback",
                "file_id": str(file_obj.id),
                "size_bytes": int(len(docx_bytes)),
            },
        )
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=actor_id,
            action=AuditAction.UPDATE,
            entity_type="docs_file",
            entity_id=str(file_obj.id),
            meta={
                "event": "docx_saved_from_onlyoffice",
                "source_version_id": str(source_version.id),
                "new_version_id": str(version.id),
                "status": "scanning",
            },
        )
        _inc_upload_metric("scanning")
        _inc_version_metric("onlyoffice")
        return {"error": 0, "status": status_code, "processed": True, "new_version_id": str(version.id)}

    async def request_ai_generate(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_type: str,
        prompt: str,
        template: str | None,
        folder_id: uuid.UUID | None,
        title: str | None,
        language: str | None,
    ) -> AIGenerateRequestResult:
        """Поставить задачу AI-генерации документа в очередь."""
        if not bool(getattr(settings, "DOCS_AI_GENERATION_ENABLED", True)):
            raise DocsModuleError(code="DOCS_AI_DISABLED", message="AI-генерация документов отключена администратором")

        if not settings.ENABLE_AI:
            raise DocsModuleError(code="AI_DISABLED", message="AI отключен администратором")
        if not await is_org_ai_enabled(self.session, org_id=org_id):
            raise DocsModuleError(code="AI_DISABLED", message="AI отключен для вашей организации", status_code=403)

        normalized_prompt = str(prompt or "").strip()
        if not normalized_prompt:
            raise DocsModuleError(code="INVALID_PROMPT", message="Поле prompt не может быть пустым")
        max_prompt_chars = int(getattr(settings, "DOCS_AI_MAX_PROMPT_CHARS", 12_000) or 12_000)
        if len(normalized_prompt) > max_prompt_chars:
            raise DocsModuleError(code="PROMPT_TOO_LARGE", message="Слишком длинный prompt для генерации документа")

        normalized_type = self._resolve_generated_file_type(file_type)
        if folder_id is not None:
            folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
            if folder is None:
                raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Папка не найдена", status_code=404)

        ai_repo = AIRepository(self.session)
        runtime = await DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime(ai_repo)

        estimated_completion = self._estimate_ai_completion_tokens(normalized_type)
        estimated_request_tokens = int(estimate_tokens(normalized_prompt) + estimated_completion + 180)
        ok, err = await check_ai_limits(
            self.session,
            org_id=org_id,
            user_id=user_id,
            estimated_request_tokens=estimated_request_tokens,
        )
        if not ok:
            raise DocsModuleError(
                code=str((err or {}).get("code") or "AI_LIMIT_EXCEEDED"),
                message=str((err or {}).get("message") or "Превышены лимиты AI"),
                status_code=429,
            )

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        reserved_bytes = self._estimate_ai_reserved_bytes(normalized_prompt, normalized_type)
        projected = int(usage.used_bytes) + int(usage.reserved_bytes) + int(reserved_bytes)
        if limit_bytes > 0 and projected > limit_bytes:
            raise QuotaExceededError("Недостаточно свободного места для AI-генерации документа.")
        usage.reserved_bytes = int(usage.reserved_bytes) + int(reserved_bytes)
        await self.repo.update_storage_usage(usage)

        file_id = uuid.uuid4()
        placeholder_version = uuid.uuid4()
        pending_key = f"org/{org_id}/files/{file_id}/pending/{placeholder_version}"
        content_type, extension = self._resolve_mime_and_ext(normalized_type)
        doc_title = (str(title or "").strip() or f"AI {normalized_type.value.upper()} документ")[:500]
        filename = f"{doc_title[:200]}.{extension}"

        file_obj = File(
            id=file_id,
            org_id=org_id,
            uploaded_by=user_id,
            filename=filename,
            original_name=filename,
            content_type=content_type,
            size=0,
            s3_key=pending_key,
            s3_bucket=DEFAULT_BUCKET,
            folder_id=folder_id,
            type=normalized_type.value,
            status=FileStatus.DRAFT.value,
            title=doc_title,
            current_version_id=None,
        )
        await self.repo.create_file(file_obj)

        job = DocsAIGenerationJob(
            org_id=org_id,
            user_id=user_id,
            file_id=file_obj.id,
            file_type=normalized_type.value,
            status="queued",
            prompt=normalized_prompt,
            template=(str(template).strip() if template else None),
            title=doc_title,
            language=(str(language).strip() if language else "ru"),
            provider_model=runtime.model,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            error_message=None,
            task_id=None,
            meta_json={
                "reserved_bytes": int(reserved_bytes),
                "folder_id": str(folder_id) if folder_id else None,
                "provider_mode": runtime.provider_mode,
            },
        )
        await self.repo.create_ai_generation_job(job)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_ai_generation_job",
            entity_id=str(job.id),
            meta={
                "event": "ai_generate_requested",
                "file_id": str(file_obj.id),
                "file_type": normalized_type.value,
                "estimated_request_tokens": estimated_request_tokens,
            },
        )
        _inc_ai_generate_metric("queued", normalized_type.value)
        return AIGenerateRequestResult(job=job, file=file_obj, estimated_request_tokens=estimated_request_tokens)

    async def get_ai_generation_job(self, *, org_id: uuid.UUID, job_id: uuid.UUID) -> DocsAIGenerationJob:
        """Получить статус AI-job генерации документа."""
        job = await self.repo.get_ai_generation_job(job_id=job_id, org_id=org_id)
        if job is None:
            raise DocsModuleError(code="NOT_FOUND", message="AI job не найден", status_code=404)
        return job

    async def build_download(
        self,
        *,
        org_id: uuid.UUID,
        file_id: uuid.UUID,
        expires_in: int = 900,
    ) -> dict[str, object]:
        """Сформировать presigned URL для скачивания актуальной версии файла."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для скачивания")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        url = self.storage.generate_presigned_get_url(
            bucket=version.s3_bucket,
            key=version.s3_key,
            expires_in=expires_in,
        )
        return {"url": url, "expires_in": int(expires_in)}

    async def get_usage(self, *, org_id: uuid.UUID) -> dict[str, object]:
        """Получить usage/reserved/limit для организации."""
        usage = await self.repo.get_storage_usage(org_id=org_id)
        if usage is None:
            usage = OrgStorageUsage(
                org_id=org_id,
                used_bytes=await self.repo.sum_ready_file_bytes(org_id=org_id),
                reserved_bytes=0,
            )
            await self.repo.update_storage_usage(usage)

        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        used = int(usage.used_bytes)
        reserved = int(usage.reserved_bytes)
        available = max(0, limit_bytes - used - reserved) if limit_bytes > 0 else 0
        percent = 0.0
        if limit_bytes > 0:
            percent = round(min(100.0, (used / limit_bytes) * 100.0), 2)

        return {
            "used_bytes": used,
            "reserved_bytes": reserved,
            "limit_bytes": int(limit_bytes),
            "available_bytes": int(available),
            "percent_used": percent,
        }

    async def _resolve_storage_limit_bytes(self, *, org_id: uuid.UUID) -> int:
        """Получить лимит хранилища в байтах по эффективному тарифу."""
        plan = await self.repo.resolve_effective_plan(org_id=org_id)
        max_storage_mb = int(getattr(plan, "max_storage_mb", 0) or 0)
        if max_storage_mb <= 0:
            return 0
        return int(max_storage_mb) * 1024 * 1024

    async def _validate_parent_folder(
        self,
        *,
        org_id: uuid.UUID,
        parent_id: uuid.UUID | None,
        current_folder_id: uuid.UUID | None,
    ) -> uuid.UUID | None:
        """Проверить корректность родителя (организация, циклы, глубина <= 2)."""
        if parent_id is None:
            return None

        if current_folder_id is not None and parent_id == current_folder_id:
            raise InvalidDepthError("Нельзя вложить папку в саму себя")

        folders = await self.repo.list_folders(org_id=org_id)
        by_id = {item.id: item for item in folders}

        parent = by_id.get(parent_id)
        if parent is None:
            raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Родительская папка не найдена", status_code=404)

        if current_folder_id is not None:
            cursor = parent
            while cursor.parent_id is not None:
                if cursor.parent_id == current_folder_id:
                    raise InvalidDepthError("Нельзя вложить папку в своего потомка")
                next_cursor = by_id.get(cursor.parent_id)
                if next_cursor is None:
                    break
                cursor = next_cursor

        depth = 0
        cursor = parent
        while cursor.parent_id is not None:
            depth += 1
            next_cursor = by_id.get(cursor.parent_id)
            if next_cursor is None:
                break
            cursor = next_cursor

        if depth + 1 > MAX_FOLDER_DEPTH:
            raise InvalidDepthError()
        return parent_id

    def _validate_upload_size(self, size_bytes: int) -> None:
        """Проверить размер файла на глобальный максимум загрузки."""
        max_upload_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
        if int(size_bytes) > max_upload_bytes:
            raise DocsModuleError(code="FILE_TOO_LARGE", message="Файл превышает допустимый размер")

    def _resolve_file_type(self, *, filename: str, content_type: str) -> FileType:
        """Определить тип файла по MIME и расширению с валидацией allow-list."""
        normalized_mime = str(content_type or "").strip().lower()
        normalized_ext = os.path.splitext(str(filename or "").strip().lower())[1]

        by_mime = self.ALLOWED_CONTENT_TYPES.get(normalized_mime)
        by_ext = self.ALLOWED_EXTENSIONS.get(normalized_ext)

        if by_mime is None and by_ext is None:
            raise InvalidTypeError()
        if by_mime is not None and by_ext is not None and by_mime != by_ext:
            raise InvalidTypeError("Расширение файла не соответствует заявленному MIME-типу")

        return by_mime or by_ext  # type: ignore[return-value]

    @staticmethod
    def _resolve_generated_file_type(raw_type: str) -> FileType:
        """Преобразовать строковый тип документа в enum для создания пустого или AI-генерации."""
        value = str(raw_type or "").strip().lower()
        if value == FileType.TXT.value:
            return FileType.TXT
        if value == FileType.DOCX.value:
            return FileType.DOCX
        raise InvalidTypeError("Для создания или генерации поддерживаются только форматы TXT и DOCX")

    async def export_pdf(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, object]:
        """Экспортировать TXT или DOCX файл в формат PDF и вернуть ссылку на скачивание."""
        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.status != FileStatus.READY.value:
            raise DocsModuleError(code="FILE_NOT_READY", message="Файл недоступен для экспорта")
        if file_obj.type == FileType.PDF.value:
            # Уже PDF, просто вернуть ссылку на скачивание оригинального файла
            return await self.build_download(org_id=org_id, file_id=file_id)
            
        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")

        try:
            payload = self.storage.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
        except Exception as exc:
            raise DocsModuleError(code="STORAGE_READ_ERROR", message="Не удалось прочитать файл из хранилища") from exc

        pdf_bytes = b""
        if file_obj.type == FileType.TXT.value:
            from src.modules.docs.document_render import _build_pdf_bytes
            try:
                text = payload.decode("utf-8")
                pdf_bytes = _build_pdf_bytes(text=text, title=file_obj.title or file_obj.original_name)
            except Exception as exc:
                raise DocsModuleError(
                    code="CONVERSION_ERROR", message="Не удалось сконвертировать текстовый файл в PDF"
                ) from exc
        elif file_obj.type == FileType.DOCX.value:
            from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER
            DEFAULT_DOC_EDITOR_PROVIDER.ensure_configured()
            
            # Нам нужно передать URL скачивания в сервис конвертации
            download_url_info = await self.build_download(org_id=org_id, file_id=file_id)
            try:
                pdf_bytes = await DEFAULT_DOC_EDITOR_PROVIDER.convert_to_pdf(
                    file_url=str(download_url_info["url"]),
                    file_type="docx"
                )
            except DocsModuleError:
                raise
            except Exception as exc:
                raise DocsModuleError(
                    code="ONLYOFFICE_CONVERT_ERROR", message=f"Ошибка конвертации DOCX: {exc}"
                ) from exc
        else:
            raise DocsModuleError(code="UNSUPPORTED_TYPE", message="Данный тип файла не поддерживает экспорт в PDF")
            
        # Загружаем экспортированный PDF обратно во временное/постоянное хранилище
        export_key = f"exports/{org_id}/{file_id}/{uuid.uuid4()}.pdf"
        try:
            self.storage.put_object_bytes(
                bucket=DEFAULT_BUCKET,
                key=export_key,
                payload=pdf_bytes,
                content_type="application/pdf",
            )
        except Exception as exc:
            raise DocsModuleError(
                code="STORAGE_WRITE_ERROR", message="Не удалось сохранить экспортированный PDF"
            ) from exc
            
        try:
            url = self.storage.generate_presigned_get_url(
                bucket=DEFAULT_BUCKET,
                key=export_key,
                expires_in=3600,
                filename=f"{file_obj.title or 'Документ'}.pdf"
            )
        except Exception as exc:
            raise DocsModuleError(
                code="STORAGE_URL_ERROR", message="Не удалось сформировать ссылку для экспортированного PDF"
            ) from exc

        return {"url": url, "expires_in": 3600, "filename": f"{file_obj.title or 'Документ'}.pdf"}

    @staticmethod
    def _resolve_mime_and_ext(file_type: FileType) -> tuple[str, str]:
        """Определить MIME и расширение по типу документа."""
        if file_type == FileType.TXT:
            return "text/plain", "txt"
        if file_type == FileType.DOCX:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
        if file_type == FileType.PDF:
            return "application/pdf", "pdf"
        raise InvalidTypeError()

    @staticmethod
    def _estimate_ai_completion_tokens(file_type: FileType) -> int:
        """Оценить completion-токены для проверки лимитов до запуска job."""
        if file_type == FileType.TXT:
            return 1200
        if file_type == FileType.DOCX:
            return 1800
        return 1500

    @staticmethod
    def _estimate_ai_reserved_bytes(prompt: str, file_type: FileType) -> int:
        """Оценить резерв места на период AI-генерации."""
        base = int(getattr(settings, "DOCS_AI_RESERVED_BYTES_BASE", 262144) or 262144)
        prompt_bytes = len(str(prompt or "").encode("utf-8"))
        type_factor = {
            FileType.TXT: 4,
            FileType.DOCX: 8,
            FileType.PDF: 7,
        }.get(file_type, 5)
        estimate = max(base, prompt_bytes * type_factor)
        max_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
        return int(min(max_bytes, estimate))

    async def _download_onlyoffice_file(self, file_url: str) -> bytes:
        """Скачать сохраненный OnlyOffice файл по callback URL."""
        from urllib.parse import urlparse, urlunparse
        
        # Если backend и OnlyOffice оба в Docker, а клиент снаружи по localhost,
        # URL из коллбека может быть недоступен (например, localhost:8080).
        # Подменяем хост на внутренний (DOCS_ONLYOFFICE_DOCUMENT_SERVER_INTERNAL_URL).
        internal_url_base = str(getattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_INTERNAL_URL", "http://onlyoffice:80")).rstrip("/")
        if internal_url_base:
            parsed_internal = urlparse(internal_url_base)
            parsed_file = urlparse(file_url)
            
            # Подменяем схему и хост (netloc) на внутренние из настроек.
            file_url_internal = urlunparse((
                parsed_internal.scheme,
                parsed_internal.netloc,
                parsed_file.path,
                parsed_file.params,
                parsed_file.query,
                parsed_file.fragment
            ))
        else:
            file_url_internal = file_url

        timeout_s = float(getattr(settings, "DOCS_ONLYOFFICE_REQUEST_TIMEOUT_S", 20.0) or 20.0)
        timeout = httpx.Timeout(timeout_s)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(file_url_internal)
            response.raise_for_status()
            return bytes(response.content)

    @staticmethod
    def _default_title_from_filename(filename: str) -> str:
        """Сформировать заголовок файла по имени."""
        basename = os.path.basename(str(filename or "").strip())
        name, _ = os.path.splitext(basename)
        return (name or "Новый документ").strip()[:500]

    @staticmethod
    def _build_filename_by_type(*, title: str, extension: str) -> str:
        """Собрать безопасное имя файла из заголовка и расширения."""
        normalized_ext = str(extension or "").strip().lstrip(".").lower()
        if not normalized_ext:
            normalized_ext = "txt"
        base = " ".join(str(title or "Новый документ").strip().split())
        safe_chars = []
        for char in base:
            if char.isalnum() or char in {" ", "-", "_", "(", ")"}:
                safe_chars.append(char)
            else:
                safe_chars.append("_")
        safe_base = "".join(safe_chars).strip(" ._") or "Новый документ"
        return f"{safe_base[:200]}.{normalized_ext}"

    @staticmethod
    def _extract_version_id_from_key(key: str) -> uuid.UUID:
        """Извлечь `version_id` из ключа формата `.../v/{version_id}`."""
        tail = str(key or "").strip().split("/")[-1]
        try:
            return uuid.UUID(tail)
        except Exception as exc:
            raise DocsModuleError(code="INVALID_STORAGE_KEY", message="Некорректный ключ версии файла") from exc
