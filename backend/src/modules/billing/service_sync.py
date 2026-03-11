from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.modules.billing.repository_sync import BillingSyncRepository
from src.modules.files import storage

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.orm import Session


class BillingServiceSync:
    def __init__(self, session: Session):
        self.session = session
        self.repo = BillingSyncRepository(session)

    def process_subscription_lifecycle(self, *, now: datetime | None = None) -> dict[str, int]:
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

            if is_paid_plan and period_end <= now_utc and sub.post_expiry_notified_at is None:
                created = self._create_billing_notification(
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

            if sub.status == SubscriptionStatus.PAST_DUE and now_utc >= grace_end and sub.downgraded_at is None:
                self.repo.downgrade_subscription_to_free(
                    sub=sub,
                    org=org,
                    downgraded_at=now_utc,
                    data_purge_at=purge_at,
                )
                stats["downgraded_orgs"] += 1

            if sub.status == SubscriptionStatus.CANCELLED and sub.data_purged_at is None and now_utc >= purge_at:
                self._purge_org_data(org_id=sub.org_id)
                sub.data_purged_at = now_utc
                stats["purged_orgs"] += 1

        self.repo.commit()
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
        recipients = self.repo.get_notification_recipients(org_id=org_id)
        if not recipients:
            return 0

        for user_id in recipients:
            self.repo.add_in_app_notification(
                org_id=org_id,
                user_id=user_id,
                title=title,
                body=body,
                meta=meta,
            )
        self.repo.flush()
        return len(recipients)

    def _purge_org_data(self, *, org_id: uuid.UUID) -> None:
        files = self.repo.list_files_by_org(org_id=org_id)
        for f in files:
            try:
                storage.delete_file(f.s3_key, f.s3_bucket)
            except Exception:
                continue

        self.repo.delete_org_data_rows(org_id=org_id)
