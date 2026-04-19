from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select

from src.common.enums import NotificationStatus, NotificationType, PlanTier, SubscriptionStatus, UserRole
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.auth.models import User
from src.modules.billing.models import Plan, TokenBalance, TokenPurchase
from src.modules.docs.models import FileVersion, OrgStorageUsage
from src.modules.files.models import File
from src.modules.knowledge.models import KBPage
from src.modules.notifications.models import Notification
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.reports.models import ReportDashboard
from src.modules.schedule.models import Event
from src.modules.tables.models import Table, TableFolder
from src.modules.tables.records import Record

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.orm import Session


class BillingSyncRepository:
    """Sync-репозиторий billing lifecycle: только SQL/ORM операции."""

    def __init__(self, session: Session):
        self.session = session

    def list_subscriptions(self) -> list[Subscription]:
        return list(self.session.execute(select(Subscription)).scalars().all())

    def list_organizations_by_ids(self, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, Organization]:
        if not org_ids:
            return {}
        rows = list(self.session.execute(select(Organization).where(Organization.id.in_(org_ids))).scalars().all())
        return {org.id: org for org in rows}

    def list_all_org_ids(self) -> list[uuid.UUID]:
        return [row[0] for row in self.session.execute(select(Organization.id)).all()]

    def list_expired_active_purchases(self, *, org_ids: list[uuid.UUID], now_utc: datetime) -> list[TokenPurchase]:
        if not org_ids:
            return []
        return list(
            self.session.execute(
                select(TokenPurchase).where(
                    TokenPurchase.org_id.in_(org_ids),
                    TokenPurchase.is_active.is_(True),
                    TokenPurchase.expires_at.is_not(None),
                    TokenPurchase.expires_at <= now_utc,
                )
            )
            .scalars()
            .all()
        )

    def sum_active_addon_tokens_by_org(self, *, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not org_ids:
            return {}
        rows = self.session.execute(
            select(TokenPurchase.org_id, func.coalesce(func.sum(TokenPurchase.tokens_remaining), 0))
            .where(
                TokenPurchase.org_id.in_(org_ids),
                TokenPurchase.is_active.is_(True),
                TokenPurchase.tokens_remaining > 0,
            )
            .group_by(TokenPurchase.org_id)
        ).all()
        return {org_id: int(total or 0) for org_id, total in rows}

    def list_active_subscription_plans_by_org(self, *, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not org_ids:
            return {}
        rows = self.session.execute(
            select(Subscription.org_id, Subscription.plan).where(
                Subscription.org_id.in_(org_ids),
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        ).all()
        out: dict[uuid.UUID, str] = {}
        for org_id, plan in rows:
            if plan is not None:
                out[org_id] = plan.value if hasattr(plan, "value") else str(plan)
        return out

    def list_org_plans(self, *, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not org_ids:
            return {}
        rows = self.session.execute(
            select(Organization.id, Organization.plan).where(Organization.id.in_(org_ids))
        ).all()
        return {org_id: (plan.value if hasattr(plan, "value") else str(plan or "free")) for org_id, plan in rows}

    def list_active_plan_ai_quota_by_name(self) -> dict[str, int]:
        plans = self.session.execute(select(Plan).where(Plan.is_active.is_(True))).scalars().all()
        return {str(plan.name).lower(): int(getattr(plan, "ai_tokens_per_day", 0) or 0) for plan in plans}

    def list_token_balances_by_org(self, *, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, TokenBalance]:
        if not org_ids:
            return {}
        balances = self.session.execute(select(TokenBalance).where(TokenBalance.org_id.in_(org_ids))).scalars().all()
        return {b.org_id: b for b in balances}

    def add_token_balance(self, *, org_id: uuid.UUID, cycle: str, quota: int, addon_total: int) -> None:
        self.session.add(
            TokenBalance(
                org_id=org_id,
                plan_cycle_key=cycle,
                plan_tokens_monthly_quota=quota,
                plan_tokens_remaining=quota,
                addon_tokens_remaining=addon_total,
            )
        )

    def get_notification_recipients(self, *, org_id: uuid.UUID) -> list[uuid.UUID]:
        recipients = [
            row[0]
            for row in self.session.execute(
                select(Membership.user_id).where(
                    Membership.org_id == org_id,
                    Membership.role.in_([UserRole.OWNER, UserRole.ADMIN]),
                )
            ).all()
        ]
        if recipients:
            return recipients
        return [
            row[0] for row in self.session.execute(select(Membership.user_id).where(Membership.org_id == org_id)).all()
        ]

    def get_notification_recipients_with_email(self, *, org_id: uuid.UUID) -> list[tuple[uuid.UUID, str, str]]:
        rows = self.session.execute(
            select(Membership.user_id, User.email, User.locale)
            .join(User, User.id == Membership.user_id)
            .where(
                Membership.org_id == org_id,
                Membership.role.in_([UserRole.OWNER, UserRole.ADMIN]),
            )
        ).all()
        if not rows:
            rows = self.session.execute(
                select(Membership.user_id, User.email, User.locale)
                .join(User, User.id == Membership.user_id)
                .where(Membership.org_id == org_id)
            ).all()
        return [
            (user_id, str(email or "").strip(), str(locale or "ru"))
            for user_id, email, locale in rows
            if str(email or "").strip()
        ]

    def add_in_app_notification(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        title: str,
        body: str,
        meta: dict,
    ) -> None:
        self.session.add(
            Notification(
                org_id=org_id,
                user_id=user_id,
                type=NotificationType.IN_APP,
                status=NotificationStatus.PENDING,
                title=title,
                body=body,
                meta=meta,
            )
        )

    def flush(self) -> None:
        self.session.flush()

    def mark_subscription_past_due(
        self,
        *,
        sub: Subscription,
        grace_period_end: datetime,
        data_purge_at: datetime,
    ) -> None:
        sub.status = SubscriptionStatus.PAST_DUE
        sub.grace_period_end = grace_period_end
        sub.data_purge_at = data_purge_at
        self.session.flush()

    def downgrade_subscription_to_free(
        self,
        *,
        sub: Subscription,
        org: Organization,
        downgraded_at: datetime,
        data_purge_at: datetime,
    ) -> None:
        sub.status = SubscriptionStatus.CANCELLED
        sub.plan = PlanTier.FREE
        sub.downgraded_at = downgraded_at
        sub.data_purge_at = data_purge_at
        org.plan = PlanTier.FREE
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def list_files_by_org(self, *, org_id: uuid.UUID) -> list[File]:
        return list(self.session.execute(select(File).where(File.org_id == org_id)).scalars().all())

    def get_active_plan_by_name(self, *, name: str) -> Plan | None:
        return self.session.execute(
            select(Plan).where(Plan.name == name, Plan.is_active.is_(True)).limit(1)
        ).scalar_one_or_none()

    def count_tables_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            self.session.execute(select(func.count()).select_from(Table).where(Table.org_id == org_id)).scalar() or 0
        )

    def count_records_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            self.session.execute(select(func.count()).select_from(Record).where(Record.org_id == org_id)).scalar() or 0
        )

    def sum_file_bytes_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            self.session.execute(select(func.coalesce(func.sum(File.size), 0)).where(File.org_id == org_id)).scalar()
            or 0
        )

    def list_oldest_tables_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[Table]:
        return list(
            self.session.execute(
                select(Table)
                .where(Table.org_id == org_id)
                .order_by(Table.created_at.asc(), Table.id.asc())
                .limit(max(1, int(limit)))
            )
            .scalars()
            .all()
        )

    def list_oldest_records_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[Record]:
        return list(
            self.session.execute(
                select(Record)
                .where(Record.org_id == org_id)
                .order_by(Record.created_at.asc(), Record.id.asc())
                .limit(max(1, int(limit)))
            )
            .scalars()
            .all()
        )

    def list_oldest_files_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[File]:
        return list(
            self.session.execute(
                select(File)
                .where(File.org_id == org_id)
                .order_by(File.created_at.asc(), File.id.asc())
                .limit(max(1, int(limit)))
            )
            .scalars()
            .all()
        )

    def list_file_versions_for_file_ids(self, *, file_ids: list[uuid.UUID]) -> list[FileVersion]:
        if not file_ids:
            return []
        return list(self.session.execute(select(FileVersion).where(FileVersion.file_id.in_(file_ids))).scalars().all())

    def delete_tables_by_ids(self, *, table_ids: list[uuid.UUID]) -> int:
        if not table_ids:
            return 0
        result = self.session.execute(delete(Table).where(Table.id.in_(table_ids)))
        self.session.flush()
        return int(result.rowcount or 0)

    def delete_records_by_ids(self, *, record_ids: list[uuid.UUID]) -> int:
        if not record_ids:
            return 0
        result = self.session.execute(delete(Record).where(Record.id.in_(record_ids)))
        self.session.flush()
        return int(result.rowcount or 0)

    def delete_file_versions_by_ids(self, *, version_ids: list[uuid.UUID]) -> int:
        if not version_ids:
            return 0
        result = self.session.execute(delete(FileVersion).where(FileVersion.id.in_(version_ids)))
        self.session.flush()
        return int(result.rowcount or 0)

    def delete_files_by_ids(self, *, file_ids: list[uuid.UUID]) -> int:
        if not file_ids:
            return 0
        result = self.session.execute(delete(File).where(File.id.in_(file_ids)))
        self.session.flush()
        return int(result.rowcount or 0)

    def get_storage_usage_row(self, *, org_id: uuid.UUID) -> OrgStorageUsage | None:
        return self.session.execute(
            select(OrgStorageUsage).where(OrgStorageUsage.org_id == org_id).limit(1)
        ).scalar_one_or_none()

    def upsert_storage_usage_bytes(self, *, org_id: uuid.UUID, used_bytes: int) -> None:
        usage = self.get_storage_usage_row(org_id=org_id)
        if usage is None:
            self.session.add(OrgStorageUsage(org_id=org_id, used_bytes=max(0, int(used_bytes)), reserved_bytes=0))
        else:
            usage.used_bytes = max(0, int(used_bytes))
        self.session.flush()

    def delete_org_data_rows(self, *, org_id: uuid.UUID) -> None:
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
