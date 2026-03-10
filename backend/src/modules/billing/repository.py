from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select

from src.common.enums import PlanTier, SubscriptionStatus, UserRole
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.billing.models import Plan, TokenPackage
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

    async def list_files_for_org(self, *, org_id: uuid.UUID) -> list[File]:
        stmt = select(File).where(File.org_id == org_id)
        return list((await self.session.execute(stmt)).scalars().all())

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
