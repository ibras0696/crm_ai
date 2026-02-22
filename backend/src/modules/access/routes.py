from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.database import get_async_session
from src.modules.access.schemas import AccessRuleOut, CreateAccessRuleRequest, UpdateAccessRuleRequest
from src.modules.access.service import AccessService
from src.modules.auth.dependencies import CurrentUser, require_roles

router = APIRouter(prefix="/access", tags=["access"])


@router.get("/rules", response_model=ApiResponse[list[AccessRuleOut]])
async def list_rules(
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Список правил доступа организации (управление доступом)."""
    svc = AccessService(session)
    rows = await svc.list_rules(org_id=current_user.org_id, resource_type=resource_type, resource_id=resource_id)
    items = [AccessRuleOut.model_validate(r) for r in rows]
    return ApiResponse(data=items)


@router.post("/rules", response_model=ApiResponse[AccessRuleOut])
async def create_rule(
    body: CreateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Создать правило доступа."""
    svc = AccessService(session)
    rule = await svc.create_rule(org_id=current_user.org_id, body=body)
    await session.commit()
    return ApiResponse(data=AccessRuleOut.model_validate(rule))


@router.patch("/rules/{rule_id}", response_model=ApiResponse[AccessRuleOut])
async def update_rule(
    rule_id: uuid.UUID,
    body: UpdateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Обновить права в существующем правиле."""
    svc = AccessService(session)
    rule = await svc.update_rule(org_id=current_user.org_id, rule_id=rule_id, body=body)
    await session.commit()
    return ApiResponse(data=AccessRuleOut.model_validate(rule))


@router.delete("/rules/{rule_id}", response_model=ApiResponse[None])
async def delete_rule(
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Удалить правило доступа."""
    svc = AccessService(session)
    await svc.delete_rule(org_id=current_user.org_id, rule_id=rule_id)
    await session.commit()
    return ApiResponse(data=None)

