import uuid
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.schedule.models import Event


class ScheduleRepository:
    """Repository for schedule module SQL operations."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, event: Event) -> Event:
        """Create event row."""
        self.session.add(event)
        await self.session.flush()
        return event

    async def list_events(
        self,
        *,
        org_id: uuid.UUID,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[Event]:
        """List organization events with optional date range."""
        stmt = select(Event).where(Event.org_id == org_id)

        if start and end:
            stmt = stmt.where(
                or_(
                    Event.start_at.between(start, end),
                    (Event.recurrence.is_not(None) & (Event.start_at <= end)),
                ),
            )
        elif start:
            stmt = stmt.where(or_(Event.start_at >= start, Event.recurrence.is_not(None)))
        elif end:
            stmt = stmt.where(Event.start_at <= end)

        stmt = stmt.order_by(Event.start_at)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id_for_org(self, *, event_id: uuid.UUID, org_id: uuid.UUID) -> Event | None:
        """Get event by id constrained by organization."""
        stmt = select(Event).where(Event.id == event_id, Event.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete(self, event: Event) -> None:
        """Delete event row."""
        await self.session.delete(event)
        await self.session.flush()
