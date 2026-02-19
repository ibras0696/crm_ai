import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.files.models import File


class FileRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, file: File) -> File:
        self.session.add(file)
        await self.session.flush()
        return file

    async def get_by_id(self, file_id: uuid.UUID) -> File | None:
        return await self.session.get(File, file_id)

    async def list_by_org(self, org_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[File]:
        stmt = (
            select(File)
            .where(File.org_id == org_id)
            .order_by(File.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, file: File):
        await self.session.delete(file)
        await self.session.flush()
