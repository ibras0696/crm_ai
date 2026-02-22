from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import UserRole
from src.modules.access.models import AccessRule


PERMISSION_FIELDS = {"can_read", "can_write", "can_delete"}


async def org_has_access_rules(session: AsyncSession, org_id: uuid.UUID, resource_type: str) -> bool:
    cnt = (
        await session.execute(
            select(func.count(AccessRule.id)).where(
                AccessRule.org_id == org_id,
                AccessRule.resource_type == resource_type,
            )
        )
    ).scalar_one()
    return int(cnt or 0) > 0


async def check_access(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    user_role: str,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
    permission: str = "can_read",
    enforce_if_rules_exist: bool = True,
) -> bool:
    """
    Fine-grained access control.

    Policy:
    - OWNER/ADMIN always allowed.
    - If enforce_if_rules_exist=True:
      - If the org has no rules for this resource_type, allow (backwards compatible).
      - If the org has at least one rule for this resource_type, then default is DENY
        unless a matching rule explicitly grants permission.
    """
    if permission not in PERMISSION_FIELDS:
        raise ValueError("invalid_permission")

    if user_role in (UserRole.OWNER.value, UserRole.ADMIN.value):
        return True

    if enforce_if_rules_exist:
        any_rules = (
            await session.execute(
                select(func.count(AccessRule.id)).where(
                    AccessRule.org_id == org_id,
                    AccessRule.resource_type == resource_type,
                )
            )
        ).scalar_one()
        if int(any_rules or 0) == 0:
            return True

    base = [
        AccessRule.org_id == org_id,
        AccessRule.resource_type == resource_type,
    ]

    # Specific resource rules (prefer user-specific over role-specific)
    if resource_id is not None:
        stmt = select(AccessRule).where(*base, AccessRule.resource_id == resource_id, AccessRule.user_id == user_id)
        r = (await session.execute(stmt)).scalar_one_or_none()
        if r is not None:
            return bool(getattr(r, permission, False))

        stmt = select(AccessRule).where(*base, AccessRule.resource_id == resource_id, AccessRule.role == user_role)
        r = (await session.execute(stmt)).scalar_one_or_none()
        if r is not None:
            return bool(getattr(r, permission, False))

    # Type-wide rules (resource_id is NULL)
    stmt = select(AccessRule).where(*base, AccessRule.resource_id.is_(None), AccessRule.user_id == user_id)
    r = (await session.execute(stmt)).scalar_one_or_none()
    if r is not None:
        return bool(getattr(r, permission, False))

    stmt = select(AccessRule).where(*base, AccessRule.resource_id.is_(None), AccessRule.role == user_role)
    r = (await session.execute(stmt)).scalar_one_or_none()
    if r is not None:
        return bool(getattr(r, permission, False))

    # Default deny if rules exist for that type, else allow already returned above.
    return False
