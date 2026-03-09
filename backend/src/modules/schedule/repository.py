import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.org.models import Membership
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

    async def count_events_in_day(
        self, *, org_id: uuid.UUID, day_start: datetime, day_end: datetime, exclude_event_id: uuid.UUID | None = None
    ) -> int:
        stmt = select(func.count(Event.id)).where(
            Event.org_id == org_id,
            Event.start_at >= day_start,
            Event.start_at < day_end,
        )
        if exclude_event_id is not None:
            stmt = stmt.where(Event.id != exclude_event_id)
        result = await self.session.execute(stmt)
        return int(result.scalar() or 0)

    async def list_due_for_reminders(self, *, now: datetime, horizon_minutes: int = 1440) -> list[Event]:
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        end = now + timedelta(minutes=horizon_minutes)
        stmt = (
            select(Event)
            .where(
                Event.start_at >= now - timedelta(days=1),
                Event.start_at <= end,
                Event.is_done.is_(False),
            )
            .order_by(Event.start_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_existing_org_users(self, *, org_id: uuid.UUID, user_ids: list[uuid.UUID]) -> set[uuid.UUID]:
        if not user_ids:
            return set()
        stmt = select(Membership.user_id).where(
            Membership.org_id == org_id,
            Membership.user_id.in_(user_ids),
        )
        result = await self.session.execute(stmt)
        return {row[0] for row in result.all()}

    async def delete(self, event: Event) -> None:
        """Delete event row."""
        await self.session.delete(event)
        await self.session.flush()
