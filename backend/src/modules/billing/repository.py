from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import PlanTier, SubscriptionStatus
from src.modules.billing.models import Plan
from src.modules.files.models import File
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.tables.models import Table
from src.modules.tables.records import Record


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

    async def get_usage_counts(self, *, org_id: uuid.UUID) -> tuple[int, int, int, int, int]:
        mem_cnt = (
            await self.session.execute(
                select(func.count()).select_from(Membership).where(Membership.org_id == org_id)
            )
        ).scalar()
        tbl_cnt = (
            await self.session.execute(
                select(func.count()).select_from(Table).where(Table.org_id == org_id)
            )
        ).scalar()
        rec_cnt = (
            await self.session.execute(
                select(func.count()).select_from(Record).where(Record.org_id == org_id)
            )
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

    async def get_org(self, *, org_id: uuid.UUID) -> Organization | None:
        stmt = select(Organization).where(Organization.id == org_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

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

