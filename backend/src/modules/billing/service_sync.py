from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.common.enums import NotificationStatus, NotificationType, PlanTier, SubscriptionStatus, UserRole
from src.config import settings
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.files import storage
from src.modules.files.models import File
from src.modules.knowledge.models import KBPage
from src.modules.notifications.models import Notification
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.reports.models import ReportDashboard
from src.modules.schedule.models import Event
from src.modules.tables.models import Table, TableFolder
from src.modules.tables.records import Record


class BillingServiceSync:
    def __init__(self, session: Session):
        self.session = session

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

        subscriptions = list(self.session.execute(select(Subscription)).scalars().all())
        org_ids = [sub.org_id for sub in subscriptions]
        org_map: dict[uuid.UUID, Organization] = {}
        if org_ids:
            org_rows = list(
                self.session.execute(
                    select(Organization).where(Organization.id.in_(org_ids)),
                ).scalars().all(),
            )
            org_map = {org.id: org for org in org_rows}

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
                sub.status = SubscriptionStatus.CANCELLED
                sub.plan = PlanTier.FREE
                sub.downgraded_at = now_utc
                sub.data_purge_at = purge_at
                org.plan = PlanTier.FREE
                stats["downgraded_orgs"] += 1

            if sub.status == SubscriptionStatus.CANCELLED and sub.data_purged_at is None and now_utc >= purge_at:
                self._purge_org_data(org_id=sub.org_id)
                sub.data_purged_at = now_utc
                stats["purged_orgs"] += 1

        self.session.commit()
        return stats

    def _create_billing_notification(self, *, org_id: uuid.UUID, title: str, body: str, meta: dict) -> int:
        recipients = [
            row[0]
            for row in self.session.execute(
                select(Membership.user_id).where(
                    Membership.org_id == org_id,
                    Membership.role.in_([UserRole.OWNER, UserRole.ADMIN]),
                )
            ).all()
        ]
        if not recipients:
            recipients = [row[0] for row in self.session.execute(select(Membership.user_id).where(Membership.org_id == org_id)).all()]
        if not recipients:
            return 0

        for user_id in recipients:
            self.session.add(Notification(
                org_id=org_id,
                user_id=user_id,
                type=NotificationType.IN_APP,
                status=NotificationStatus.PENDING,
                title=title,
                body=body,
                meta=meta,
            ))
        self.session.flush()
        return len(recipients)

    def _purge_org_data(self, *, org_id: uuid.UUID) -> None:
        files = list(self.session.execute(select(File).where(File.org_id == org_id)).scalars().all())
        for f in files:
            try:
                storage.delete_file(f.s3_key, f.s3_bucket)
            except Exception:
                continue

        self.session.execute(delete(AIChatMessage).where(AIChatMessage.org_id == org_id))
        self.session.execute(delete(AIChatSession).where(AIChatSession.org_id == org_id))
        self.session.execute(delete(AIUsageLog).where(AIUsageLog.org_id == org_id))
        self.session.execute(delete(Notification).where(Notification.org_id == org_id))
        self.session.execute(delete(AuditLog).where(AuditLog.org_id == org_id))
        self.session.execute(delete(Event).where(Event.org_id == org_id))
        self.session.execute(delete(KBPage).where(KBPage.org_id == org_id))
        self.session.execute(delete(Record).where(Record.org_id == org_id))
        self.session.execute(delete(Table).where(Table.org_id == org_id))
        self.session.execute(delete(TableFolder).where(TableFolder.org_id == org_id))
        self.session.execute(delete(ReportDashboard).where(ReportDashboard.org_id == org_id))
        self.session.execute(delete(File).where(File.org_id == org_id))
        self.session.flush()
