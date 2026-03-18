from __future__ import annotations

import logging
import os
import uuid
from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING, ClassVar
from urllib.parse import urlparse, urlunparse

import httpx

from src.config import settings
from src.infrastructure.metrics_custom import (
    DOCS_AI_GENERATE_TOTAL,
    DOCS_VERSIONS_CREATED_TOTAL,
    UPLOADS_TOTAL,
)
from src.modules.audit.repository import AuditRepository
from src.modules.docs.domain import MAX_FOLDER_DEPTH, FileType
from src.modules.docs.errors import DocsModuleError, InvalidDepthError, InvalidTypeError
from src.modules.docs.models import OrgStorageUsage
from src.modules.docs.repository import DocsRepository
from src.modules.docs.storage import DEFAULT_STORAGE_PROVIDER, StorageProvider

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.modules.docs.models import DocsAIGenerationJob, Folder
    from src.modules.files.models import File


logger = logging.getLogger(__name__)


@dataclass(slots=True)
class FinishUploadResult:
    file: File
    version_id: uuid.UUID


@dataclass(slots=True)
class OpenDocxResult:
    file: File
    document_server_url: str
    config: dict
    token: str | None


@dataclass(slots=True)
class AIGenerateRequestResult:
    job: DocsAIGenerationJob
    file: File
    estimated_request_tokens: int
    should_enqueue_task: bool = True


def _inc_upload_metric(status: str) -> None:
    with suppress(Exception):
        UPLOADS_TOTAL.labels(status=status).inc()


def _inc_version_metric(source: str) -> None:
    with suppress(Exception):
        DOCS_VERSIONS_CREATED_TOTAL.labels(source=source).inc()


def _inc_ai_generate_metric(status: str, file_type: str) -> None:
    with suppress(Exception):
        DOCS_AI_GENERATE_TOTAL.labels(status=status, file_type=file_type).inc()


class DocsServiceBase:
    ALLOWED_CONTENT_TYPES: ClassVar[dict[str, FileType]] = {
        "text/plain": FileType.TXT,
        "application/pdf": FileType.PDF,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": FileType.DOCX,
    }
    ALLOWED_EXTENSIONS: ClassVar[dict[str, FileType]] = {
        ".txt": FileType.TXT,
        ".pdf": FileType.PDF,
        ".docx": FileType.DOCX,
    }

    def __init__(self, session: AsyncSession, *, storage_provider: StorageProvider = DEFAULT_STORAGE_PROVIDER):
        self.session = session
        self.repo = DocsRepository(session)
        self.audit_repo = AuditRepository(session)
        self.storage = storage_provider

    async def get_file(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> File:
        file_obj = await self.repo.get_doc_file(file_id=file_id, org_id=org_id)
        if file_obj is None:
            raise DocsModuleError(code="NOT_FOUND", message="Файл не найден", status_code=404)
        return file_obj

    async def get_usage(self, *, org_id: uuid.UUID) -> dict[str, object]:
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
        if parent_id is None:
            return None

        if current_folder_id is not None and parent_id == current_folder_id:
            raise InvalidDepthError("Нельзя вложить папку в саму себя")

        folders = await self.repo.list_folders(org_id=org_id)
        by_id = {item.id: item for item in folders}
        children_by_parent: dict[uuid.UUID | None, list[Folder]] = {}
        for item in folders:
            children_by_parent.setdefault(item.parent_id, []).append(item)

        def _subtree_extra_depth(folder_id: uuid.UUID) -> int:
            children = children_by_parent.get(folder_id, [])
            if not children:
                return 0
            return 1 + max(_subtree_extra_depth(child.id) for child in children)

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

        subtree_extra_depth = _subtree_extra_depth(current_folder_id) if current_folder_id is not None else 0
        if depth + 1 + subtree_extra_depth > MAX_FOLDER_DEPTH:
            raise InvalidDepthError()
        return parent_id

    def _validate_upload_size(self, size_bytes: int) -> None:
        max_upload_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
        if int(size_bytes) > max_upload_bytes:
            raise DocsModuleError(code="FILE_TOO_LARGE", message="Файл превышает допустимый размер")

    def _resolve_file_type(self, *, filename: str, content_type: str) -> FileType:
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
        normalized = str(raw_type or "").strip().lower()
        mapping = {
            FileType.TXT.value: FileType.TXT,
            FileType.DOCX.value: FileType.DOCX,
            FileType.PDF.value: FileType.PDF,
        }
        resolved = mapping.get(normalized)
        if resolved is None:
            raise InvalidTypeError()
        return resolved

    @staticmethod
    def _extract_reserved_bytes(meta_json: dict | None) -> int:
        if not isinstance(meta_json, dict):
            return 0
        try:
            return max(0, int(meta_json.get("reserved_bytes") or 0))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _resolve_mime_and_ext(file_type: FileType) -> tuple[str, str]:
        if file_type == FileType.TXT:
            return "text/plain", "txt"
        if file_type == FileType.DOCX:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"
        if file_type == FileType.PDF:
            return "application/pdf", "pdf"
        raise InvalidTypeError()

    @staticmethod
    def _estimate_ai_reserved_bytes(prompt: str, file_type: FileType) -> int:
        base = int(getattr(settings, "DOCS_AI_RESERVED_BYTES_BASE", 262144) or 262144)
        prompt_bytes = len(str(prompt or "").encode("utf-8"))
        type_factor = {
            FileType.DOCX: 8,
            FileType.PDF: 7,
        }.get(file_type, 5)
        estimate = max(base, prompt_bytes * type_factor)
        max_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
        return int(min(max_bytes, estimate))

    async def _download_onlyoffice_file(self, file_url: str) -> bytes:
        internal_url_base = str(
            getattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_INTERNAL_URL", "http://onlyoffice:80")
        ).rstrip("/")
        if internal_url_base:
            parsed_internal = urlparse(internal_url_base)
            parsed_file = urlparse(file_url)
            file_url_internal = urlunparse(
                (
                    parsed_internal.scheme,
                    parsed_internal.netloc,
                    parsed_file.path,
                    parsed_file.params,
                    parsed_file.query,
                    parsed_file.fragment,
                )
            )
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
        basename = os.path.basename(str(filename or "").strip())
        name, _ = os.path.splitext(basename)
        return (name or "Новый документ").strip()[:500]

    @staticmethod
    def _build_filename_by_type(*, title: str, extension: str) -> str:
        normalized_ext = str(extension or "").strip().lstrip(".").lower()
        if not normalized_ext:
            normalized_ext = "docx"
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
        tail = str(key or "").strip().split("/")[-1]
        try:
            return uuid.UUID(tail)
        except (TypeError, ValueError, AttributeError) as exc:
            raise DocsModuleError(code="INVALID_STORAGE_KEY", message="Некорректный ключ версии файла") from exc
