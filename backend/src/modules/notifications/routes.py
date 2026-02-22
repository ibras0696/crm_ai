import uuid

from fastapi import APIRouter, Depends, Query

from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, get_current_user
from src.modules.notifications.schemas import NotificationItem, UnreadCount
from src.modules.notifications.service import NotificationsService

router = APIRouter(prefix="/notifications", tags=["notifications"])

NOTIFICATION_NOT_FOUND_MESSAGE = "Уведомление не найдено"


@router.get("/", response_model=ApiResponse[list[NotificationItem]])
async def list_notifications(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        service = NotificationsService(uow.session)
        notifications = await service.list_notifications(
            user_id=current_user.user_id,
            org_id=current_user.org_id,
            limit=limit,
            offset=offset,
        )
        items = [NotificationItem.model_validate(notification) for notification in notifications]
    return ApiResponse(data=items)


@router.get("/unread-count", response_model=ApiResponse[UnreadCount])
async def unread_count(current_user: CurrentUser = Depends(get_current_user)):
    async with UnitOfWork() as uow:
        service = NotificationsService(uow.session)
        count = await service.unread_count(user_id=current_user.user_id, org_id=current_user.org_id)
    return ApiResponse(data=UnreadCount(count=count))


@router.post("/{notif_id}/read", response_model=ApiResponse[None])
async def mark_read(
    notif_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
):
    async with UnitOfWork() as uow:
        service = NotificationsService(uow.session)
        ok = await service.mark_read(notif_id=notif_id, user_id=current_user.user_id, org_id=current_user.org_id)
        await uow.commit()
    if not ok:
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "NOT_FOUND", "message": NOTIFICATION_NOT_FOUND_MESSAGE},
        )
    return ApiResponse(data=None)


@router.post("/read-all", response_model=ApiResponse[None])
async def mark_all_read(current_user: CurrentUser = Depends(get_current_user)):
    async with UnitOfWork() as uow:
        service = NotificationsService(uow.session)
        await service.mark_all_read(user_id=current_user.user_id, org_id=current_user.org_id)
        await uow.commit()
    return ApiResponse(data=None)
