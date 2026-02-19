import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.common.schemas import ApiResponse
from src.common.enums import NotificationStatus, NotificationType
from src.modules.auth.dependencies import CurrentUser, get_current_user
from src.modules.notifications.models import Notification
from src.modules.notifications.repository import NotificationRepository
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationItem(BaseModel):
    id: uuid.UUID
    title: str
    body: str | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCount(BaseModel):
    count: int


@router.get("/", response_model=ApiResponse[list[NotificationItem]])
async def list_notifications(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        repo = NotificationRepository(uow.session)
        notifs = await repo.list_by_user(current_user.user_id, current_user.org_id, limit=limit, offset=offset)
        items = [NotificationItem.model_validate(n) for n in notifs]
    return ApiResponse(data=items)


@router.get("/unread-count", response_model=ApiResponse[UnreadCount])
async def unread_count(
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        repo = NotificationRepository(uow.session)
        count = await repo.count_unread(current_user.user_id, current_user.org_id)
    return ApiResponse(data=UnreadCount(count=count))


@router.post("/{notif_id}/read", response_model=ApiResponse[None])
async def mark_read(
    notif_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        repo = NotificationRepository(uow.session)
        ok = await repo.mark_read(notif_id, current_user.user_id)
        await uow.commit()
    if not ok:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Уведомление не найдено"})
    return ApiResponse(data=None)


@router.post("/read-all", response_model=ApiResponse[None])
async def mark_all_read(
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        repo = NotificationRepository(uow.session)
        await repo.mark_all_read(current_user.user_id, current_user.org_id)
        await uow.commit()
    return ApiResponse(data=None)
