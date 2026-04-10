"""Schedule routes: events CRUD with optional date range queries."""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.schedule.schemas import (
    CreateEventRequest,
    DispatchRemindersOut,
    DispatchRemindersRequest,
    EventOut,
    UpdateEventRequest,
)
from src.modules.schedule.service import ScheduleService, ScheduleServiceError

router = APIRouter(prefix="/schedule", tags=["schedule"])

EVENT_NOT_FOUND_MESSAGE = "Событие не найдено"


def _service_error(error: ScheduleServiceError) -> ApiResponse[None]:
    return ApiResponse(
        ok=False,
        data=None,
        error={"code": error.code, "message": error.message},
    )


@router.post("/events", response_model=ApiResponse[EventOut])
async def create_event(
    body: CreateEventRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="schedule", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        try:
            event = await service.create_event(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                body=body,
            )
        except ScheduleServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = EventOut.model_validate(event)
    return ApiResponse(data=item)


@router.get("/events", response_model=ApiResponse[list[EventOut]])
async def list_events(
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="schedule", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        events = await service.list_events(
            org_id=current_user.org_id,
            start=start,
            end=end,
            viewer_user_id=current_user.user_id,
            viewer_role=current_user.role,
        )
        items = [EventOut.model_validate(event) for event in events]
    return ApiResponse(data=items)


@router.get("/events/{event_id}", response_model=ApiResponse[EventOut])
async def get_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="schedule", permission="can_read", resource_id_param="event_id")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        event = await service.get_event_by_id(event_id=event_id, org_id=current_user.org_id)
        has_access = event is not None and service.can_user_access_event(
            event,
            user_id=current_user.user_id,
            role=current_user.role,
        )
        if not has_access:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": EVENT_NOT_FOUND_MESSAGE})
        item = EventOut.model_validate(event)
    return ApiResponse(data=item)


@router.patch("/events/{event_id}", response_model=ApiResponse[EventOut])
async def update_event(
    event_id: uuid.UUID,
    body: UpdateEventRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="schedule", permission="can_write", resource_id_param="event_id")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        event = await service.get_event_by_id(event_id=event_id, org_id=current_user.org_id)
        has_access = event is not None and service.can_user_access_event(
            event,
            user_id=current_user.user_id,
            role=current_user.role,
        )
        if not has_access:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": EVENT_NOT_FOUND_MESSAGE})
        try:
            updated = await service.update_event(event=event, body=body)
        except ScheduleServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = EventOut.model_validate(updated)
    return ApiResponse(data=item)


@router.delete("/events/{event_id}", response_model=ApiResponse[None])
async def delete_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="schedule", permission="can_delete", resource_id_param="event_id")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        event = await service.get_event_by_id(event_id=event_id, org_id=current_user.org_id)
        has_access = event is not None and service.can_user_access_event(
            event,
            user_id=current_user.user_id,
            role=current_user.role,
        )
        if not has_access:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": EVENT_NOT_FOUND_MESSAGE})
        await service.delete_event(event=event)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/events/dispatch-reminders", response_model=ApiResponse[DispatchRemindersOut])
async def dispatch_reminders(
    body: DispatchRemindersRequest,
    _current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="schedule", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = ScheduleService(uow.session)
        created = await service.dispatch_due_reminders(now=body.now)
        await uow.commit()
    return ApiResponse(data=DispatchRemindersOut(created_notifications=created))
