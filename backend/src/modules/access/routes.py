from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import UserRole
from src.common.exceptions import ConflictError
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
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """List access rules for current organization."""
    svc = AccessService(session)
    rows = await svc.list_rules(
        org_id=current_user.org_id,
        resource_type=resource_type,
        resource_id=resource_id,
        limit=limit,
        offset=offset,
    )
    return ApiResponse(data=[AccessRuleOut.model_validate(r) for r in rows])


@router.post("/rules", response_model=ApiResponse[AccessRuleOut])
async def create_rule(
    body: CreateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Create access rule."""
    svc = AccessService(session)
    try:
        rule = await svc.create_rule(org_id=current_user.org_id, body=body)
        await session.commit()
        return ApiResponse(data=AccessRuleOut.model_validate(rule))
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Конфликт данных при создании правила доступа.") from exc
    except Exception:
        await session.rollback()
        raise


@router.patch("/rules/{rule_id}", response_model=ApiResponse[AccessRuleOut])
async def update_rule(
    rule_id: uuid.UUID,
    body: UpdateAccessRuleRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Update access rule."""
    svc = AccessService(session)
    try:
        rule = await svc.update_rule(org_id=current_user.org_id, rule_id=rule_id, body=body)
        await session.commit()
        return ApiResponse(data=AccessRuleOut.model_validate(rule))
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("Конфликт данных при обновлении правила доступа.") from exc
    except Exception:
        await session.rollback()
        raise


@router.delete("/rules/{rule_id}", response_model=ApiResponse[None])
async def delete_rule(
    rule_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    session: AsyncSession = Depends(get_async_session),
):
    """Delete access rule."""
    svc = AccessService(session)
    try:
        await svc.delete_rule(org_id=current_user.org_id, rule_id=rule_id)
        await session.commit()
        return ApiResponse(data=None)
    except Exception:
        await session.rollback()
        raise
