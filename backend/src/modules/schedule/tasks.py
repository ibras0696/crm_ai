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
from src.modules.schedule.reminders import (
    build_recurrence_marker,
    iter_occurrences_within_window,
    normalize_simple_recurrence,
    prune_recurrence_markers,
)


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
            offsets = event.reminder_offsets_minutes
            if not offsets:
                continue
            participants = event.participant_ids
            if not participants:
                continue

            recurrence = normalize_simple_recurrence(event.recurrence)
            if recurrence:
                recurring_markers = set(event.recurring_reminder_markers)
                max_offset = max(int(x) for x in offsets)
                occurrences = iter_occurrences_within_window(
                    base_start=event.start_at,
                    recurrence=recurrence,
                    window_start=now - timedelta(minutes=max_offset),
                    window_end=now + timedelta(minutes=max_offset),
                )
                for occurrence_start in occurrences:
                    for offset in offsets:
                        minutes = int(offset)
                        marker = build_recurrence_marker(occurrence_start=occurrence_start, offset_minutes=minutes)
                        if marker in recurring_markers:
                            continue
                        reminder_at = occurrence_start - timedelta(minutes=minutes)
                        if reminder_at <= now <= occurrence_start:
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
                                            "start_at": occurrence_start.isoformat(),
                                            "offset_minutes": minutes,
                                            "is_recurring": True,
                                        },
                                    )
                                )
                                created_notifications += 1
                            recurring_markers.add(marker)
                event.set_meta_fields(recurring_reminder_markers=prune_recurrence_markers(recurring_markers, now=now))
                continue

            if event.recurrence:
                continue

            sent_offsets = set(event.reminder_sent_offsets_minutes)
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
