"""Schedule: events CRUD with date range queries."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, and_

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.schedule.models import Event
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/schedule", tags=["schedule"])


class EventOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool
    color: str | None
    is_done: bool
    recurrence: str | None
    assigned_to: uuid.UUID | None
    created_at: datetime
    model_config = {"from_attributes": True}


class CreateEventRequest(BaseModel):
    title: str
    description: str | None = None
    start_at: datetime
    end_at: datetime | None = None
    all_day: bool = False
    color: str | None = None
    assigned_to: uuid.UUID | None = None
    recurrence: str | None = None  # daily|weekly|monthly|yearly


class UpdateEventRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    color: str | None = None
    is_done: bool | None = None
    assigned_to: uuid.UUID | None = None
    recurrence: str | None = None


@router.post("/events", response_model=ApiResponse[EventOut])
async def create_event(
    body: CreateEventRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        event = Event(
            org_id=current_user.org_id,
            created_by=current_user.user_id,
            title=body.title,
            description=body.description,
            start_at=body.start_at,
            end_at=body.end_at,
            all_day=body.all_day,
            color=body.color,
            assigned_to=body.assigned_to,
            recurrence=body.recurrence,
        )
        uow.session.add(event)
        await uow.session.flush()
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
        stmt = select(Event).where(Event.org_id == current_user.org_id).order_by(Event.start_at)
        if start:
            stmt = stmt.where(Event.start_at >= start)
        if end:
            stmt = stmt.where(Event.start_at <= end)
        result = await uow.session.execute(stmt)
        events = list(result.scalars().all())
        items = [EventOut.model_validate(e) for e in events]
    return ApiResponse(data=items)


@router.get("/events/{event_id}", response_model=ApiResponse[EventOut])
async def get_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        event = await uow.session.get(Event, event_id)
        if not event or event.org_id != current_user.org_id:
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
        event = await uow.session.get(Event, event_id)
        if not event or event.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Событие не найдено"})
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(event, field, value)
        await uow.session.flush()
        await uow.commit()
        item = EventOut.model_validate(event)
    return ApiResponse(data=item)


@router.delete("/events/{event_id}", response_model=ApiResponse[None])
async def delete_event(
    event_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        event = await uow.session.get(Event, event_id)
        if not event or event.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Событие не найдено"})
        await uow.session.delete(event)
        await uow.commit()
    return ApiResponse(data=None)
