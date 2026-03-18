from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from hashlib import sha256

import jwt
from botocore.exceptions import BotoCoreError, ClientError

from src.common.enums import AuditAction
from src.config import settings
from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER, OnlyOfficeOpenDocxResult
from src.modules.docs.document_render import render_document_bytes
from src.modules.docs.domain import FileStatus, FileType
from src.modules.docs.errors import DocsModuleError, InvalidTypeError
from src.modules.docs.magic_bytes import validate_magic_bytes
from src.modules.docs.models import FileVersion
from src.modules.docs.service_parts.base import OpenDocxResult, _inc_upload_metric, _inc_version_metric

logger = logging.getLogger(__name__)


class DocsEditingMixin:
    async def open_docx(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
        user_name: str,
    ) -> OpenDocxResult:
        DEFAULT_DOC_EDITOR_PROVIDER.ensure_configured()

        file_obj = await self.get_file(org_id=org_id, file_id=file_id)
        if file_obj.type != FileType.DOCX.value:
            raise InvalidTypeError("OnlyOffice-редактор доступен только для DOCX")
        if file_obj.status != FileStatus.READY.value or file_obj.current_version_id is None:
            raise DocsModuleError(code="FILE_NOT_READY", message="DOCX недоступен для редактирования")

        version = await self.repo.get_file_version(version_id=file_obj.current_version_id, file_id=file_obj.id)
        if version is None:
            raise DocsModuleError(code="FILE_VERSION_NOT_FOUND", message="Текущая версия файла не найдена")
        await self._ensure_current_docx_payload(file_obj=file_obj, version=version, user_id=user_id)

        document_title = str(file_obj.original_name or file_obj.title or "document.docx").strip()
        if not document_title.lower().endswith(".docx"):
            document_title = f"{document_title}.docx"
        # Keep key dash-free to avoid possible downstream key normalization issues
        # in document server cache/indexing layers.
        version_stamp = int(version.created_at.timestamp()) if getattr(version, "created_at", None) else 0
        open_session_nonce = uuid.uuid4().hex
        document_key = f"{str(version.id).replace('-', '')}{version_stamp}{open_session_nonce}"

        token_payload = {
            "sub": str(version.id),
            "action": "internal_download",
            "exp": datetime.now(UTC) + timedelta(hours=2),
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
            document_key=document_key,
            title=document_title,
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

    async def _ensure_current_docx_payload(self, *, file_obj, version: FileVersion, user_id: uuid.UUID) -> None:
        """Проверить целостность текущей DOCX-версии и попытаться восстановить create-empty файл."""
        payload: bytes | None = None
        broken_reason = "storage_read_error"
        try:
            payload = self.storage.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError):
            payload = None

        if payload:
            magic_ok, magic_reason = validate_magic_bytes(FileType.DOCX, payload)
            if magic_ok:
                return
            broken_reason = magic_reason

        version_meta = version.meta_json if isinstance(version.meta_json, dict) else {}
        source = str(version_meta.get("source") or "").strip().lower()
        if source == "create_empty":
            title = str(file_obj.title or file_obj.original_name or "Документ").strip() or "Документ"
            regenerated, content_type, _ = render_document_bytes(file_type=FileType.DOCX, text="", title=title)
            try:
                self.storage.put_object_bytes(
                    bucket=version.s3_bucket,
                    key=version.s3_key,
                    payload=regenerated,
                    content_type=content_type,
                )
            except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
                logger.exception(
                    "docs_docx_storage_recovery_failed",
                    extra={"file_id": str(file_obj.id), "version_id": str(version.id), "reason": broken_reason},
                )
                raise DocsModuleError(
                    code="DOCX_STORAGE_CORRUPTED",
                    message="Файл поврежден в хранилище и не может быть восстановлен автоматически",
                    status_code=409,
                ) from exc

            file_obj.size = len(regenerated)
            file_obj.content_type = content_type
            await self.repo.update_file(file_obj)

            version.size_bytes = len(regenerated)
            version.mime = content_type
            version.sha256 = sha256(regenerated).hexdigest()
            recovery_meta = version_meta if isinstance(version_meta, dict) else {}
            recovery_meta["storage_recovery"] = {
                "strategy": "regenerate_empty_docx",
                "recovered_at": datetime.now(UTC).isoformat(),
                "broken_reason": broken_reason,
            }
            version.meta_json = recovery_meta
            await self.audit_repo.log(
                org_id=file_obj.org_id,
                actor_id=user_id,
                action=AuditAction.UPDATE,
                entity_type="docs_file",
                entity_id=str(file_obj.id),
                meta={
                    "event": "docx_storage_recovered",
                    "version_id": str(version.id),
                    "reason": broken_reason,
                    "strategy": "regenerate_empty_docx",
                },
            )
            return

        raise DocsModuleError(
            code="DOCX_STORAGE_CORRUPTED",
            message="Текущая версия DOCX повреждена в хранилище. Перезагрузите документ.",
            status_code=409,
        )

    async def process_onlyoffice_callback(
        self,
        *,
        body: dict,
        state_token: str,
        auth_header: str | None,
    ) -> dict[str, object]:
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
        if file_obj.current_version_id != source_version_id:
            raise DocsModuleError(
                code="CONFLICT",
                message="Документ уже изменён в другой сессии. Откройте актуальную версию и повторите редактирование.",
                status_code=409,
            )

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
            size_bytes=len(docx_bytes),
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
        file_obj.size = len(docx_bytes)
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
                "size_bytes": len(docx_bytes),
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
