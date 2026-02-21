"""Schedule routes: events CRUD with optional date range queries."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.schedule.schemas import CreateEventRequest, EventOut, UpdateEventRequest
from src.modules.schedule.service import (
    create_event as create_event_service,
    delete_event as delete_event_service,
    get_event_by_id,
    list_events as list_events_service,
    update_event as update_event_service,
)

router = APIRouter(prefix="/schedule", tags=["schedule"])


@router.post("/events", response_model=ApiResponse[EventOut])
async def create_event(
    body: CreateEventRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        event = await create_event_service(
            uow,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            body=body,
        )
        await uow.commit()
        item = EventOut.model_validate(event)
    return ApiResponse(data=item)


@router.get("/events", response_model=ApiResponse[list[EventOut]])
async def list_events(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        events = await list_events_service(uow, org_id=current_user.org_id, start=start, end=end)
        items = [EventOut.model_validate(e) for e in events]
    return ApiResponse(data=items)


@router.get("/events/{event_id}", response_model=ApiResponse[EventOut])
async def get_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        event = await get_event_by_id(uow, event_id=event_id, org_id=current_user.org_id)
        if not event:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Событие не найдено"})
        item = EventOut.model_validate(event)
    return ApiResponse(data=item)


@router.patch("/events/{event_id}", response_model=ApiResponse[EventOut])
async def update_event(
    event_id: uuid.UUID,
    body: UpdateEventRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        event = await get_event_by_id(uow, event_id=event_id, org_id=current_user.org_id)
        if not event:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Событие не найдено"})
        updated = await update_event_service(uow, event=event, body=body)
        await uow.commit()
        item = EventOut.model_validate(updated)
    return ApiResponse(data=item)


@router.delete("/events/{event_id}", response_model=ApiResponse[None])
async def delete_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        event = await get_event_by_id(uow, event_id=event_id, org_id=current_user.org_id)
        if not event:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Событие не найдено"})
        await delete_event_service(uow, event=event)
        await uow.commit()
    return ApiResponse(data=None)
