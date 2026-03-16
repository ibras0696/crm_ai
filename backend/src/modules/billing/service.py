from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy.exc import SQLAlchemyError

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.errors import BillingModuleError
from src.modules.billing.lifecycle_policy import FreePlanLimits, should_send_post_expiry_notice
from src.modules.billing.repository import BillingRepository
from src.modules.billing.runtime_config import resolve_yookassa_runtime_config
from src.modules.billing.schemas import UsageOut
from src.modules.billing.token_wallet import (
    ensure_token_balances_bulk,
    get_token_balance_view,
    purchase_addon_tokens,
)
from src.modules.billing.token_wallet_repository import TokenWalletRepository
from src.modules.files import storage
from src.modules.notifications.public_api import queue_email_notification

logger = logging.getLogger(__name__)


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
        elif code in {"WEBHOOK_INVALID_PAYLOAD"}:
            status = 400
        elif code in {"WEBHOOK_PAYMENT_NOT_CONFIRMED"}:
            status = 403
        elif code in {"BILLING_NOT_CONFIGURED", "PAYMENT_ERROR"}:
            status = 503
        super().__init__(code=code, message=message, status_code=status)


class BillingService:
    """Сервисный слой billing без HTTP-логики роутера."""

    async def _create_yookassa_payment(
        self,
        *,
        shop_id: str,
        secret_key: str,
        return_url: str,
        amount_cents: int,
        description: str,
        metadata: dict[str, str],
    ) -> dict:
        """Создать payment в YooKassa и вернуть сырой ответ."""
        idempotency_key = str(uuid.uuid4())
        payload = {
            "amount": {"value": f"{amount_cents / 100:.2f}", "currency": "RUB"},
            "confirmation": {"type": "redirect", "return_url": return_url},
            "capture": True,
            "description": description,
            "metadata": metadata,
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.yookassa.ru/v3/payments",
                    json=payload,
                    auth=(shop_id, secret_key),
                    headers={"Idempotence-Key": idempotency_key, "Content-Type": "application/json"},
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as exc:
            raise BillingOperationError(
                "PAYMENT_ERROR",
                f"Ошибка платежного шлюза: {exc.response.status_code}",
            ) from exc
        except (httpx.RequestError, httpx.TimeoutException) as exc:
            raise BillingOperationError("PAYMENT_ERROR", "Платежный шлюз недоступен") from exc

    async def _get_yookassa_payment(
        self,
        *,
        shop_id: str,
        secret_key: str,
        payment_id: str,
    ) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"https://api.yookassa.ru/v3/payments/{payment_id}",
                    auth=(shop_id, secret_key),
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as exc:
            raise BillingOperationError(
                "PAYMENT_ERROR",
                f"Не удалось получить статус платежа: {exc.response.status_code}",
            ) from exc
        except (httpx.RequestError, httpx.TimeoutException) as exc:
            raise BillingOperationError("PAYMENT_ERROR", "Платежный шлюз недоступен") from exc

    async def _confirm_yookassa_webhook_payment(self, payload: dict) -> dict:
        obj = payload.get("object")
        if not isinstance(obj, dict):
            raise BillingOperationError("WEBHOOK_INVALID_PAYLOAD", "Webhook payload не содержит object")

        payment_id = str(obj.get("id") or "").strip()
        if not payment_id:
            raise BillingOperationError("WEBHOOK_INVALID_PAYLOAD", "Webhook payload не содержит payment_id")

        async with UnitOfWork() as uow:
            yk = await resolve_yookassa_runtime_config(uow.session)
        if not yk.shop_id or not yk.secret_key:
            raise BillingOperationError(
                "BILLING_NOT_CONFIGURED",
                "Платежный шлюз не настроен. Укажите YooKassa shop_id и secret_key.",
            )

        confirmed_payment = await self._get_yookassa_payment(
            shop_id=yk.shop_id,
            secret_key=yk.secret_key,
            payment_id=payment_id,
        )
        if str(confirmed_payment.get("id") or "").strip() != payment_id:
            raise BillingOperationError(
                "WEBHOOK_PAYMENT_NOT_CONFIRMED",
                "Webhook payment_id не совпадает с платежом YooKassa",
            )
        if str(confirmed_payment.get("status") or "").strip() != "succeeded" or not bool(confirmed_payment.get("paid")):
            raise BillingOperationError(
                "WEBHOOK_PAYMENT_NOT_CONFIRMED",
                "Webhook не подтвержден статусом succeeded в YooKassa",
            )
        return confirmed_payment

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
            return await get_token_balance_view(uow.session, org_id=org_id)

    async def list_token_packages(self) -> list[dict]:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            rows = await repo.list_active_token_packages()
        return [
            {
                "code": row.code,
                "display_name": row.display_name,
                "badge_text": row.badge_text,
                "description": row.description,
                "button_text": row.button_text,
                "payment_note": row.payment_note,
                "price_caption": row.price_caption,
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
            yk = await resolve_yookassa_runtime_config(uow.session)
            repo = BillingRepository(uow.session)
            package = await repo.get_active_token_package(code=package_code)
        if package is None:
            raise BillingOperationError("UNKNOWN_PACKAGE", "Неизвестный пакет токенов")

        amount = int(package.price_rub_cents or 0)
        # Бесплатные пакеты начисляем сразу, без платежного шлюза.
        if amount <= 0:
            async with UnitOfWork() as uow:
                try:
                    data = await purchase_addon_tokens(
                        uow.session,
                        org_id=org_id,
                        user_id=user_id,
                        package_code=package_code,
                        months_valid=12,
                        payment_id=f"free-token-pack-{uuid.uuid4().hex[:12]}",
                        purchase_meta={
                            "purchase_kind": "token_package",
                            "payment_status": "succeeded",
                            "source": "free_package",
                        },
                    )
                except ValueError as exc:
                    if str(exc) == "UNKNOWN_PACKAGE":
                        raise BillingOperationError("UNKNOWN_PACKAGE", "Неизвестный пакет токенов") from exc
                    raise BillingOperationError("INVALID_PACKAGE", "Некорректный пакет токенов") from exc
                await uow.commit()
            return {
                "purchase_applied": True,
                "requires_payment": False,
                "confirmation_url": "",
                "payment_id": data.get("payment_id"),
                "status": "succeeded",
                "amount": 0,
                "package_code": package.code,
                "package_display_name": package.display_name,
                "package_tokens": int(package.tokens or 0),
                **data,
            }

        if not yk.shop_id or not yk.secret_key:
            raise BillingOperationError(
                "BILLING_NOT_CONFIGURED",
                "Платежный шлюз не настроен. Укажите YooKassa shop_id и secret_key.",
            )
        data = await self._create_yookassa_payment(
            shop_id=yk.shop_id,
            secret_key=yk.secret_key,
            return_url=yk.return_url,
            amount_cents=amount,
            description=f"Пакет AI токенов: {package.display_name}",
            metadata={
                "org_id": str(org_id),
                "user_id": str(user_id),
                "purchase_kind": "token_package",
                "package_code": package.code,
            },
        )
        return {
            "purchase_applied": False,
            "requires_payment": True,
            "payment_id": data.get("id"),
            "status": data.get("status"),
            "confirmation_url": data.get("confirmation", {}).get("confirmation_url", ""),
            "amount": amount,
            "package_code": package.code,
            "package_display_name": package.display_name,
            "package_tokens": int(package.tokens or 0),
        }

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

        async with UnitOfWork() as uow:
            yk = await resolve_yookassa_runtime_config(uow.session)
            repo = BillingRepository(uow.session)
            plan = await repo.get_plan_by_name(plan_name)
        if not yk.shop_id or not yk.secret_key:
            raise BillingOperationError(
                "BILLING_NOT_CONFIGURED",
                "Платежный шлюз не настроен. Укажите YooKassa shop_id и secret_key.",
            )
        if not plan:
            raise BillingOperationError("PLAN_NOT_FOUND", f"Тариф '{plan_name}' не найден")

        amount = int(plan.price_monthly or 0)
        if amount == 0:
            raise BillingOperationError("FREE_PLAN", "Этот тариф бесплатный")

        data = await self._create_yookassa_payment(
            shop_id=yk.shop_id,
            secret_key=yk.secret_key,
            return_url=yk.return_url,
            amount_cents=amount,
            description=f"Тариф {plan.display_name} (monthly)",
            metadata={
                "org_id": str(org_id),
                "user_id": str(user_id),
                "plan_name": plan_name,
                "period": "monthly",
            },
        )

        return {
            "payment_id": data.get("id"),
            "status": data.get("status"),
            "confirmation_url": data.get("confirmation", {}).get("confirmation_url", ""),
            "amount": amount,
            "plan": plan.display_name,
        }

    async def get_payment_status(
        self,
        *,
        payment_id: str,
    ) -> dict:
        async with UnitOfWork() as uow:
            yk = await resolve_yookassa_runtime_config(uow.session)
        if not yk.shop_id or not yk.secret_key:
            raise BillingOperationError(
                "BILLING_NOT_CONFIGURED",
                "Платежный шлюз не настроен. Укажите YooKassa shop_id и secret_key.",
            )

        data = await self._get_yookassa_payment(
            shop_id=yk.shop_id,
            secret_key=yk.secret_key,
            payment_id=payment_id,
        )
        amount = data.get("amount") or {}
        return {
            "payment_id": str(data.get("id") or payment_id),
            "status": str(data.get("status") or "unknown"),
            "paid": bool(data.get("paid")),
            "amount_value": amount.get("value"),
            "amount_currency": amount.get("currency"),
            "description": data.get("description"),
            "confirmation_url": (data.get("confirmation") or {}).get("confirmation_url"),
            "created_at": data.get("created_at"),
            "metadata": data.get("metadata") or {},
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
        if event != "payment.succeeded":
            return

        obj = await self._confirm_yookassa_webhook_payment(payload)
        metadata = obj.get("metadata", {})
        org_id = metadata.get("org_id")
        plan_name = metadata.get("plan_name")
        purchase_kind = str(metadata.get("purchase_kind") or "").strip()
        package_code = str(metadata.get("package_code") or "").strip()
        payment_id = obj.get("id")
        if not org_id:
            return
        try:
            org_uuid = uuid.UUID(str(org_id))
        except ValueError as exc:
            raise BillingOperationError("WEBHOOK_INVALID_PAYLOAD", "Webhook содержит некорректный org_id") from exc

        if purchase_kind == "token_package" and package_code:
            user_id_raw = str(metadata.get("user_id") or "").strip()
            user_uuid: uuid.UUID | None = None
            if user_id_raw:
                try:
                    user_uuid = uuid.UUID(user_id_raw)
                except ValueError:
                    user_uuid = None
            async with UnitOfWork() as uow:
                wallet_repo = TokenWalletRepository(uow.session)
                if payment_id:
                    existing = await wallet_repo.get_purchase_by_payment_id(payment_id=str(payment_id))
                    if existing is not None:
                        return
                billing_repo = BillingRepository(uow.session)
                if user_uuid is None:
                    owners_admins = await billing_repo.list_org_owner_admin_user_ids(org_id=org_uuid)
                    if owners_admins:
                        user_uuid = owners_admins[0]
                    else:
                        members = await billing_repo.list_org_member_user_ids(org_id=org_uuid)
                        user_uuid = members[0] if members else None
                await purchase_addon_tokens(
                    uow.session,
                    org_id=org_uuid,
                    user_id=user_uuid,
                    package_code=package_code,
                    months_valid=12,
                    payment_id=str(payment_id or ""),
                    purchase_meta={
                        "purchase_kind": "token_package",
                        "payment_status": "succeeded",
                        "status": str(obj.get("status") or "succeeded"),
                    },
                )
                await uow.commit()
            return

        if not plan_name:
            return

        plan_map = {"free": PlanTier.FREE, "team": PlanTier.TEAM, "business": PlanTier.BUSINESS}
        plan_tier = plan_map.get(str(plan_name).strip())
        if plan_tier is None:
            raise BillingOperationError("WEBHOOK_INVALID_PAYLOAD", "Webhook содержит неизвестный тариф")
        now = datetime.now(UTC)
        period_end = now + timedelta(days=30)

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            await repo.activate_subscription(
                org_id=org_uuid,
                plan=plan_tier,
                current_period_start=now,
                current_period_end=period_end,
                external_id=payment_id,
            )
            await uow.commit()

    async def cancel_subscription(self, *, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            await repo.cancel_subscription_now(org_id=org_id, cancelled_at=datetime.now(UTC))
            await uow.commit()
        return {"plan": "free", "status": "cancelled"}

    async def process_subscription_lifecycle(self, *, now: datetime | None = None) -> dict[str, int]:
        now_utc = now or datetime.now(UTC)
        if now_utc.tzinfo is None:
            now_utc = now_utc.replace(tzinfo=UTC)

        pre_notice_window = timedelta(hours=max(1, int(settings.BILLING_PRE_EXPIRY_NOTICE_HOURS)))
        grace_delta = timedelta(days=max(1, int(settings.BILLING_GRACE_DAYS)))
        purge_delta = timedelta(days=max(1, int(settings.BILLING_PURGE_AFTER_END_DAYS)))
        reminder_delta = timedelta(days=max(1, int(settings.BILLING_POST_EXPIRY_REMINDER_DAYS)))

        stats = {
            "pre_expiry_notifications": 0,
            "post_expiry_notifications": 0,
            "downgraded_orgs": 0,
            "trimmed_orgs": 0,
        }
        orgs_to_trim: list[uuid.UUID] = []

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
                        body=(
                            "Срок тарифа заканчивается в течение 24 часов. "
                            "Продлите подписку, чтобы не потерять доступ к платным возможностям."
                        ),
                        meta={"kind": "subscription_pre_expiry", "period_end": period_end.isoformat()},
                    )
                    if created > 0:
                        sub.pre_expiry_notified_at = now_utc
                        stats["pre_expiry_notifications"] += created

                if is_paid_plan and period_end <= now_utc and sub.status == SubscriptionStatus.ACTIVE:
                    await repo.mark_subscription_past_due(
                        sub=sub,
                        grace_period_end=grace_end,
                        data_purge_at=purge_at,
                    )

                if is_paid_plan and should_send_post_expiry_notice(
                    now_utc=now_utc,
                    period_end=period_end,
                    grace_end=grace_end,
                    last_sent_at=sub.post_expiry_notified_at,
                    reminder_delta=reminder_delta,
                ):
                    days_left = max(0, int((grace_end - now_utc).total_seconds() // 86400))
                    created = await self._create_billing_notification(
                        repo=repo,
                        org_id=sub.org_id,
                        title="Подписка завершена",
                        body=(
                            "Подписка завершилась. "
                            f"Льготный период для оплаты: {int(settings.BILLING_GRACE_DAYS)} дней. "
                            f"До автоснижения и очистки до лимитов free осталось примерно {days_left} дн."
                        ),
                        meta={
                            "kind": "subscription_post_expiry",
                            "period_end": period_end.isoformat(),
                            "grace_period_end": grace_end.isoformat(),
                            "days_left": days_left,
                        },
                    )
                    if created > 0:
                        sub.post_expiry_notified_at = now_utc
                        stats["post_expiry_notifications"] += created

                if sub.status == SubscriptionStatus.PAST_DUE and now_utc >= grace_end and sub.downgraded_at is None:
                    await repo.downgrade_subscription_to_free(
                        sub=sub,
                        org=org,
                        downgraded_at=now_utc,
                        data_purge_at=purge_at,
                    )
                    stats["downgraded_orgs"] += 1

                if sub.status == SubscriptionStatus.CANCELLED and sub.data_purged_at is None and now_utc >= purge_at:
                    orgs_to_trim.append(sub.org_id)

            await uow.commit()

        for org_id in orgs_to_trim:
            try:
                await self._trim_org_to_free_limits(org_id=org_id)
                await self._mark_trim_completed(org_id=org_id, completed_at=now_utc)
                stats["trimmed_orgs"] += 1
            except (SQLAlchemyError, BotoCoreError, ClientError, OSError, RuntimeError, ValueError):
                logger.exception("billing_trim_to_free_failed", extra={"org_id": str(org_id)})

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
        recipients = await repo.get_notification_recipients_with_email(org_id=org_id)
        created = await repo.create_in_app_notifications(
            org_id=org_id,
            user_ids=[user_id for user_id, _email in recipients],
            title=title,
            body=body,
            meta=meta,
        )
        for _user_id, email in recipients:
            queue_email_notification(
                to_email=email,
                subject=title,
                body=body,
                kind="billing_lifecycle",
            )
        return created

    async def _resolve_free_plan_limits(self, *, repo: BillingRepository) -> FreePlanLimits:
        free_plan = await repo.get_active_plan_by_name(name="free")
        max_tables = int(getattr(free_plan, "max_tables", 10) or 10)
        max_records = int(getattr(free_plan, "max_records", 10_000) or 10_000)
        max_storage_mb = int(getattr(free_plan, "max_storage_mb", 500) or 500)
        return FreePlanLimits(
            max_tables=max_tables,
            max_records=max_records,
            max_storage_bytes=max_storage_mb * 1024 * 1024,
        )

    async def _trim_org_to_free_limits(self, *, org_id: uuid.UUID) -> None:
        batch_size = max(1, int(getattr(settings, "BILLING_CLEANUP_BATCH_SIZE", 100) or 100))

        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            limits = await self._resolve_free_plan_limits(repo=repo)
            await uow.commit()

        await self._trim_tables(org_id=org_id, limit=limits.max_tables, batch_size=batch_size)
        await self._trim_records(org_id=org_id, limit=limits.max_records, batch_size=batch_size)
        await self._trim_files(org_id=org_id, limit_bytes=limits.max_storage_bytes, batch_size=batch_size)

    async def _mark_trim_completed(self, *, org_id: uuid.UUID, completed_at: datetime) -> None:
        async with UnitOfWork() as uow:
            repo = BillingRepository(uow.session)
            sub = await repo.get_subscription(org_id=org_id)
            if sub is not None:
                sub.data_purged_at = completed_at
            await uow.commit()

    async def _trim_tables(self, *, org_id: uuid.UUID, limit: int, batch_size: int) -> None:
        while True:
            async with UnitOfWork() as uow:
                repo = BillingRepository(uow.session)
                total = await repo.count_tables_for_org(org_id=org_id)
                excess = max(0, total - max(0, int(limit)))
                if excess <= 0:
                    await uow.commit()
                    return
                tables = await repo.list_oldest_tables_for_org(org_id=org_id, limit=min(batch_size, excess))
                deleted = await repo.delete_tables_by_ids(table_ids=[table.id for table in tables])
                await uow.commit()
            if deleted <= 0:
                return

    async def _trim_records(self, *, org_id: uuid.UUID, limit: int, batch_size: int) -> None:
        while True:
            async with UnitOfWork() as uow:
                repo = BillingRepository(uow.session)
                total = await repo.count_records_for_org(org_id=org_id)
                excess = max(0, total - max(0, int(limit)))
                if excess <= 0:
                    await uow.commit()
                    return
                records = await repo.list_oldest_records_for_org(org_id=org_id, limit=min(batch_size, excess))
                deleted = await repo.delete_records_by_ids(record_ids=[record.id for record in records])
                await uow.commit()
            if deleted <= 0:
                return

    async def _trim_files(self, *, org_id: uuid.UUID, limit_bytes: int, batch_size: int) -> None:
        while True:
            async with UnitOfWork() as uow:
                repo = BillingRepository(uow.session)
                total_bytes = await repo.sum_file_bytes_for_org(org_id=org_id)
                if total_bytes <= max(0, int(limit_bytes)):
                    await repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=total_bytes)
                    await uow.commit()
                    return

                files = await repo.list_oldest_files_for_org(org_id=org_id, limit=batch_size)
                if not files:
                    await repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=total_bytes)
                    await uow.commit()
                    return

                file_ids = [file_obj.id for file_obj in files]
                versions = await repo.list_file_versions_for_file_ids(file_ids=file_ids)
                for version in versions:
                    if version.s3_bucket and version.s3_key:
                        try:
                            storage.delete_file(version.s3_key, version.s3_bucket)
                        except (ClientError, BotoCoreError):
                            logger.warning(
                                "billing_cleanup_failed_to_delete_file_version_from_storage",
                                extra={"org_id": str(org_id), "file_id": str(version.file_id), "key": version.s3_key},
                            )

                for file_obj in files:
                    if getattr(file_obj, "s3_bucket", None) and getattr(file_obj, "s3_key", None):
                        try:
                            storage.delete_file(file_obj.s3_key, file_obj.s3_bucket)
                        except (ClientError, BotoCoreError):
                            logger.warning(
                                "billing_cleanup_failed_to_delete_file_from_storage",
                                extra={"org_id": str(org_id), "file_id": str(file_obj.id), "key": file_obj.s3_key},
                            )

                await repo.delete_file_versions_by_ids(version_ids=[version.id for version in versions])
                await repo.delete_files_by_ids(file_ids=file_ids)
                remaining = await repo.sum_file_bytes_for_org(org_id=org_id)
                await repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=remaining)
                await uow.commit()
