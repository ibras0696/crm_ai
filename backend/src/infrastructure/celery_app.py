import sentry_sdk
from celery import Celery
from celery.schedules import crontab
from sentry_sdk.integrations.celery import CeleryIntegration

from src.config import settings

if settings.ENABLE_SENTRY and settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=str(settings.ENVIRONMENT),
        integrations=[CeleryIntegration()],
        traces_sample_rate=0.1,
    )

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
    task_reject_on_worker_lost=True,
    worker_cancel_long_running_tasks_on_connection_loss=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    task_time_limit=300,
    task_soft_time_limit=240,
    result_expires=3600,
    task_default_queue="celery",
    task_default_exchange="celery",
    task_default_routing_key="celery",
    task_default_delivery_mode="persistent",
    broker_connection_retry=True,
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,
    broker_heartbeat=30,
    worker_enable_remote_control=True,
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
        "docs-cleanup-stale-files-daily": {
            "task": "docs_cleanup_stale_files",
            "schedule": crontab(hour=4, minute=0),
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
    [
        "src.modules.notifications",
        "src.modules.schedule",
        "src.modules.billing",
        "src.modules.chat",
        "src.modules.docs",
        "src.modules.tables",
    ]
)
