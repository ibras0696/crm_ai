"""Celery tasks for billing lifecycle (sync DB variant for workers)."""

from datetime import UTC, datetime

from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.modules.billing.service_sync import BillingServiceSync


@celery.task(name="process_billing_lifecycle", bind=True, base=BaseTaskWithRetry)
def process_billing_lifecycle(self) -> dict[str, int]:
    _ = self
    with sync_session_factory() as session:
        service = BillingServiceSync(session)
        return service.process_subscription_lifecycle(now=datetime.now(UTC))
