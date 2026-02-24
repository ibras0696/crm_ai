import uuid
from tempfile import SpooledTemporaryFile

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.modules.files import storage
from src.modules.files.models import File
from src.modules.files.repository import FileRepository


ALLOWED_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "application/pdf": (b"%PDF",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b"PK\x03\x04",),
    "application/vnd.ms-excel": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", b"PK\x03\x04"),
}


class FilesService:
    """Application service for files module."""

    def __init__(self, session: AsyncSession):
        self.repo = FileRepository(session)

    async def upload(self, *, org_id: uuid.UUID, user_id: uuid.UUID, file: UploadFile) -> File:
        """Upload file stream to storage with validation and limits."""
        content_type = (file.content_type or "application/octet-stream").strip().lower()
        original_name = (file.filename or "unnamed").strip() or "unnamed"
        allowed = {m.strip().lower() for m in (settings.FILE_ALLOWED_MIME_TYPES or []) if str(m).strip()}
        if allowed and content_type not in allowed:
            raise ValueError("UNSUPPORTED_MIME")

        max_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
        chunk_size = int(max(16 * 1024, int(settings.FILE_UPLOAD_CHUNK_SIZE_KB) * 1024))
        total_size = 0
        first_bytes = b""
        tmp = SpooledTemporaryFile(max_size=min(max_bytes, 8 * 1024 * 1024), mode="w+b")
        try:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                if not first_bytes:
                    first_bytes = chunk[:32]
                total_size += len(chunk)
                if total_size > max_bytes:
                    raise ValueError("FILE_TOO_LARGE")
                tmp.write(chunk)

            if total_size <= 0:
                raise ValueError("EMPTY_FILE")
            if not _content_matches_mime(content_type, first_bytes):
                raise ValueError("CONTENT_MISMATCH")

            tmp.seek(0)
            s3_key, bucket = storage.upload_fileobj(tmp, content_type, org_id, original_name)
        finally:
            tmp.close()
            await file.close()

        db_file = File(
            org_id=org_id,
            uploaded_by=user_id,
            filename=s3_key.split("/")[-1],
            original_name=original_name,
            content_type=content_type,
            size=total_size,
            s3_key=s3_key,
            s3_bucket=bucket,
        )
        return await self.repo.create(db_file)

    async def list_org_files(self, *, org_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[File]:
        """List organization files with pagination."""
        return await self.repo.list_by_org(org_id, limit=limit, offset=offset)

    async def get_for_org(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> File | None:
        """Get file by id only when it belongs to organization."""
        return await self.repo.get_by_id_for_org(file_id=file_id, org_id=org_id)

    def download_payload(self, db_file: File) -> tuple[bytes, str]:
        """Download file bytes and content type from storage."""
        return storage.download_file(db_file.s3_key, db_file.s3_bucket)

    async def delete_for_org(self, *, org_id: uuid.UUID, file_id: uuid.UUID) -> bool:
        """Delete file from storage and DB in organization scope."""
        db_file = await self.repo.get_by_id_for_org(file_id=file_id, org_id=org_id)
        if not db_file:
            return False
        storage.delete_file(db_file.s3_key, db_file.s3_bucket)
        await self.repo.delete(db_file)
        return True


def _content_matches_mime(content_type: str, first_bytes: bytes) -> bool:
    if not first_bytes:
        return False
    # Text-like files: reject obvious binary payload in first bytes.
    if content_type in {"text/plain", "text/csv"}:
        return b"\x00" not in first_bytes
    signatures = ALLOWED_SIGNATURES.get(content_type)
    if not signatures:
        return True
    return any(first_bytes.startswith(sig) for sig in signatures)
