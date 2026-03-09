from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select

from src.common.enums import NotificationStatus, NotificationType, SubscriptionStatus, UserRole
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.billing.models import Plan, TokenBalance, TokenPurchase
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

    def commit(self) -> None:
        self.session.commit()

    def list_files_by_org(self, *, org_id: uuid.UUID) -> list[File]:
        return list(self.session.execute(select(File).where(File.org_id == org_id)).scalars().all())

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
