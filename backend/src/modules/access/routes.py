"""Access control API — OWNER/ADMIN can manage per-resource permissions."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, and_

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.access.models import AccessRule
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/access", tags=["access"])

RESOURCE_TYPES = ["table", "knowledge", "ai", "schedule", "reports"]


class AccessRuleOut(BaseModel):
    id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None
    role: str | None
    user_id: uuid.UUID | None
    can_read: bool
    can_write: bool
    can_delete: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class CreateAccessRuleRequest(BaseModel):
    resource_type: str
    resource_id: uuid.UUID | None = None
    role: str | None = None
    user_id: uuid.UUID | None = None
    can_read: bool = True
    can_write: bool = True
    can_delete: bool = False


class UpdateAccessRuleRequest(BaseModel):
    can_read: bool | None = None
    can_write: bool | None = None
    can_delete: bool | None = None


@router.get("/rules", response_model=ApiResponse[list[AccessRuleOut]])
async def list_rules(
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        stmt = select(AccessRule).where(AccessRule.org_id == current_user.org_id)
        if resource_type:
            stmt = stmt.where(AccessRule.resource_type == resource_type)
        if resource_id:
            stmt = stmt.where(AccessRule.resource_id == resource_id)
        stmt = stmt.order_by(AccessRule.created_at.desc())
        rows = (await uow.session.execute(stmt)).scalars().all()
        items = [AccessRuleOut.model_validate(r) for r in rows]
    return ApiResponse(data=items)


@router.post("/rules", response_model=ApiResponse[AccessRuleOut])
async def create_rule(
    body: CreateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    if body.resource_type not in RESOURCE_TYPES:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_TYPE", "message": f"Тип ресурса должен быть одним из: {', '.join(RESOURCE_TYPES)}"})
    if not body.role and not body.user_id:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_TARGET", "message": "Укажите role или user_id"})

    async with UnitOfWork() as uow:
        rule = AccessRule(
            org_id=current_user.org_id,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            role=body.role,
            user_id=body.user_id,
            can_read=body.can_read,
            can_write=body.can_write,
            can_delete=body.can_delete,
        )
        uow.session.add(rule)
        await uow.session.flush()
        await uow.commit()
        item = AccessRuleOut.model_validate(rule)
    return ApiResponse(data=item)


@router.patch("/rules/{rule_id}", response_model=ApiResponse[AccessRuleOut])
async def update_rule(
    rule_id: uuid.UUID,
    body: UpdateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        rule = await uow.session.get(AccessRule, rule_id)
        if not rule or rule.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Правило не найдено"})
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(rule, field, value)
        await uow.session.flush()
        await uow.commit()
        item = AccessRuleOut.model_validate(rule)
    return ApiResponse(data=item)


@router.delete("/rules/{rule_id}", response_model=ApiResponse[None])
async def delete_rule(
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        rule = await uow.session.get(AccessRule, rule_id)
        if not rule or rule.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Правило не найдено"})
        await uow.session.delete(rule)
        await uow.commit()
    return ApiResponse(data=None)


async def check_access(org_id: uuid.UUID, user_id: uuid.UUID, user_role: str, resource_type: str, resource_id: uuid.UUID | None = None, permission: str = "can_read") -> bool:
    """Check if user has permission for a resource. OWNER/ADMIN always have full access."""
    if user_role in (UserRole.OWNER, UserRole.ADMIN):
        return True

    async with UnitOfWork() as uow:
        # Check specific resource rules first, then type-wide rules
        conditions = [
            AccessRule.org_id == org_id,
            AccessRule.resource_type == resource_type,
        ]

        # Match by user_id or role
        user_or_role = [
            and_(AccessRule.user_id == user_id),
            and_(AccessRule.role == user_role),
        ]

        if resource_id:
            # Check specific resource first
            stmt = select(AccessRule).where(
                *conditions,
                AccessRule.resource_id == resource_id,
            ).where(AccessRule.user_id == user_id)
            result = (await uow.session.execute(stmt)).scalar_one_or_none()
            if result:
                return getattr(result, permission, False)

            # Check role-based for specific resource
            stmt = select(AccessRule).where(
                *conditions,
                AccessRule.resource_id == resource_id,
                AccessRule.role == user_role,
            )
            result = (await uow.session.execute(stmt)).scalar_one_or_none()
            if result:
                return getattr(result, permission, False)

        # Check type-wide rules (resource_id is null)
        stmt = select(AccessRule).where(
            *conditions,
            AccessRule.resource_id.is_(None),
            AccessRule.user_id == user_id,
        )
        result = (await uow.session.execute(stmt)).scalar_one_or_none()
        if result:
            return getattr(result, permission, False)

        stmt = select(AccessRule).where(
            *conditions,
            AccessRule.resource_id.is_(None),
            AccessRule.role == user_role,
        )
        result = (await uow.session.execute(stmt)).scalar_one_or_none()
        if result:
            return getattr(result, permission, False)

    # No rules found — default: allow (backwards compatible)
    return True
