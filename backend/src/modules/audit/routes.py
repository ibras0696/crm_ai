from fastapi import APIRouter, Depends, Query

from src.common.schemas import ApiResponse
from src.modules.audit.models import AuditLog
from src.modules.audit.repository import AuditRepository
from src.modules.auth.dependencies import CurrentUser, require_org, require_roles
from src.common.enums import UserRole
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditLogResponse:
    pass


from pydantic import BaseModel
import uuid
from datetime import datetime


class AuditLogItem(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    meta: dict | None
    ip_address: str | None
    correlation_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/logs", response_model=ApiResponse[list[AuditLogItem]])
async def list_audit_logs(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        repo = AuditRepository(uow.session)
        logs = await repo.list_by_org(current_user.org_id, limit=limit, offset=offset)
        items = [AuditLogItem.model_validate(log) for log in logs]
    return ApiResponse(data=items)
