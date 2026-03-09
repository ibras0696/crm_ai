import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.common.optimistic_lock import optimistic_lock_matches
from src.modules.knowledge.errors import KnowledgeModuleError
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
        await self._enforce_knowledge_limit(org_id=org_id)
        parent_id = await self._validate_parent(org_id=org_id, current_page_id=None, parent_id=body.parent_id)
        position = await self.repo.get_max_position(org_id=org_id, parent_id=parent_id) + 1
        page = KBPage(
            org_id=org_id,
            created_by=user_id,
            title=body.title,
            slug=_build_slug(body.title),
            content=body.content,
            parent_id=parent_id,
            icon=body.icon,
            position=position,
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
        if not optimistic_lock_matches(current=page.updated_at, expected=body.expected_updated_at):
            raise KnowledgeModuleError(
                code="CONFLICT",
                message="Страница уже изменена другим сотрудником. Обновите данные и повторите сохранение.",
                status_code=409,
            )
        updates = body.model_dump(exclude_unset=True)
        updates.pop("expected_updated_at", None)
        parent_changed = "parent_id" in updates
        if parent_changed:
            updates["parent_id"] = await self._validate_parent(
                org_id=org_id,
                current_page_id=page.id,
                parent_id=updates["parent_id"],
            )
        for field, value in updates.items():
            setattr(page, field, value)
        if parent_changed and "position" not in updates:
            page.position = await self.repo.get_max_position(org_id=org_id, parent_id=page.parent_id) + 1
        if body.title:
            page.slug = _build_slug(body.title)
        await self.session.flush()
        return page

    async def delete_page(self, *, org_id: uuid.UUID, page_id: uuid.UUID) -> bool:
        """Delete organization page."""
        deleted_count = await self.repo.delete_subtree(org_id=org_id, root_page_id=page_id)
        return deleted_count > 0

    async def _enforce_knowledge_limit(self, *, org_id: uuid.UUID) -> None:
        plan = await self.repo.get_effective_plan(org_id=org_id)
        limit = int(getattr(plan, "max_records", 0) or 0)
        if limit <= 0:
            return
        current = await self.repo.count_by_org(org_id=org_id)
        if current >= limit:
            raise KnowledgeModuleError.limit_reached()

    async def _validate_parent(
        self,
        *,
        org_id: uuid.UUID,
        current_page_id: uuid.UUID | None,
        parent_id: uuid.UUID | None,
    ) -> uuid.UUID | None:
        if parent_id is None:
            return None

        parent_page = await self.repo.get_by_id_for_org(page_id=parent_id, org_id=org_id)
        if parent_page is None:
            raise KnowledgeModuleError(code="NOT_FOUND", message="Родительская страница не найдена", status_code=404)

        if current_page_id is None:
            return parent_id

        if parent_id == current_page_id:
            raise KnowledgeModuleError(
                code="INVALID_PARENT",
                message="Нельзя сделать страницу родителем самой себя",
                status_code=400,
            )

        pages = await self.repo.list_by_org(org_id=org_id)
        by_id = {page.id: page for page in pages}
        cursor = parent_page
        while cursor.parent_id is not None:
            if cursor.parent_id == current_page_id:
                raise KnowledgeModuleError(
                    code="INVALID_PARENT",
                    message="Нельзя переместить страницу внутрь своей дочерней ветки",
                    status_code=400,
                )
            next_cursor = by_id.get(cursor.parent_id)
            if next_cursor is None:
                break
            cursor = next_cursor

        return parent_id


def _build_slug(title: str) -> str:
    """Build safe slug from title."""
    raw = (title or "").strip().lower()
    replaced = re.sub(r"\s+", "-", raw)
    cleaned = re.sub(r"[^a-z0-9\-а-яё]", "", replaced)
    collapsed = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not collapsed:
        return "page"
    return collapsed[:200]
