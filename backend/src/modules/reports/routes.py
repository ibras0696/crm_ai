"""Reports and dashboard builder endpoints."""

import uuid
from collections import Counter
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.access.dependencies import require_access
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.schemas import (
    ColumnAggRequest,
    ColumnAggResult,
    DashboardCreateRequest,
    DashboardDataOut,
    DashboardDetailOut,
    DashboardOut,
    DashboardUpdateRequest,
    OrgReport,
    TableAggResponse,
    TableSummary,
    TimeSeriesPoint,
    WidgetCreateRequest,
    WidgetDataOut,
    WidgetOut,
    WidgetUpdateRequest,
)
from src.modules.reports.service import (
    aggregate,
    build_widget_data,
    parse_float,
    widget_to_out,
)
from src.modules.tables.models import Table
from src.modules.tables.records import Record

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/summary", response_model=ApiResponse[OrgReport])
async def org_summary(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        stmt = (
            select(Table)
            .where(Table.org_id == current_user.org_id, Table.is_archived.is_(False))
            .options(selectinload(Table.columns))
        )
        tables = list((await uow.session.execute(stmt)).scalars().all())

        summaries: list[TableSummary] = []
        total_records = 0
        total_columns = 0
        for table in tables:
            cnt = (await uow.session.execute(select(func.count()).select_from(Record).where(Record.table_id == table.id))).scalar() or 0
            total_records += cnt
            col_cnt = len(table.columns)
            total_columns += col_cnt
            summaries.append(TableSummary(id=str(table.id), name=table.name, records_count=cnt, columns_count=col_cnt))

    report = OrgReport(
        tables_count=len(tables),
        records_count=total_records,
        columns_count=total_columns,
        tables=summaries,
    )
    return ApiResponse(data=report)


@router.post("/table-analytics", response_model=ApiResponse[TableAggResponse])
async def table_analytics(
    body: ColumnAggRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        table = (
            await uow.session.execute(
                select(Table)
                .where(Table.id == uuid.UUID(body.table_id), Table.org_id == current_user.org_id)
                .options(selectinload(Table.columns))
            )
        ).scalar_one_or_none()
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        records = list((await uow.session.execute(select(Record).where(Record.table_id == table.id))).scalars().all())
        target_cols = table.columns
        if body.column_ids:
            col_set = set(body.column_ids)
            target_cols = [c for c in table.columns if str(c.id) in col_set]

        col_results: list[ColumnAggResult] = []
        for col in target_cols:
            cid = str(col.id)
            values = [r.data.get(cid) for r in records if r.data.get(cid) is not None and str(r.data.get(cid)).strip() != ""]
            non_empty = len(values)
            agg = ColumnAggResult(
                column_id=cid,
                column_name=col.name,
                field_type=col.field_type,
                count=len(records),
                non_empty=non_empty,
            )

            if col.field_type in ("number", "formula"):
                nums: list[float] = []
                for val in values:
                    n = parse_float(val)
                    if n is not None:
                        nums.append(n)
                if nums:
                    agg.sum = round(sum(nums), 4)
                    agg.avg = round(sum(nums) / len(nums), 4)
                    agg.min_val = str(min(nums))
                    agg.max_val = str(max(nums))
            else:
                if values:
                    str_vals = [str(v) for v in values]
                    agg.min_val = min(str_vals)
                    agg.max_val = max(str_vals)

            freq = Counter(str(v) for v in values)
            agg.top_values = [{"value": k, "count": c} for k, c in freq.most_common(10)]
            col_results.append(agg)

    resp = TableAggResponse(
        table_id=str(table.id),
        table_name=table.name,
        total_records=len(records),
        columns=col_results,
    )
    return ApiResponse(data=resp)


@router.get("/timeline", response_model=ApiResponse[list[TimeSeriesPoint]])
async def records_timeline(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    days: int = 30,
):
    from datetime import timedelta, timezone as tz

    cutoff = datetime.now(tz.utc) - timedelta(days=days)
    async with UnitOfWork() as uow:
        stmt = (
            select(func.date_trunc("day", Record.created_at).label("day"), func.count().label("cnt"))
            .where(Record.org_id == current_user.org_id, Record.created_at >= cutoff)
            .group_by("day")
            .order_by("day")
        )
        rows = (await uow.session.execute(stmt)).all()
    points = [TimeSeriesPoint(date=str(r.day.date()), count=r.cnt) for r in rows]
    return ApiResponse(data=points)


@router.get("/dashboards", response_model=ApiResponse[list[DashboardOut]])
async def list_dashboards(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        rows = list((await uow.session.execute(select(ReportDashboard).where(ReportDashboard.org_id == current_user.org_id).order_by(ReportDashboard.created_at.desc()))).scalars().all())
    items = [DashboardOut(id=str(d.id), name=d.name, description=d.description, created_at=d.created_at) for d in rows]
    return ApiResponse(data=items)


@router.post("/dashboards", response_model=ApiResponse[DashboardOut])
async def create_dashboard(
    body: DashboardCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_write")),
):
    async with UnitOfWork() as uow:
        dash = ReportDashboard(org_id=current_user.org_id, created_by=current_user.user_id, name=body.name.strip(), description=body.description)
        uow.session.add(dash)
        await uow.session.flush()
        await uow.commit()
    return ApiResponse(data=DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at))


@router.patch("/dashboards/{dashboard_id}", response_model=ApiResponse[DashboardOut])
async def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_write", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        dash = await uow.session.get(ReportDashboard, dashboard_id)
        if not dash or dash.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})
        if body.name is not None:
            dash.name = body.name.strip()
        if body.description is not None:
            dash.description = body.description
        await uow.commit()
    return ApiResponse(data=DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at))


@router.delete("/dashboards/{dashboard_id}", response_model=ApiResponse[None])
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_delete", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        dash = await uow.session.get(ReportDashboard, dashboard_id)
        if not dash or dash.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})
        await uow.session.delete(dash)
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/dashboards/{dashboard_id}", response_model=ApiResponse[DashboardDetailOut])
async def get_dashboard(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        dash = (
            await uow.session.execute(
                select(ReportDashboard)
                .where(ReportDashboard.id == dashboard_id, ReportDashboard.org_id == current_user.org_id)
                .options(selectinload(ReportDashboard.widgets))
            )
        ).scalar_one_or_none()
        if not dash:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})
        widgets = [widget_to_out(w) for w in sorted(dash.widgets, key=lambda i: i.position)]
    return ApiResponse(data=DashboardDetailOut(id=str(dash.id), name=dash.name, description=dash.description, widgets=widgets))


@router.post("/dashboards/{dashboard_id}/widgets", response_model=ApiResponse[WidgetOut])
async def create_widget(
    dashboard_id: uuid.UUID,
    body: WidgetCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_write", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        dash = await uow.session.get(ReportDashboard, dashboard_id)
        if not dash or dash.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})
        table_uuid = uuid.UUID(body.table_id) if body.table_id else None
        widget = ReportWidget(
            dashboard_id=dashboard_id,
            org_id=current_user.org_id,
            title=body.title,
            widget_type=body.widget_type,
            table_id=table_uuid,
            config=body.config.model_dump(),
            position=body.position,
        )
        uow.session.add(widget)
        await uow.session.flush()
        await uow.commit()
    return ApiResponse(data=widget_to_out(widget))


@router.patch("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[WidgetOut])
async def update_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    body: WidgetUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_write", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        widget = await uow.session.get(ReportWidget, widget_id)
        if not widget or widget.org_id != current_user.org_id or widget.dashboard_id != dashboard_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Виджет не найден"})
        if body.title is not None:
            widget.title = body.title
        if body.widget_type is not None:
            widget.widget_type = body.widget_type
        if body.table_id is not None:
            widget.table_id = uuid.UUID(body.table_id) if body.table_id else None
        if body.config is not None:
            widget.config = body.config.model_dump()
        if body.position is not None:
            widget.position = body.position
        await uow.commit()
    return ApiResponse(data=widget_to_out(widget))


@router.delete("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[None])
async def delete_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_delete", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        widget = await uow.session.get(ReportWidget, widget_id)
        if not widget or widget.org_id != current_user.org_id or widget.dashboard_id != dashboard_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Виджет не найден"})
        await uow.session.delete(widget)
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/dashboards/{dashboard_id}/data", response_model=ApiResponse[DashboardDataOut])
async def dashboard_data(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        dash = (
            await uow.session.execute(
                select(ReportDashboard)
                .where(ReportDashboard.id == dashboard_id, ReportDashboard.org_id == current_user.org_id)
                .options(selectinload(ReportDashboard.widgets))
            )
        ).scalar_one_or_none()
        if not dash:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})

        ordered_widgets = sorted(dash.widgets, key=lambda i: i.position)
        items: list[WidgetDataOut] = []
        for widget in ordered_widgets:
            data = await build_widget_data(uow.session, current_user.org_id, widget)
            items.append(WidgetDataOut(widget=widget_to_out(widget), data=data))

        detail = DashboardDetailOut(
            id=str(dash.id),
            name=dash.name,
            description=dash.description,
            widgets=[widget_to_out(w) for w in ordered_widgets],
        )
    return ApiResponse(data=DashboardDataOut(dashboard=detail, items=items))
