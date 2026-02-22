from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone as tz

import httpx

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.repository import BillingRepository
from src.modules.billing.schemas import UsageOut


class BillingOperationError(Exception):
    """Бизнес-ошибка billing, которую роутер отображает в ApiResponse(ok=false)."""

    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class BillingService:
    """Сервисный слой billing без HTTP-логики роутера."""

    async def list_plans(self):
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            return await repo.list_active_plans()

    async def get_usage(self, *, org_id: uuid.UUID) -> UsageOut:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            members, tables, records, files, storage_bytes = await repo.get_usage_counts(org_id=org_id)
        return UsageOut(
            members=members,
            tables=tables,
            records=records,
            files=files,
            storage_bytes=storage_bytes,
        )

    async def create_payment(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        plan_name: str,
        period: str,
    ) -> dict:
        if period not in {"monthly", "yearly"}:
            raise BillingOperationError("INVALID_PERIOD", "period должен быть monthly или yearly")

        if not settings.YOOKASSA_SHOP_ID or not settings.YOOKASSA_SECRET_KEY:
            raise BillingOperationError(
                "BILLING_NOT_CONFIGURED",
                "Платежный шлюз не настроен. Добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env",
            )

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            plan = await repo.get_plan_by_name(plan_name)
        if not plan:
            raise BillingOperationError("PLAN_NOT_FOUND", f"Тариф '{plan_name}' не найден")

        amount = plan.price_yearly if period == "yearly" else plan.price_monthly
        if amount == 0:
            raise BillingOperationError("FREE_PLAN", "Этот тариф бесплатный")

        idempotency_key = str(uuid.uuid4())
        payload = {
            "amount": {"value": f"{amount / 100:.2f}", "currency": "RUB"},
            "confirmation": {"type": "redirect", "return_url": settings.YOOKASSA_RETURN_URL},
            "capture": True,
            "description": f"Тариф {plan.display_name} ({period})",
            "metadata": {
                "org_id": str(org_id),
                "user_id": str(user_id),
                "plan_name": plan_name,
                "period": period,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.yookassa.ru/v3/payments",
                    json=payload,
                    auth=(settings.YOOKASSA_SHOP_ID, settings.YOOKASSA_SECRET_KEY),
                    headers={"Idempotence-Key": idempotency_key, "Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            raise BillingOperationError("PAYMENT_ERROR", f"Ошибка платежного шлюза: {exc.response.status_code}") from exc
        except Exception as exc:
            raise BillingOperationError("PAYMENT_ERROR", str(exc)) from exc

        return {
            "payment_id": data.get("id"),
            "status": data.get("status"),
            "confirmation_url": data.get("confirmation", {}).get("confirmation_url", ""),
            "amount": amount,
            "plan": plan.display_name,
        }

    async def get_subscription(self, *, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            sub = await repo.get_subscription(org_id=org_id)
        if not sub:
            return {
                "plan": "free",
                "status": "active",
                "current_period_start": None,
                "current_period_end": None,
            }
        return {
            "plan": sub.plan.value if sub.plan else "free",
            "status": sub.status.value if sub.status else "active",
            "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
            "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
            "external_id": sub.external_id,
        }

    async def handle_yookassa_webhook(self, payload: dict) -> None:
        event = payload.get("event", "")
        obj = payload.get("object", {})
        if event != "payment.succeeded":
            return

        metadata = obj.get("metadata", {})
        org_id = metadata.get("org_id")
        plan_name = metadata.get("plan_name")
        period = metadata.get("period", "monthly")
        payment_id = obj.get("id")
        if not org_id or not plan_name:
            return

        plan_map = {"free": PlanTier.FREE, "team": PlanTier.TEAM, "business": PlanTier.BUSINESS}
        plan_tier = plan_map.get(plan_name, PlanTier.FREE)
        now = datetime.now(tz.utc)
        period_end = now + (timedelta(days=365) if period == "yearly" else timedelta(days=30))
        org_uuid = uuid.UUID(org_id)

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            await repo.upsert_subscription(
                org_id=org_uuid,
                plan=plan_tier,
                status=SubscriptionStatus.ACTIVE,
                current_period_start=now,
                current_period_end=period_end,
                external_id=payment_id,
            )
            org = await repo.get_org(org_id=org_uuid)
            if org:
                org.plan = plan_tier
            await uow.commit()

    async def cancel_subscription(self, *, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            await repo.upsert_subscription(
                org_id=org_id,
                plan=PlanTier.FREE,
                status=SubscriptionStatus.CANCELLED,
                current_period_start=None,
                current_period_end=None,
                external_id=None,
            )
            org = await repo.get_org(org_id=org_id)
            if org:
                org.plan = PlanTier.FREE
            await uow.commit()
        return {"plan": "free", "status": "cancelled"}

