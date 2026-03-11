"""Service layer for schedule module."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import NotificationStatus, NotificationType
from src.modules.notifications.models import Notification
from src.modules.schedule.errors import ScheduleModuleError
from src.modules.schedule.models import Event
from src.modules.schedule.repository import ScheduleRepository
from src.modules.schedule.schemas import CreateEventRequest, UpdateEventRequest


class ScheduleServiceError(ScheduleModuleError):
    def __init__(self, *, code: str, message: str):
        super().__init__(code=code, message=message, status_code=422)


class ScheduleService:
    """Application service for schedule module."""

    MAX_EVENTS_PER_DAY = 10
    ALLOWED_REMINDER_OFFSETS_MINUTES = (60, 120, 1440)

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
        await self._validate_event_payload(
            org_id=org_id,
            event_id=None,
            start_at=body.start_at,
            end_at=body.end_at,
            participant_ids=body.participant_ids,
            reminder_offsets_minutes=body.reminder_offsets_minutes,
            assigned_to=body.assigned_to,
        )

        participant_ids = await self._resolve_participants(
            org_id=org_id,
            created_by=user_id,
            participant_ids=body.participant_ids,
            assigned_to=body.assigned_to,
        )
        reminder_offsets = self._normalize_reminder_offsets(body.reminder_offsets_minutes)

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
        event.set_meta_fields(
            participant_ids=participant_ids,
            reminder_offsets_minutes=reminder_offsets,
            reminder_sent_offsets_minutes=[],
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
        updates = body.model_dump(exclude_unset=True)

        next_start_at = updates.get("start_at", event.start_at)
        next_end_at = updates.get("end_at", event.end_at)
        next_assigned_to = updates.get("assigned_to", event.assigned_to)
        next_participants_payload = updates.get("participant_ids")
        next_reminders_payload = updates.get("reminder_offsets_minutes")

        await self._validate_event_payload(
            org_id=event.org_id,
            event_id=event.id,
            start_at=next_start_at,
            end_at=next_end_at,
            participant_ids=next_participants_payload,
            reminder_offsets_minutes=next_reminders_payload,
            assigned_to=next_assigned_to,
        )

        for field, value in updates.items():
            if field in ("participant_ids", "reminder_offsets_minutes"):
                continue
            setattr(event, field, value)

        if "participant_ids" in updates or "assigned_to" in updates:
            participants = await self._resolve_participants(
                org_id=event.org_id,
                created_by=event.created_by,
                participant_ids=next_participants_payload if "participant_ids" in updates else event.participant_ids,
                assigned_to=next_assigned_to,
            )
            event.set_meta_fields(participant_ids=participants)

        if "reminder_offsets_minutes" in updates:
            reminders = self._normalize_reminder_offsets(next_reminders_payload)
            event.set_meta_fields(
                reminder_offsets_minutes=reminders,
                reminder_sent_offsets_minutes=[],
            )

        if "start_at" in updates:
            event.set_meta_fields(reminder_sent_offsets_minutes=[])

        await self.session.flush()
        return event

    async def delete_event(self, *, event: Event) -> None:
        """Delete event."""
        await self.repo.delete(event)

    async def dispatch_due_reminders(self, *, now: datetime | None = None) -> int:
        target_now = now or datetime.now(UTC)
        if target_now.tzinfo is None:
            target_now = target_now.replace(tzinfo=UTC)

        events = await self.repo.list_due_for_reminders(
            now=target_now, horizon_minutes=max(self.ALLOWED_REMINDER_OFFSETS_MINUTES)
        )
        created_notifications = 0

        for event in events:
            if event.recurrence:
                # Пока напоминания поддерживаются только для базовых (не виртуальных) событий.
                continue

            offsets = event.reminder_offsets_minutes
            if not offsets:
                continue
            sent_offsets = set(event.reminder_sent_offsets_minutes)
            participants = event.participant_ids
            if not participants:
                continue

            for offset in offsets:
                if offset in sent_offsets:
                    continue
                reminder_at = event.start_at - timedelta(minutes=offset)
                if reminder_at <= target_now <= event.start_at:
                    for user_id in participants:
                        self.session.add(
                            Notification(
                                org_id=event.org_id,
                                user_id=user_id,
                                type=NotificationType.IN_APP,
                                status=NotificationStatus.PENDING,
                                title=f"Скоро событие: {event.title}",
                                body=self._build_reminder_text(offset),
                                meta={
                                    "event_id": str(event.id),
                                    "start_at": event.start_at.isoformat(),
                                    "offset_minutes": offset,
                                },
                            )
                        )
                        created_notifications += 1
                    sent_offsets.add(offset)
                    event.set_meta_fields(reminder_sent_offsets_minutes=sorted(sent_offsets))

        await self.session.flush()
        return created_notifications

    async def _validate_event_payload(
        self,
        *,
        org_id: uuid.UUID,
        event_id: uuid.UUID | None,
        start_at: datetime | None,
        end_at: datetime | None,
        participant_ids: list[uuid.UUID] | None,
        reminder_offsets_minutes: list[int] | None,
        assigned_to: uuid.UUID | None,
    ) -> None:
        if start_at is None:
            raise ScheduleServiceError(code="VALIDATION_ERROR", message="start_at обязателен")
        if end_at is not None and end_at < start_at:
            raise ScheduleServiceError(code="VALIDATION_ERROR", message="Время окончания не может быть раньше начала")

        day_start, day_end = self._day_bounds_utc(start_at)
        day_count = await self.repo.count_events_in_day(
            org_id=org_id,
            day_start=day_start,
            day_end=day_end,
            exclude_event_id=event_id,
        )
        if day_count >= self.MAX_EVENTS_PER_DAY:
            raise ScheduleServiceError(
                code="DAY_LIMIT_EXCEEDED",
                message="Лимит: не более 10 событий в один день",
            )

        if participant_ids is not None:
            await self._ensure_users_in_org(org_id=org_id, user_ids=participant_ids)
        if assigned_to is not None:
            await self._ensure_users_in_org(org_id=org_id, user_ids=[assigned_to])
        if reminder_offsets_minutes is not None:
            self._normalize_reminder_offsets(reminder_offsets_minutes)

    async def _ensure_users_in_org(self, *, org_id: uuid.UUID, user_ids: list[uuid.UUID]) -> None:
        unique_ids = set(user_ids)
        if not unique_ids:
            return
        existing = await self.repo.list_existing_org_users(org_id=org_id, user_ids=list(unique_ids))
        missing = unique_ids - existing
        if missing:
            raise ScheduleServiceError(code="INVALID_PARTICIPANT", message="Выбранный участник не найден в организации")

    async def _resolve_participants(
        self,
        *,
        org_id: uuid.UUID,
        created_by: uuid.UUID | None,
        participant_ids: list[uuid.UUID] | None,
        assigned_to: uuid.UUID | None,
    ) -> list[uuid.UUID]:
        raw: list[uuid.UUID] = list(participant_ids or [])
        if assigned_to is not None:
            raw.append(assigned_to)
        if created_by is not None:
            raw.append(created_by)
        # Preserve order, remove duplicates
        unique: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for uid in raw:
            if uid in seen:
                continue
            seen.add(uid)
            unique.append(uid)

        await self._ensure_users_in_org(org_id=org_id, user_ids=unique)
        return unique

    def _normalize_reminder_offsets(self, offsets: list[int] | None) -> list[int]:
        if not offsets:
            return []
        cleaned = sorted({int(x) for x in offsets})
        for value in cleaned:
            if value not in self.ALLOWED_REMINDER_OFFSETS_MINUTES:
                raise ScheduleServiceError(
                    code="INVALID_REMINDER_OFFSET",
                    message="Допустимые напоминания: за 1 час, 2 часа или 1 день",
                )
        return cleaned

    @staticmethod
    def _day_bounds_utc(dt: datetime) -> tuple[datetime, datetime]:
        target = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
        day_start = datetime(target.year, target.month, target.day, tzinfo=UTC)
        day_end = day_start + timedelta(days=1)
        return day_start, day_end

    @staticmethod
    def _build_reminder_text(offset: int) -> str:
        if offset == 60:
            return "Событие начнется через 1 час"
        if offset == 120:
            return "Событие начнется через 2 часа"
        return "Событие начнется через 1 день"
