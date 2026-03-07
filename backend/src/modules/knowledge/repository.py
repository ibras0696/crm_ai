import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.billing.models import Plan
from src.modules.knowledge.models import KBPage
from src.modules.org.repository import SubscriptionRepository


class KnowledgeRepository:
    """Repository for DB operations of knowledge pages."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, page: KBPage) -> KBPage:
        """Create knowledge page."""
        self.session.add(page)
        await self.session.flush()
        return page

    async def get_max_position(self, *, org_id: uuid.UUID, parent_id: uuid.UUID | None) -> int:
        stmt = select(func.max(KBPage.position)).where(
            KBPage.org_id == org_id,
            KBPage.parent_id == parent_id,
        )
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def list_by_org(self, *, org_id: uuid.UUID) -> list[KBPage]:
        """List pages for organization."""
        stmt = (
            select(KBPage)
            .where(KBPage.org_id == org_id)
            .order_by(KBPage.position.asc(), KBPage.created_at.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_org(self, *, org_id: uuid.UUID) -> int:
        stmt = select(func.count(KBPage.id)).where(KBPage.org_id == org_id)
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def get_by_id_for_org(self, *, page_id: uuid.UUID, org_id: uuid.UUID) -> KBPage | None:
        """Get page by id constrained by organization."""
        stmt = select(KBPage).where(KBPage.id == page_id, KBPage.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete(self, page: KBPage) -> None:
        """Delete page."""
        await self.session.delete(page)

    async def delete_subtree(self, *, org_id: uuid.UUID, root_page_id: uuid.UUID) -> int:
        """Delete a page with all descendants in a single query."""
        subtree = (
            select(KBPage.id)
            .where(KBPage.id == root_page_id, KBPage.org_id == org_id)
            .cte(name="subtree", recursive=True)
        )
        descendants = (
            select(KBPage.id)
            .join(subtree, KBPage.parent_id == subtree.c.id)
            .where(KBPage.org_id == org_id)
        )
        subtree = subtree.union_all(descendants)

        stmt = (
            delete(KBPage)
            .where(KBPage.id.in_(select(subtree.c.id)))
            .returning(KBPage.id)
        )
        result = await self.session.execute(stmt)
        return len(result.scalars().all())

    async def get_effective_plan(self, *, org_id: uuid.UUID) -> Plan | None:
        sub_repo = SubscriptionRepository(self.session)
        return await sub_repo.get_effective_plan(org_id)
