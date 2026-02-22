import uuid

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.files import storage
from src.modules.files.models import File
from src.modules.files.repository import FileRepository


class FilesService:
    """Application service for files module."""

    def __init__(self, session: AsyncSession):
        self.repo = FileRepository(session)

    async def upload(self, *, org_id: uuid.UUID, user_id: uuid.UUID, file: UploadFile) -> File:
        """Upload file content to storage and create DB row."""
        data = await file.read()
        content_type = file.content_type or "application/octet-stream"
        original_name = file.filename or "unnamed"
        s3_key, bucket = storage.upload_file(data, content_type, org_id, original_name)
        db_file = File(
            org_id=org_id,
            uploaded_by=user_id,
            filename=s3_key.split("/")[-1],
            original_name=original_name,
            content_type=content_type,
            size=len(data),
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
