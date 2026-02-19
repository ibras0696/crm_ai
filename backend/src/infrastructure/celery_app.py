from celery import Celery

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
    beat_schedule={},
)

celery.autodiscover_tasks(["src.modules.notifications.tasks"])
