"""Service layer for schedule module."""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.schedule.models import Event
from src.modules.schedule.repository import ScheduleRepository
from src.modules.schedule.schemas import CreateEventRequest, UpdateEventRequest


class ScheduleService:
    """Application service for schedule module."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ScheduleRepository(session)

    async def create_event(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: CreateEventRequest,
    ) -> Event:
        """Create new event."""
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
        return await self.repo.create(event)

    async def list_events(
        self,
        *,
        org_id: uuid.UUID,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[Event]:
        """List events with optional date range."""
        return await self.repo.list_events(org_id=org_id, start=start, end=end)

    async def get_event_by_id(self, *, event_id: uuid.UUID, org_id: uuid.UUID) -> Event | None:
        """Get event by id in organization scope."""
        return await self.repo.get_by_id_for_org(event_id=event_id, org_id=org_id)

    async def update_event(self, *, event: Event, body: UpdateEventRequest) -> Event:
        """Update event fields."""
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(event, field, value)
        await self.session.flush()
        return event

    async def delete_event(self, *, event: Event) -> None:
        """Delete event."""
        await self.repo.delete(event)
