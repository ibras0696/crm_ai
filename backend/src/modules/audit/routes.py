from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.audit.schemas import AuditLogItem
from src.modules.audit.service import AuditService
from src.modules.auth.dependencies import CurrentUser, require_roles

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/logs", response_model=ApiResponse[list[AuditLogItem]])
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.READONLY)),
):
    """Список логов аудита организации."""
    async with UnitOfWork() as uow:
        repo = AuditRepository(uow.session)
        service = AuditService(repo)
        logs = await service.list_logs(org_id=current_user.org_id, limit=limit, offset=offset)
    return ApiResponse(data=[AuditLogItem.model_validate(log) for log in logs])
