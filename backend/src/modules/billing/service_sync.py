from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.modules.billing.lifecycle_policy import FreePlanLimits, should_send_post_expiry_notice
from src.modules.billing.repository_sync import BillingSyncRepository
from src.modules.files import storage
from src.modules.org.models import Subscription

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.orm import Session


class BillingServiceSync:
    def __init__(self, session: Session):
        self.session = session
        self.repo = BillingSyncRepository(session)
        self.logger = logging.getLogger(__name__)

    def process_subscription_lifecycle(self, *, now: datetime | None = None) -> dict[str, int]:
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

        self._rotate_monthly_plan_tokens_for_all_orgs(now_utc=now_utc)

        subscriptions = self.repo.list_subscriptions()
        org_ids = [sub.org_id for sub in subscriptions]
        org_map = self.repo.list_organizations_by_ids(org_ids)

        for sub in subscriptions:
            org = org_map.get(sub.org_id)
            if org is None or sub.current_period_end is None:
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
                created = self._create_billing_notification(
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
                self.repo.mark_subscription_past_due(
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
                created = self._create_billing_notification(
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
                self.repo.downgrade_subscription_to_free(
                    sub=sub,
                    org=org,
                    downgraded_at=now_utc,
                    data_purge_at=purge_at,
                )
                stats["downgraded_orgs"] += 1

            if sub.status == SubscriptionStatus.CANCELLED and sub.data_purged_at is None and now_utc >= purge_at:
                orgs_to_trim.append(sub.org_id)

        self.repo.commit()
        for org_id in orgs_to_trim:
            try:
                self._trim_org_to_free_limits(org_id=org_id)
                sub = self.repo.session.execute(
                    select(Subscription).where(Subscription.org_id == org_id)
                ).scalar_one_or_none()
                if sub is not None:
                    sub.data_purged_at = now_utc
                self.repo.commit()
                stats["trimmed_orgs"] += 1
            except Exception:
                self.logger.exception("billing_trim_to_free_failed", extra={"org_id": str(org_id)})
        return stats

    def _rotate_monthly_plan_tokens_for_all_orgs(self, *, now_utc: datetime) -> None:
        cycle = f"{now_utc.year:04d}-{now_utc.month:02d}"
        org_ids = self.repo.list_all_org_ids()
        if not org_ids:
            return

        expired = self.repo.list_expired_active_purchases(org_ids=org_ids, now_utc=now_utc)
        for purchase in expired:
            purchase.is_active = False
            purchase.tokens_remaining = 0

        addon_total_by_org = self.repo.sum_active_addon_tokens_by_org(org_ids=org_ids)
        sub_plan_by_org = self.repo.list_active_subscription_plans_by_org(org_ids=org_ids)
        org_plan_by_org = self.repo.list_org_plans(org_ids=org_ids)
        quota_by_plan_name = self.repo.list_active_plan_ai_quota_by_name()
        balance_by_org = self.repo.list_token_balances_by_org(org_ids=org_ids)

        for org_id in org_ids:
            plan_name = str(sub_plan_by_org.get(org_id) or org_plan_by_org.get(org_id) or "free").lower()
            quota = int(quota_by_plan_name.get(plan_name, 0) or 0)
            addon_total = int(addon_total_by_org.get(org_id, 0))

            balance = balance_by_org.get(org_id)
            if balance is None:
                self.repo.add_token_balance(
                    org_id=org_id,
                    cycle=cycle,
                    quota=quota,
                    addon_total=addon_total,
                )
                continue

            if balance.plan_cycle_key != cycle:
                balance.plan_cycle_key = cycle
                balance.plan_tokens_monthly_quota = quota
                balance.plan_tokens_remaining = quota
            balance.addon_tokens_remaining = addon_total

    def _create_billing_notification(self, *, org_id: uuid.UUID, title: str, body: str, meta: dict) -> int:
        recipients = self.repo.get_notification_recipients_with_email(org_id=org_id)
        if not recipients:
            return 0

        # Avoid Celery autodiscovery import cycle: notifications.tasks -> auth -> org -> billing.
        from src.modules.notifications.tasks import send_email_notification

        for user_id, email in recipients:
            self.repo.add_in_app_notification(
                org_id=org_id,
                user_id=user_id,
                title=title,
                body=body,
                meta=meta,
            )
            try:
                send_email_notification.delay(
                    to_email=email,
                    subject=title,
                    body=body,
                    kind="billing_lifecycle",
                )
            except Exception:
                self.logger.exception(
                    "Failed to enqueue billing lifecycle email",
                    extra={"org_id": str(org_id), "to": email},
                )
        self.repo.flush()
        return len(recipients)

    def _resolve_free_plan_limits(self) -> FreePlanLimits:
        free_plan = self.repo.get_active_plan_by_name(name="free")
        max_tables = int(getattr(free_plan, "max_tables", 10) or 10)
        max_records = int(getattr(free_plan, "max_records", 10_000) or 10_000)
        max_storage_mb = int(getattr(free_plan, "max_storage_mb", 500) or 500)
        return FreePlanLimits(
            max_tables=max_tables,
            max_records=max_records,
            max_storage_bytes=max_storage_mb * 1024 * 1024,
        )

    def _trim_org_to_free_limits(self, *, org_id: uuid.UUID) -> None:
        limits = self._resolve_free_plan_limits()
        batch_size = max(1, int(getattr(settings, "BILLING_CLEANUP_BATCH_SIZE", 100) or 100))
        self._trim_tables(org_id=org_id, limit=limits.max_tables, batch_size=batch_size)
        self._trim_records(org_id=org_id, limit=limits.max_records, batch_size=batch_size)
        self._trim_files(org_id=org_id, limit_bytes=limits.max_storage_bytes, batch_size=batch_size)

    def _trim_tables(self, *, org_id: uuid.UUID, limit: int, batch_size: int) -> None:
        while True:
            total = self.repo.count_tables_for_org(org_id=org_id)
            excess = max(0, total - max(0, int(limit)))
            if excess <= 0:
                return
            tables = self.repo.list_oldest_tables_for_org(org_id=org_id, limit=min(batch_size, excess))
            deleted = self.repo.delete_tables_by_ids(table_ids=[table.id for table in tables])
            self.repo.commit()
            if deleted <= 0:
                return

    def _trim_records(self, *, org_id: uuid.UUID, limit: int, batch_size: int) -> None:
        while True:
            total = self.repo.count_records_for_org(org_id=org_id)
            excess = max(0, total - max(0, int(limit)))
            if excess <= 0:
                return
            records = self.repo.list_oldest_records_for_org(org_id=org_id, limit=min(batch_size, excess))
            deleted = self.repo.delete_records_by_ids(record_ids=[record.id for record in records])
            self.repo.commit()
            if deleted <= 0:
                return

    def _trim_files(self, *, org_id: uuid.UUID, limit_bytes: int, batch_size: int) -> None:
        while True:
            total_bytes = self.repo.sum_file_bytes_for_org(org_id=org_id)
            if total_bytes <= max(0, int(limit_bytes)):
                self.repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=total_bytes)
                self.repo.commit()
                return

            files = self.repo.list_oldest_files_for_org(org_id=org_id, limit=batch_size)
            if not files:
                self.repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=total_bytes)
                self.repo.commit()
                return

            file_ids = [file_obj.id for file_obj in files]
            versions = self.repo.list_file_versions_for_file_ids(file_ids=file_ids)
            for version in versions:
                if version.s3_bucket and version.s3_key:
                    try:
                        storage.delete_file(version.s3_key, version.s3_bucket)
                    except (ClientError, BotoCoreError):
                        self.logger.warning(
                            "billing_cleanup_failed_to_delete_file_version_from_storage",
                            extra={"org_id": str(org_id), "file_id": str(version.file_id), "key": version.s3_key},
                        )

            for file_obj in files:
                if getattr(file_obj, "s3_bucket", None) and getattr(file_obj, "s3_key", None):
                    try:
                        storage.delete_file(file_obj.s3_key, file_obj.s3_bucket)
                    except (ClientError, BotoCoreError):
                        self.logger.warning(
                            "billing_cleanup_failed_to_delete_file_from_storage",
                            extra={"org_id": str(org_id), "file_id": str(file_obj.id), "key": file_obj.s3_key},
                        )

            self.repo.delete_file_versions_by_ids(version_ids=[version.id for version in versions])
            self.repo.delete_files_by_ids(file_ids=file_ids)
            remaining = self.repo.sum_file_bytes_for_org(org_id=org_id)
            self.repo.upsert_storage_usage_bytes(org_id=org_id, used_bytes=remaining)
            self.repo.commit()
