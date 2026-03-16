"""Celery tasks for schedule reminders (sync DB variant for workers)."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from src.common.enums import NotificationStatus, NotificationType
from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.modules.notifications.models import Notification
from src.modules.schedule.models import Event


@celery.task(name="dispatch_schedule_reminders", bind=True, base=BaseTaskWithRetry)
def dispatch_schedule_reminders(self) -> dict:
    _ = self
    now = datetime.now(UTC)
    created_notifications = 0

    with sync_session_factory() as session:
        stmt = (
            select(Event)
            .where(
                Event.start_at >= now - timedelta(days=1),
                Event.start_at <= now + timedelta(minutes=1440),
                Event.is_done.is_(False),
            )
            .order_by(Event.start_at)
        )
        events = list(session.execute(stmt).scalars().all())

        for event in events:
            if event.recurrence:
                continue
            offsets = event.reminder_offsets_minutes
            if not offsets:
                continue
            sent_offsets = set(event.reminder_sent_offsets_minutes)
            participants = event.participant_ids
            if not participants:
                continue

            for offset in offsets:
                minutes = int(offset)
                if minutes in sent_offsets:
                    continue
                reminder_at = event.start_at - timedelta(minutes=minutes)
                if reminder_at <= now <= event.start_at:
                    for user_id in participants:
                        session.add(
                            Notification(
                                org_id=event.org_id,
                                user_id=UUID(str(user_id)),
                                type=NotificationType.IN_APP,
                                status=NotificationStatus.PENDING,
                                title=f"Скоро событие: {event.title}",
                                body=_build_reminder_text(minutes),
                                meta={
                                    "event_id": str(event.id),
                                    "start_at": event.start_at.isoformat(),
                                    "offset_minutes": minutes,
                                },
                            )
                        )
                        created_notifications += 1
                    sent_offsets.add(minutes)
                    event.set_meta_fields(reminder_sent_offsets_minutes=sorted(sent_offsets))

        session.commit()

    return {"created_notifications": created_notifications}


def _build_reminder_text(offset_minutes: int) -> str:
    if offset_minutes >= 1440:
        days = offset_minutes // 1440
        return f"Напоминание: событие начнется через {days} дн."
    if offset_minutes >= 60:
        hours = offset_minutes // 60
        return f"Напоминание: событие начнется через {hours} ч."
    return f"Напоминание: событие начнется через {offset_minutes} мин."
