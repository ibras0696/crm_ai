"""Celery tasks for schedule reminders."""
import asyncio
from datetime import UTC, datetime

from src.infrastructure.celery_app import celery
from src.infrastructure.uow import UnitOfWork
from src.modules.schedule.service import ScheduleService


@celery.task(name="dispatch_schedule_reminders")
def dispatch_schedule_reminders() -> dict:
    async def _run() -> int:
        async with UnitOfWork() as uow:
            service = ScheduleService(uow.session)
            created = await service.dispatch_due_reminders(now=datetime.now(UTC))
            await uow.commit()
            return created

    created_notifications = asyncio.run(_run())
    return {"created_notifications": created_notifications}
