"""Reports V2 endpoints (versioned, non-breaking for v1 clients)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.reports.schemas_v2 import (
    AnalyticsSemanticSchemaOut,
    UnifiedPreviewOut,
    UnifiedPreviewRequest,
)
from src.modules.reports.service import ReportsService

router = APIRouter(prefix="/reports/v2", tags=["reports"])

TABLE_NOT_FOUND_MESSAGE = "Таблица не найдена"
PREVIEW_NOT_FOUND_MESSAGE = "Данные для превью не найдены"


@router.get("/tables/{table_id}/semantic-schema", response_model=ApiResponse[AnalyticsSemanticSchemaOut])
async def semantic_schema(
    table_id: str,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    try:
        parsed_table_id = uuid.UUID(table_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": TABLE_NOT_FOUND_MESSAGE})
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        response = await service.semantic_schema(org_id=current_user.org_id, table_id=parsed_table_id)
        if response is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": TABLE_NOT_FOUND_MESSAGE})
    return ApiResponse(data=response)


@router.post("/unified-preview", response_model=ApiResponse[UnifiedPreviewOut])
async def unified_preview(
    body: UnifiedPreviewRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        response = await service.unified_preview(org_id=current_user.org_id, body=body)
        if response is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": PREVIEW_NOT_FOUND_MESSAGE})
    return ApiResponse(data=response)
