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
    worker_prefetch_multiplier=4,
    worker_max_tasks_per_child=1000,
    task_time_limit=300,
    task_soft_time_limit=240,
    result_expires=3600,
    task_routes={
        'send_critical_email': {'queue': 'high', 'priority': 10},
        'send_notification': {'queue': 'default', 'priority': 5},
        'send_bulk_email': {'queue': 'low', 'priority': 1},
    },
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
        "create-monthly-partition": {
            "task": "create_monthly_partition",
            "schedule": crontab(day_of_month=1, hour=0, minute=0),
        },
        "archive-old-records-monthly": {
            "task": "archive_old_records",
            "schedule": crontab(day_of_month=1, hour=2, minute=0),
        },
        "cleanup-soft-deleted-weekly": {
            "task": "cleanup_soft_deleted_records",
            "schedule": crontab(day_of_week=0, hour=3, minute=0),
        },
    },
)

celery.autodiscover_tasks(
    ["src.modules.notifications", "src.modules.schedule", "src.modules.billing", "src.modules.docs", "src.modules.tables"]
)
