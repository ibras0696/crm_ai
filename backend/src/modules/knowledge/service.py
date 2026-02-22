import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.knowledge.models import KBPage
from src.modules.knowledge.repository import KnowledgeRepository
from src.modules.knowledge.schemas import CreatePageRequest, UpdatePageRequest


class KnowledgeService:
    """Application service for knowledge module."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = KnowledgeRepository(session)

    async def create_page(self, *, org_id: uuid.UUID, user_id: uuid.UUID, body: CreatePageRequest) -> KBPage:
        """Create knowledge page for organization."""
        page = KBPage(
            org_id=org_id,
            created_by=user_id,
            title=body.title,
            slug=_build_slug(body.title),
            content=body.content,
            parent_id=body.parent_id,
            icon=body.icon,
        )
        return await self.repo.create(page)

    async def list_pages(self, *, org_id: uuid.UUID) -> list[KBPage]:
        """List organization pages."""
        return await self.repo.list_by_org(org_id=org_id)

    async def get_page(self, *, org_id: uuid.UUID, page_id: uuid.UUID) -> KBPage | None:
        """Get organization page by id."""
        return await self.repo.get_by_id_for_org(page_id=page_id, org_id=org_id)

    async def update_page(self, *, org_id: uuid.UUID, page_id: uuid.UUID, body: UpdatePageRequest) -> KBPage | None:
        """Update organization page."""
        page = await self.repo.get_by_id_for_org(page_id=page_id, org_id=org_id)
        if page is None:
            return None
        updates = body.model_dump(exclude_unset=True)
        for field, value in updates.items():
            setattr(page, field, value)
        if body.title:
            page.slug = _build_slug(body.title)
        await self.session.flush()
        return page

    async def delete_page(self, *, org_id: uuid.UUID, page_id: uuid.UUID) -> bool:
        """Delete organization page."""
        page = await self.repo.get_by_id_for_org(page_id=page_id, org_id=org_id)
        if page is None:
            return False
        await self.repo.delete(page)
        return True


def _build_slug(title: str) -> str:
    """Build safe slug from title."""
    raw = (title or "").strip().lower()
    replaced = re.sub(r"\s+", "-", raw)
    cleaned = re.sub(r"[^a-z0-9\-а-яё]", "", replaced)
    collapsed = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not collapsed:
        return "page"
    return collapsed[:200]
