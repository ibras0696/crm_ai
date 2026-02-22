"""Service layer for schedule module."""

import uuid
from datetime import datetime

from sqlalchemy import or_, select

from src.infrastructure.uow import UnitOfWork
from src.modules.schedule.models import Event
from src.modules.schedule.schemas import CreateEventRequest, UpdateEventRequest


async def create_event(
    uow: UnitOfWork,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    body: CreateEventRequest,
) -> Event:
    event = Event(
        org_id=org_id,
        created_by=user_id,
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
    return event


async def list_events(
    uow: UnitOfWork,
    *,
    org_id: uuid.UUID,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[Event]:
    stmt = select(Event).where(Event.org_id == org_id)

    # If range is provided, we must include recurring events that started earlier,
    # otherwise UI won't be able to expand them into occurrences for the range.
    if start and end:
        stmt = stmt.where(
            or_(
                Event.start_at.between(start, end),
                (Event.recurrence.is_not(None) & (Event.start_at <= end)),
            )
        )
    elif start:
        stmt = stmt.where(or_(Event.start_at >= start, Event.recurrence.is_not(None)))
    elif end:
        stmt = stmt.where(Event.start_at <= end)

    stmt = stmt.order_by(Event.start_at)
    result = await uow.session.execute(stmt)
    return list(result.scalars().all())


async def get_event_by_id(
    uow: UnitOfWork,
    *,
    event_id: uuid.UUID,
    org_id: uuid.UUID,
) -> Event | None:
    event = await uow.session.get(Event, event_id)
    if not event or event.org_id != org_id:
        return None
    return event


async def update_event(
    uow: UnitOfWork,
    *,
    event: Event,
    body: UpdateEventRequest,
) -> Event:
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    await uow.session.flush()
    return event


async def delete_event(uow: UnitOfWork, *, event: Event) -> None:
    await uow.session.delete(event)
