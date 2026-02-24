"""Celery tasks for billing lifecycle."""

import asyncio
from datetime import UTC, datetime

from src.infrastructure.celery_app import celery
from src.modules.billing.service import BillingService


@celery.task(name="process_billing_lifecycle")
def process_billing_lifecycle() -> dict[str, int]:
    async def _run() -> dict[str, int]:
        service = BillingService()
        return await service.process_subscription_lifecycle(now=datetime.now(UTC))

    return asyncio.run(_run())
