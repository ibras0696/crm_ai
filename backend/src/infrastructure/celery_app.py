from celery import Celery
from celery.schedules import crontab

from src.config import settings

celery = Celery(
    "crm_platform",
    broker=settings.RABBITMQ_URL,
    backend=settings.REDIS_URL,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "dispatch-schedule-reminders-every-minute": {
            "task": "dispatch_schedule_reminders",
            "schedule": crontab(minute="*"),
        },
        "billing-lifecycle-every-hour": {
            "task": "process_billing_lifecycle",
            "schedule": crontab(minute=0),
        },
        "docs-retention-cleanup-daily": {
            "task": "docs_cleanup_old_versions",
            "schedule": crontab(hour=3, minute=20),
        },
    },
)

celery.autodiscover_tasks(
    ["src.modules.notifications", "src.modules.schedule", "src.modules.billing", "src.modules.docs"]
)
