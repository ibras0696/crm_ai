import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.files.models import File


class FileRepository:
    """Repository for files SQL operations only."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, file: File) -> File:
        """Create a new file row."""
        self.session.add(file)
        await self.session.flush()
        return file

    async def get_by_id(self, file_id: uuid.UUID) -> File | None:
        """Get file by identifier."""
        return await self.session.get(File, file_id)

    async def get_by_id_for_org(self, file_id: uuid.UUID, org_id: uuid.UUID) -> File | None:
        """Get file by identifier constrained by organization."""
        stmt = select(File).where(File.id == file_id, File.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_org(self, org_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[File]:
        """Get organization files with pagination."""
        stmt = (
            select(File)
            .where(File.org_id == org_id)
            .order_by(File.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, file: File) -> None:
        """Delete file row."""
        await self.session.delete(file)
        await self.session.flush()
