import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.tables.models import Table
from src.modules.tables.records import Record


class ReportsRepository:
    """Repository for reports module DB operations only."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_org_tables_with_columns(self, org_id: uuid.UUID) -> list[Table]:
        stmt = (
            select(Table)
            .where(Table.org_id == org_id, Table.is_archived.is_(False))
            .options(selectinload(Table.columns))
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_table_with_columns(self, org_id: uuid.UUID, table_id: uuid.UUID) -> Table | None:
        stmt = (
            select(Table)
            .where(Table.id == table_id, Table.org_id == org_id)
            .options(selectinload(Table.columns))
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def count_records_by_table_ids(self, table_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not table_ids:
            return {}
        stmt = (
            select(Record.table_id, func.count(Record.id))
            .where(Record.table_id.in_(table_ids))
            .group_by(Record.table_id)
        )
        rows = (await self.session.execute(stmt)).all()
        return {table_id: int(count) for table_id, count in rows}

    async def list_records_by_table(self, table_id: uuid.UUID) -> list[Record]:
        stmt = (
            select(Record)
            .where(Record.table_id == table_id)
            .order_by(Record.position.asc(), Record.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def records_timeline(self, org_id: uuid.UUID, cutoff: datetime) -> list[tuple[datetime, int]]:
        stmt = (
            select(func.date_trunc("day", Record.created_at).label("day"), func.count().label("cnt"))
            .where(Record.org_id == org_id, Record.created_at >= cutoff)
            .group_by("day")
            .order_by("day")
        )
        rows = (await self.session.execute(stmt)).all()
        return [(row.day, int(row.cnt)) for row in rows]

    async def list_dashboards(self, org_id: uuid.UUID) -> list[ReportDashboard]:
        stmt = (
            select(ReportDashboard)
            .where(ReportDashboard.org_id == org_id)
            .order_by(ReportDashboard.created_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create_dashboard(self, dashboard: ReportDashboard) -> ReportDashboard:
        self.session.add(dashboard)
        await self.session.flush()
        return dashboard

    async def get_dashboard_for_org(
        self,
        *,
        dashboard_id: uuid.UUID,
        org_id: uuid.UUID,
        with_widgets: bool = False,
    ) -> ReportDashboard | None:
        stmt = select(ReportDashboard).where(ReportDashboard.id == dashboard_id, ReportDashboard.org_id == org_id)
        if with_widgets:
            stmt = stmt.options(selectinload(ReportDashboard.widgets))
        result = await self.session.execute(stmt.limit(1))
        return result.scalar_one_or_none()

    async def delete_dashboard(self, dashboard: ReportDashboard) -> None:
        await self.session.delete(dashboard)
        await self.session.flush()

    async def create_widget(self, widget: ReportWidget) -> ReportWidget:
        self.session.add(widget)
        await self.session.flush()
        return widget

    async def get_widget_for_dashboard_org(
        self,
        *,
        widget_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> ReportWidget | None:
        stmt = (
            select(ReportWidget)
            .where(
                ReportWidget.id == widget_id,
                ReportWidget.dashboard_id == dashboard_id,
                ReportWidget.org_id == org_id,
            )
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def delete_widget(self, widget: ReportWidget) -> None:
        await self.session.delete(widget)
        await self.session.flush()
