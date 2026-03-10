from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import case, or_, select

from src.modules.access.models import AccessRule

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession


class AccessRepository:
    """Repository for access rules (DB-only operations)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_rules(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str | None,
        resource_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> list[AccessRule]:
        stmt = select(AccessRule).where(AccessRule.org_id == org_id)
        if resource_type:
            stmt = stmt.where(AccessRule.resource_type == resource_type)
        if resource_id is not None:
            # For specific resource view include exact and global rules.
            stmt = stmt.where(or_(AccessRule.resource_id == resource_id, AccessRule.resource_id.is_(None)))
        stmt = stmt.order_by(AccessRule.created_at.desc()).offset(offset).limit(limit)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_rule(self, *, org_id: uuid.UUID, rule_id: uuid.UUID) -> AccessRule | None:
        stmt = select(AccessRule).where(AccessRule.id == rule_id, AccessRule.org_id == org_id)
        return (await self.session.execute(stmt)).scalars().first()

    async def create_rule(self, rule: AccessRule) -> AccessRule:
        self.session.add(rule)
        await self.session.flush()
        return rule

    async def get_exact_rule(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str,
        resource_id: uuid.UUID | None,
        role: str | None,
        user_id: uuid.UUID | None,
    ) -> AccessRule | None:
        """Get exact ACL rule for (org, resource scope, subject)."""
        stmt = select(AccessRule).where(
            AccessRule.org_id == org_id,
            AccessRule.resource_type == resource_type,
            AccessRule.resource_id == resource_id,
            AccessRule.role == role,
            AccessRule.user_id == user_id,
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def delete_rule(self, rule: AccessRule) -> None:
        await self.session.delete(rule)

    async def org_has_any_rules_for_type(self, *, org_id: uuid.UUID, resource_type: str) -> bool:
        exists_stmt = (
            select(AccessRule.id)
            .where(AccessRule.org_id == org_id, AccessRule.resource_type == resource_type)
            .limit(1)
            .exists()
        )
        return bool((await self.session.execute(select(exists_stmt))).scalar_one())

    async def best_match_rule(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str,
        resource_id: uuid.UUID | None,
        user_id: uuid.UUID,
        user_role: str,
        permission: str = "can_read",
    ) -> AccessRule | None:
        """Return highest-priority ACL rule for subject/resource."""
        filters = [AccessRule.org_id == org_id, AccessRule.resource_type == resource_type]
        if resource_id is not None:
            filters.append(or_(AccessRule.resource_id == resource_id, AccessRule.resource_id.is_(None)))
        else:
            filters.append(AccessRule.resource_id.is_(None))
        filters.append(or_(AccessRule.user_id == user_id, AccessRule.role == user_role))

        if resource_id is not None:
            rank = case(
                ((AccessRule.resource_id == resource_id) & (AccessRule.user_id == user_id), 40),
                ((AccessRule.resource_id == resource_id) & (AccessRule.role == user_role), 30),
                (AccessRule.resource_id.is_(None) & (AccessRule.user_id == user_id), 20),
                (AccessRule.resource_id.is_(None) & (AccessRule.role == user_role), 10),
                else_=0,
            ).label("rank")
        else:
            rank = case(
                (AccessRule.user_id == user_id, 20),
                (AccessRule.role == user_role, 10),
                else_=0,
            ).label("rank")

        permission_column = getattr(AccessRule, permission, AccessRule.can_read)
        stmt = (
            select(AccessRule)
            .where(*filters)
            # deny > allow for same specificity.
            .order_by(rank.desc(), permission_column.asc(), AccessRule.created_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalars().first()
