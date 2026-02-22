from __future__ import annotations

import uuid

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.access.models import AccessRule


class AccessRepository:
    """Репозиторий access: только работа с БД, без бизнес-логики."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_rules(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str | None,
        resource_id: uuid.UUID | None,
    ) -> list[AccessRule]:
        stmt = select(AccessRule).where(AccessRule.org_id == org_id)
        if resource_type:
            stmt = stmt.where(AccessRule.resource_type == resource_type)
        if resource_id:
            stmt = stmt.where(AccessRule.resource_id == resource_id)
        stmt = stmt.order_by(AccessRule.created_at.desc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_rule(self, *, org_id: uuid.UUID, rule_id: uuid.UUID) -> AccessRule | None:
        rule = await self.session.get(AccessRule, rule_id)
        if not rule or rule.org_id != org_id:
            return None
        return rule

    async def create_rule(self, rule: AccessRule) -> AccessRule:
        self.session.add(rule)
        await self.session.flush()
        return rule

    async def delete_rule(self, rule: AccessRule) -> None:
        await self.session.delete(rule)

    async def org_has_any_rules_for_type(self, *, org_id: uuid.UUID, resource_type: str) -> bool:
        cnt = (
            await self.session.execute(
                select(func.count(AccessRule.id)).where(AccessRule.org_id == org_id, AccessRule.resource_type == resource_type)
            )
        ).scalar_one()
        return int(cnt or 0) > 0

    async def best_match_rule(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str,
        resource_id: uuid.UUID | None,
        user_id: uuid.UUID,
        user_role: str,
    ) -> AccessRule | None:
        """Выбирает самое подходящее правило (если есть), без падений при дублях."""
        filters = [AccessRule.org_id == org_id, AccessRule.resource_type == resource_type]
        if resource_id is not None:
            filters.append(or_(AccessRule.resource_id == resource_id, AccessRule.resource_id.is_(None)))
        else:
            filters.append(AccessRule.resource_id.is_(None))

        filters.append(or_(AccessRule.user_id == user_id, AccessRule.role == user_role))

        rank = case(
            (
                (AccessRule.resource_id == resource_id) & (AccessRule.user_id == user_id),
                40,
            ),
            (
                (AccessRule.resource_id == resource_id) & (AccessRule.role == user_role),
                30,
            ),
            (
                AccessRule.resource_id.is_(None) & (AccessRule.user_id == user_id),
                20,
            ),
            (
                AccessRule.resource_id.is_(None) & (AccessRule.role == user_role),
                10,
            ),
            else_=0,
        ).label("rank")

        stmt = select(AccessRule).where(*filters).order_by(rank.desc(), AccessRule.created_at.desc()).limit(1)
        return (await self.session.execute(stmt)).scalars().first()

