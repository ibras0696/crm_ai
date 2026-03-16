"""Base Celery task with retry logic."""

import logging
from typing import ClassVar

from celery import Task

from src.infrastructure.task_logging import log_task_failure

logger = logging.getLogger(__name__)


class BaseTaskWithRetry(Task):
    """Base task class with automatic retry logic."""

    autoretry_for = (Exception,)
    retry_kwargs: ClassVar[dict[str, int]] = {"max_retries": 3}
    retry_backoff = True
    retry_backoff_max = 600
    retry_jitter = True

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Log failed tasks for monitoring."""
        log_task_failure(
            logger,
            task_name=self.name,
            task_id=task_id,
            task_args=args,
            task_kwargs=kwargs,
            exc=exc,
            einfo=einfo,
            message="Background task failed after retries",
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)
