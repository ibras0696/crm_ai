"""Base Celery task with retry logic."""
from celery import Task
from celery.exceptions import MaxRetriesExceededError
import logging

logger = logging.getLogger(__name__)


class BaseTaskWithRetry(Task):
    """Base task class with automatic retry logic."""
    
    autoretry_for = (Exception,)
    retry_kwargs = {'max_retries': 3}
    retry_backoff = True
    retry_backoff_max = 600
    retry_jitter = True
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Log failed tasks for monitoring."""
        logger.error(
            f"Task {self.name} failed after max retries",
            extra={
                "task_id": task_id,
                "exception": str(exc),
                "args": args,
                "kwargs": kwargs
            }
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)
