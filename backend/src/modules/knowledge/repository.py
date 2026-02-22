import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.knowledge.models import KBPage


class KnowledgeRepository:
    """Repository for DB operations of knowledge pages."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, page: KBPage) -> KBPage:
        """Create knowledge page."""
        self.session.add(page)
        await self.session.flush()
        return page

    async def list_by_org(self, *, org_id: uuid.UUID) -> list[KBPage]:
        """List pages for organization."""
        stmt = (
            select(KBPage)
            .where(KBPage.org_id == org_id)
            .order_by(KBPage.position.asc(), KBPage.created_at.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id_for_org(self, *, page_id: uuid.UUID, org_id: uuid.UUID) -> KBPage | None:
        """Get page by id constrained by organization."""
        stmt = select(KBPage).where(KBPage.id == page_id, KBPage.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete(self, page: KBPage) -> None:
        """Delete page."""
        await self.session.delete(page)
