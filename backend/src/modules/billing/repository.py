from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select

from src.common.enums import NotificationStatus, NotificationType, PlanTier, SubscriptionStatus, UserRole
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.auth.models import User
from src.modules.billing.models import Plan, TokenPackage
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

    from sqlalchemy.ext.asyncio import AsyncSession


class BillingRepository:
    """Репозиторий billing: только SQL-операции."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_active_plans(self) -> list[Plan]:
        stmt = select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price_monthly)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_plan_by_name(self, name: str) -> Plan | None:
        stmt = select(Plan).where(Plan.name == name, Plan.is_active.is_(True))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_active_token_packages(self) -> list[TokenPackage]:
        stmt = (
            select(TokenPackage)
            .where(TokenPackage.is_active.is_(True))
            .order_by(TokenPackage.sort_order.asc(), TokenPackage.created_at.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_active_token_package(self, *, code: str) -> TokenPackage | None:
        stmt = select(TokenPackage).where(
            TokenPackage.code == code,
            TokenPackage.is_active.is_(True),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_usage_counts(self, *, org_id: uuid.UUID) -> tuple[int, int, int, int, int]:
        mem_cnt = (
            await self.session.execute(select(func.count()).select_from(Membership).where(Membership.org_id == org_id))
        ).scalar()
        tbl_cnt = (
            await self.session.execute(select(func.count()).select_from(Table).where(Table.org_id == org_id))
        ).scalar()
        rec_cnt = (
            await self.session.execute(select(func.count()).select_from(Record).where(Record.org_id == org_id))
        ).scalar()
        file_row = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(File.size), 0))
                .select_from(File)
                .where(File.org_id == org_id)
            )
        ).one()
        return (
            int(mem_cnt or 0),
            int(tbl_cnt or 0),
            int(rec_cnt or 0),
            int(file_row[0] or 0),
            int(file_row[1] or 0),
        )

    async def get_subscription(self, *, org_id: uuid.UUID) -> Subscription | None:
        stmt = select(Subscription).where(Subscription.org_id == org_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_subscriptions(self) -> list[Subscription]:
        stmt = select(Subscription)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_org(self, *, org_id: uuid.UUID) -> Organization | None:
        stmt = select(Organization).where(Organization.id == org_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_org_ids(self) -> list[uuid.UUID]:
        rows = (await self.session.execute(select(Organization.id))).all()
        return [row[0] for row in rows]

    async def list_orgs_by_ids(self, org_ids: list[uuid.UUID]) -> dict[uuid.UUID, Organization]:
        if not org_ids:
            return {}
        rows = (await self.session.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all()
        return {org.id: org for org in rows}

    async def list_org_member_user_ids(self, *, org_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = select(Membership.user_id).where(Membership.org_id == org_id)
        rows = (await self.session.execute(stmt)).all()
        return [row[0] for row in rows]

    async def list_org_owner_admin_user_ids(self, *, org_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = select(Membership.user_id).where(
            Membership.org_id == org_id,
            Membership.role.in_([UserRole.OWNER, UserRole.ADMIN]),
        )
        rows = (await self.session.execute(stmt)).all()
        return [row[0] for row in rows]

    async def get_notification_recipient_ids(self, *, org_id: uuid.UUID) -> list[uuid.UUID]:
        recipients = await self.list_org_owner_admin_user_ids(org_id=org_id)
        if recipients:
            return recipients
        return await self.list_org_member_user_ids(org_id=org_id)

    async def get_notification_recipients_with_email(
        self, *, org_id: uuid.UUID
    ) -> list[tuple[uuid.UUID, str, str]]:
        rows = (
            await self.session.execute(
                select(Membership.user_id, User.email, User.locale)
                .join(User, User.id == Membership.user_id)
                .where(
                    Membership.org_id == org_id,
                    Membership.role.in_([UserRole.OWNER, UserRole.ADMIN]),
                )
            )
        ).all()
        if not rows:
            rows = (
                await self.session.execute(
                    select(Membership.user_id, User.email, User.locale)
                    .join(User, User.id == Membership.user_id)
                    .where(Membership.org_id == org_id)
                )
            ).all()
        return [
            (user_id, str(email or "").strip(), str(locale or "ru"))
            for user_id, email, locale in rows
            if str(email or "").strip()
        ]

    async def list_files_for_org(self, *, org_id: uuid.UUID) -> list[File]:
        stmt = select(File).where(File.org_id == org_id)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_active_plan_by_name(self, *, name: str) -> Plan | None:
        stmt = select(Plan).where(Plan.name == name, Plan.is_active.is_(True)).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def count_tables_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            (
                await self.session.execute(select(func.count()).select_from(Table).where(Table.org_id == org_id))
            ).scalar()
            or 0
        )

    async def count_records_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            (
                await self.session.execute(select(func.count()).select_from(Record).where(Record.org_id == org_id))
            ).scalar()
            or 0
        )

    async def sum_file_bytes_for_org(self, *, org_id: uuid.UUID) -> int:
        return int(
            (
                await self.session.execute(select(func.coalesce(func.sum(File.size), 0)).where(File.org_id == org_id))
            ).scalar()
            or 0
        )

    async def list_oldest_tables_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[Table]:
        stmt = (
            select(Table)
            .where(Table.org_id == org_id)
            .order_by(Table.created_at.asc(), Table.id.asc())
            .limit(max(1, int(limit)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_oldest_records_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[Record]:
        stmt = (
            select(Record)
            .where(Record.org_id == org_id)
            .order_by(Record.created_at.asc(), Record.id.asc())
            .limit(max(1, int(limit)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_oldest_files_for_org(self, *, org_id: uuid.UUID, limit: int) -> list[File]:
        stmt = (
            select(File)
            .where(File.org_id == org_id)
            .order_by(File.created_at.asc(), File.id.asc())
            .limit(max(1, int(limit)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_file_versions_for_file_ids(self, *, file_ids: list[uuid.UUID]) -> list[FileVersion]:
        if not file_ids:
            return []
        stmt = select(FileVersion).where(FileVersion.file_id.in_(file_ids))
        return list((await self.session.execute(stmt)).scalars().all())

    async def delete_tables_by_ids(self, *, table_ids: list[uuid.UUID]) -> int:
        if not table_ids:
            return 0
        result = await self.session.execute(delete(Table).where(Table.id.in_(table_ids)))
        await self.session.flush()
        return int(result.rowcount or 0)

    async def delete_records_by_ids(self, *, record_ids: list[uuid.UUID]) -> int:
        if not record_ids:
            return 0
        result = await self.session.execute(delete(Record).where(Record.id.in_(record_ids)))
        await self.session.flush()
        return int(result.rowcount or 0)

    async def delete_file_versions_by_ids(self, *, version_ids: list[uuid.UUID]) -> int:
        if not version_ids:
            return 0
        result = await self.session.execute(delete(FileVersion).where(FileVersion.id.in_(version_ids)))
        await self.session.flush()
        return int(result.rowcount or 0)

    async def delete_files_by_ids(self, *, file_ids: list[uuid.UUID]) -> int:
        if not file_ids:
            return 0
        result = await self.session.execute(delete(File).where(File.id.in_(file_ids)))
        await self.session.flush()
        return int(result.rowcount or 0)

    async def get_storage_usage_row(self, *, org_id: uuid.UUID) -> OrgStorageUsage | None:
        stmt = select(OrgStorageUsage).where(OrgStorageUsage.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def upsert_storage_usage_bytes(self, *, org_id: uuid.UUID, used_bytes: int) -> None:
        usage = await self.get_storage_usage_row(org_id=org_id)
        if usage is None:
            usage = OrgStorageUsage(org_id=org_id, used_bytes=max(0, int(used_bytes)), reserved_bytes=0)
            self.session.add(usage)
        else:
            usage.used_bytes = max(0, int(used_bytes))
        await self.session.flush()

    async def upsert_subscription(
        self,
        *,
        org_id: uuid.UUID,
        plan: PlanTier,
        status: SubscriptionStatus,
        current_period_start: datetime | None = None,
        current_period_end: datetime | None = None,
        external_id: str | None = None,
    ) -> Subscription:
        sub = await self.get_subscription(org_id=org_id)
        if sub:
            sub.plan = plan
            sub.status = status
            sub.current_period_start = current_period_start
            sub.current_period_end = current_period_end
            sub.external_id = external_id
            await self.session.flush()
            return sub
        sub = Subscription(
            org_id=org_id,
            plan=plan,
            status=status,
            current_period_start=current_period_start,
            current_period_end=current_period_end,
            external_id=external_id,
        )
        self.session.add(sub)
        await self.session.flush()
        return sub

    async def activate_subscription(
        self,
        *,
        org_id: uuid.UUID,
        plan: PlanTier,
        current_period_start: datetime,
        current_period_end: datetime,
        external_id: str | None,
    ) -> Subscription:
        sub = await self.upsert_subscription(
            org_id=org_id,
            plan=plan,
            status=SubscriptionStatus.ACTIVE,
            current_period_start=current_period_start,
            current_period_end=current_period_end,
            external_id=external_id,
        )
        sub.grace_period_end = None
        sub.data_purge_at = None
        sub.pre_expiry_notified_at = None
        sub.post_expiry_notified_at = None
        sub.downgraded_at = None
        sub.data_purged_at = None

        org = await self.get_org(org_id=org_id)
        if org is not None:
            org.plan = plan

        await self.session.flush()
        return sub

    async def cancel_subscription_now(self, *, org_id: uuid.UUID, cancelled_at: datetime) -> Subscription:
        sub = await self.upsert_subscription(
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
        sub.downgraded_at = cancelled_at
        sub.data_purged_at = None

        org = await self.get_org(org_id=org_id)
        if org is not None:
            org.plan = PlanTier.FREE

        await self.session.flush()
        return sub

    async def mark_subscription_past_due(
        self,
        *,
        sub: Subscription,
        grace_period_end: datetime,
        data_purge_at: datetime,
    ) -> None:
        sub.status = SubscriptionStatus.PAST_DUE
        sub.grace_period_end = grace_period_end
        sub.data_purge_at = data_purge_at
        await self.session.flush()

    async def downgrade_subscription_to_free(
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
        await self.session.flush()

    async def create_in_app_notifications(
        self,
        *,
        org_id: uuid.UUID,
        user_ids: list[uuid.UUID],
        title: str,
        body: str,
        meta: dict,
    ) -> int:
        if not user_ids:
            return 0

        self.session.add_all(
            [
                Notification(
                    org_id=org_id,
                    user_id=user_id,
                    type=NotificationType.IN_APP,
                    status=NotificationStatus.PENDING,
                    title=title,
                    body=body,
                    meta=meta,
                )
                for user_id in user_ids
            ]
        )
        await self.session.flush()
        return len(user_ids)

    async def delete_org_business_data(self, *, org_id: uuid.UUID) -> None:
        await self.session.execute(delete(AIChatMessage).where(AIChatMessage.org_id == org_id))
        await self.session.execute(delete(AIChatSession).where(AIChatSession.org_id == org_id))
        await self.session.execute(delete(AIUsageLog).where(AIUsageLog.org_id == org_id))
        await self.session.execute(delete(Notification).where(Notification.org_id == org_id))
        await self.session.execute(delete(AuditLog).where(AuditLog.org_id == org_id))
        await self.session.execute(delete(Event).where(Event.org_id == org_id))
        await self.session.execute(delete(KBPage).where(KBPage.org_id == org_id))
        await self.session.execute(delete(Record).where(Record.org_id == org_id))
        await self.session.execute(delete(Table).where(Table.org_id == org_id))
        await self.session.execute(delete(TableFolder).where(TableFolder.org_id == org_id))
        await self.session.execute(delete(ReportDashboard).where(ReportDashboard.org_id == org_id))
        await self.session.execute(delete(File).where(File.org_id == org_id))
        await self.session.flush()
