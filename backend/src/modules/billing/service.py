from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from botocore.exceptions import BotoCoreError, ClientError

from src.common.enums import NotificationStatus, NotificationType, PlanTier, SubscriptionStatus
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.errors import BillingModuleError
from src.modules.billing.repository import BillingRepository
from src.modules.billing.schemas import UsageOut
from src.modules.billing.token_wallet import (
    ensure_token_balances_bulk,
    get_token_balance_view,
    purchase_addon_tokens,
)
from src.modules.files import storage
from src.modules.notifications.models import Notification


class BillingOperationError(BillingModuleError):
    """Бизнес-ошибка billing, которую роутер отображает в ApiResponse(ok=false)."""

    def __init__(self, code: str, message: str):
        status = 422
        if code in {"PLAN_NOT_FOUND"}:
            status = 404
        elif code in {"PAYMENT_REQUIRED"}:
            status = 402
        elif code in {"BILLING_STATE_CONFLICT"}:
            status = 409
        elif code in {"BILLING_NOT_CONFIGURED", "PAYMENT_ERROR"}:
            status = 503
        super().__init__(code=code, message=message, status_code=status)


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

    async def get_token_balance(self, *, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            wallet = await get_token_balance_view(uow.session, org_id=org_id)
        return wallet

    async def list_token_packages(self) -> list[dict]:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            rows = await repo.list_active_token_packages()
        return [
            {
                "code": row.code,
                "display_name": row.display_name,
                "tokens": int(row.tokens),
                "price_rub_cents": int(row.price_rub_cents or 0),
            }
            for row in rows
        ]

    async def purchase_tokens(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        package_code: str,
    ) -> dict:
        async with UnitOfWork() as uow:
            try:
                data = await purchase_addon_tokens(
                    uow.session,
                    org_id=org_id,
                    user_id=user_id,
                    package_code=package_code,
                    months_valid=12,
                    payment_id=None,
                )
            except ValueError as exc:
                if str(exc) == "UNKNOWN_PACKAGE":
                    raise BillingOperationError("UNKNOWN_PACKAGE", "Неизвестный пакет токенов") from exc
                raise BillingOperationError("INVALID_PACKAGE", "Некорректный пакет токенов") from exc
            await uow.commit()
        return data

    async def create_payment(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        plan_name: str,
        period: str,
    ) -> dict:
        if period != "monthly":
            raise BillingOperationError("INVALID_PERIOD", "Поддерживается только ежемесячная подписка (monthly)")

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

        amount = int(plan.price_monthly or 0)
        if amount == 0:
            raise BillingOperationError("FREE_PLAN", "Этот тариф бесплатный")

        idempotency_key = str(uuid.uuid4())
        payload = {
            "amount": {"value": f"{amount / 100:.2f}", "currency": "RUB"},
            "confirmation": {"type": "redirect", "return_url": settings.YOOKASSA_RETURN_URL},
            "capture": True,
            "description": f"Тариф {plan.display_name} (monthly)",
            "metadata": {
                "org_id": str(org_id),
                "user_id": str(user_id),
                "plan_name": plan_name,
                "period": "monthly",
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
        except (httpx.RequestError, httpx.TimeoutException) as exc:
            raise BillingOperationError("PAYMENT_ERROR", "Платежный шлюз недоступен") from exc

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
                "grace_period_end": None,
                "data_purge_at": None,
            }
        return {
            "plan": sub.plan.value if sub.plan else "free",
            "status": sub.status.value if sub.status else "active",
            "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
            "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
            "grace_period_end": sub.grace_period_end.isoformat() if sub.grace_period_end else None,
            "data_purge_at": sub.data_purge_at.isoformat() if sub.data_purge_at else None,
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
        payment_id = obj.get("id")
        if not org_id or not plan_name:
            return

        plan_map = {"free": PlanTier.FREE, "team": PlanTier.TEAM, "business": PlanTier.BUSINESS}
        plan_tier = plan_map.get(plan_name, PlanTier.FREE)
        now = datetime.now(UTC)
        period_end = now + timedelta(days=30)
        org_uuid = uuid.UUID(org_id)

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            sub = await repo.upsert_subscription(
                org_id=org_uuid,
                plan=plan_tier,
                status=SubscriptionStatus.ACTIVE,
                current_period_start=now,
                current_period_end=period_end,
                external_id=payment_id,
            )
            sub.grace_period_end = None
            sub.data_purge_at = None
            sub.pre_expiry_notified_at = None
            sub.post_expiry_notified_at = None
            sub.downgraded_at = None
            sub.data_purged_at = None
            org = await repo.get_org(org_id=org_uuid)
            if org:
                org.plan = plan_tier
            await uow.commit()

    async def cancel_subscription(self, *, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            sub = await repo.upsert_subscription(
                org_id=org_id,
                plan=PlanTier.FREE,
                status=SubscriptionStatus.CANCELLED,
                current_period_start=None,
                current_period_end=None,
                external_id=None,
            )
            sub.grace_period_end = None
            sub.data_purge_at = None
            sub.pre_expiry_notified_at = None
            sub.post_expiry_notified_at = None
            sub.downgraded_at = datetime.now(UTC)
            org = await repo.get_org(org_id=org_id)
            if org:
                org.plan = PlanTier.FREE
            await uow.commit()
        return {"plan": "free", "status": "cancelled"}

    async def process_subscription_lifecycle(self, *, now: datetime | None = None) -> dict[str, int]:
        now_utc = now or datetime.now(UTC)
        if now_utc.tzinfo is None:
            now_utc = now_utc.replace(tzinfo=UTC)

        pre_notice_window = timedelta(hours=max(1, int(settings.BILLING_PRE_EXPIRY_NOTICE_HOURS)))
        grace_delta = timedelta(days=max(1, int(settings.BILLING_GRACE_DAYS)))
        purge_delta = timedelta(days=max(1, int(settings.BILLING_PURGE_AFTER_END_DAYS)))

        stats = {
            "pre_expiry_notifications": 0,
            "post_expiry_notifications": 0,
            "downgraded_orgs": 0,
            "purged_orgs": 0,
        }

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            subscriptions = await repo.list_subscriptions()
            all_org_ids = await repo.list_org_ids()
            org_map = await repo.list_orgs_by_ids(all_org_ids)

            # Ротация plan-токенов по месячному циклу (без переноса остатка).
            await ensure_token_balances_bulk(uow.session, org_ids=all_org_ids, lock=False)

            for sub in subscriptions:
                org = org_map.get(sub.org_id)
                if org is None:
                    continue
                if sub.current_period_end is None:
                    continue

                period_end = sub.current_period_end
                grace_end = sub.grace_period_end or (period_end + grace_delta)
                purge_at = sub.data_purge_at or (period_end + purge_delta)

                is_paid_plan = sub.plan in {PlanTier.TEAM, PlanTier.BUSINESS}

                if (
                    is_paid_plan
                    and sub.status == SubscriptionStatus.ACTIVE
                    and period_end > now_utc
                    and (period_end - now_utc) <= pre_notice_window
                    and sub.pre_expiry_notified_at is None
                ):
                    created = await self._create_billing_notification(
                        repo=repo,
                        org_id=sub.org_id,
                        title="Подписка скоро закончится",
                        body="Срок тарифа заканчивается в течение 24 часов. Продлите подписку, чтобы не потерять доступ к платным возможностям.",
                        meta={"kind": "subscription_pre_expiry", "period_end": period_end.isoformat()},
                    )
                    if created > 0:
                        sub.pre_expiry_notified_at = now_utc
                        stats["pre_expiry_notifications"] += created

                if is_paid_plan and period_end <= now_utc and sub.status == SubscriptionStatus.ACTIVE:
                    sub.status = SubscriptionStatus.PAST_DUE
                    sub.grace_period_end = grace_end
                    sub.data_purge_at = purge_at

                if (
                    is_paid_plan
                    and period_end <= now_utc
                    and sub.post_expiry_notified_at is None
                ):
                    created = await self._create_billing_notification(
                        repo=repo,
                        org_id=sub.org_id,
                        title="Подписка завершена",
                        body=f"Подписка завершилась. Льготный период для оплаты: {int(settings.BILLING_GRACE_DAYS)} дней.",
                        meta={
                            "kind": "subscription_post_expiry",
                            "period_end": period_end.isoformat(),
                            "grace_period_end": grace_end.isoformat(),
                        },
                    )
                    if created > 0:
                        sub.post_expiry_notified_at = now_utc
                        stats["post_expiry_notifications"] += created

                if (
                    sub.status == SubscriptionStatus.PAST_DUE
                    and now_utc >= grace_end
                    and sub.downgraded_at is None
                ):
                    sub.status = SubscriptionStatus.CANCELLED
                    sub.plan = PlanTier.FREE
                    sub.downgraded_at = now_utc
                    sub.data_purge_at = purge_at
                    org.plan = PlanTier.FREE
                    stats["downgraded_orgs"] += 1

                if (
                    sub.status == SubscriptionStatus.CANCELLED
                    and sub.data_purged_at is None
                    and now_utc >= purge_at
                ):
                    await self._purge_org_data(repo=repo, org_id=sub.org_id)
                    sub.data_purged_at = now_utc
                    stats["purged_orgs"] += 1

            await uow.commit()

        return stats

    async def _create_billing_notification(
        self,
        *,
        repo: BillingRepository,
        org_id: uuid.UUID,
        title: str,
        body: str,
        meta: dict,
    ) -> int:
        recipients = await repo.list_org_owner_admin_user_ids(org_id=org_id)
        if not recipients:
            recipients = await repo.list_org_member_user_ids(org_id=org_id)
        if not recipients:
            return 0

        for user_id in recipients:
            repo.session.add(Notification(
                org_id=org_id,
                user_id=user_id,
                type=NotificationType.IN_APP,
                status=NotificationStatus.PENDING,
                title=title,
                body=body,
                meta=meta,
            ))
        await repo.session.flush()
        return len(recipients)

    async def _purge_org_data(self, *, repo: BillingRepository, org_id: uuid.UUID) -> None:
        files = await repo.list_files_for_org(org_id=org_id)
        for f in files:
            try:
                storage.delete_file(f.s3_key, f.s3_bucket)
            except (ClientError, BotoCoreError):
                # Хранилище не должно блокировать очистку SQL-данных.
                continue
        await repo.delete_org_business_data(org_id=org_id)
