"""Reports and dashboard builder endpoints."""
import uuid
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.tables.models import Column, Table
from src.modules.tables.records import Record

router = APIRouter(prefix="/reports", tags=["reports"])


class TableSummary(BaseModel):
    id: str
    name: str
    records_count: int
    columns_count: int


class OrgReport(BaseModel):
    tables_count: int
    records_count: int
    columns_count: int
    tables: list[TableSummary]


@router.get("/summary", response_model=ApiResponse[OrgReport])
async def org_summary(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        stmt = (
            select(Table)
            .where(Table.org_id == current_user.org_id, Table.is_archived.is_(False))
            .options(selectinload(Table.columns))
        )
        result = await uow.session.execute(stmt)
        tables = list(result.scalars().all())

        summaries: list[TableSummary] = []
        total_records = 0
        total_columns = 0
        for t in tables:
            cnt_stmt = select(func.count()).select_from(Record).where(Record.table_id == t.id)
            cnt_result = await uow.session.execute(cnt_stmt)
            cnt = cnt_result.scalar() or 0
            total_records += cnt
            col_cnt = len(t.columns)
            total_columns += col_cnt
            summaries.append(TableSummary(id=str(t.id), name=t.name, records_count=cnt, columns_count=col_cnt))

        report = OrgReport(
            tables_count=len(tables),
            records_count=total_records,
            columns_count=total_columns,
            tables=summaries,
        )
    return ApiResponse(data=report)


class ColumnAggRequest(BaseModel):
    table_id: str
    column_ids: list[str] = []


class ColumnAggResult(BaseModel):
    column_id: str
    column_name: str
    field_type: str
    count: int
    non_empty: int
    sum: float | None = None
    avg: float | None = None
    min_val: str | None = None
    max_val: str | None = None
    top_values: list[dict] | None = None


class TableAggResponse(BaseModel):
    table_id: str
    table_name: str
    total_records: int
    columns: list[ColumnAggResult]


@router.post("/table-analytics", response_model=ApiResponse[TableAggResponse])
async def table_analytics(
    body: ColumnAggRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        tbl_stmt = (
            select(Table)
            .where(Table.id == uuid.UUID(body.table_id), Table.org_id == current_user.org_id)
            .options(selectinload(Table.columns))
        )
        tbl_result = await uow.session.execute(tbl_stmt)
        table = tbl_result.scalar_one_or_none()
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        rec_stmt = select(Record).where(Record.table_id == table.id)
        rec_result = await uow.session.execute(rec_stmt)
        records = list(rec_result.scalars().all())

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
                for v in values:
                    try:
                        nums.append(float(v))
                    except (ValueError, TypeError):
                        pass
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


class TimeSeriesPoint(BaseModel):
    date: str
    count: int


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


class DashboardOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime


class DashboardCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class DashboardUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None


class WidgetFilter(BaseModel):
    column_id: str
    op: str = "eq"  # eq|neq|contains|gt|lt|gte|lte
    value: str | float | int | bool


class WidgetConfig(BaseModel):
    aggregation: str = "count"  # count|sum|avg|min|max
    value_column_id: str | None = None
    group_by_column_id: str | None = None
    filters: list[WidgetFilter] = Field(default_factory=list)
    limit: int = 10
    selected_column_ids: list[str] = Field(default_factory=list)


class WidgetOut(BaseModel):
    id: str
    title: str
    widget_type: str
    table_id: str | None
    config: WidgetConfig
    position: int
    created_at: datetime


class WidgetCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    widget_type: str = "metric"  # metric|bar|line|pie|table
    table_id: str | None = None
    config: WidgetConfig = Field(default_factory=WidgetConfig)
    position: int = 0


class WidgetUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    widget_type: str | None = None
    table_id: str | None = None
    config: WidgetConfig | None = None
    position: int | None = None


class DashboardDetailOut(BaseModel):
    id: str
    name: str
    description: str | None
    widgets: list[WidgetOut]


class WidgetDataOut(BaseModel):
    widget: WidgetOut
    data: dict[str, Any]


class DashboardDataOut(BaseModel):
    dashboard: DashboardDetailOut
    items: list[WidgetDataOut]


def _parse_float(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return None


def _cmp(op: str, left: Any, right: Any) -> bool:
    left_s = "" if left is None else str(left)
    right_s = "" if right is None else str(right)
    if op == "eq":
        return left_s == right_s
    if op == "neq":
        return left_s != right_s
    if op == "contains":
        return right_s.lower() in left_s.lower()

    left_n = _parse_float(left)
    right_n = _parse_float(right)
    if left_n is None or right_n is None:
        if op == "gt":
            return left_s > right_s
        if op == "lt":
            return left_s < right_s
        if op == "gte":
            return left_s >= right_s
        if op == "lte":
            return left_s <= right_s
        return False

    if op == "gt":
        return left_n > right_n
    if op == "lt":
        return left_n < right_n
    if op == "gte":
        return left_n >= right_n
    if op == "lte":
        return left_n <= right_n
    return False


def _apply_filters(records: list[Record], filters: list[WidgetFilter]) -> list[Record]:
    if not filters:
        return records
    out: list[Record] = []
    for rec in records:
        ok = True
        for f in filters:
            left = rec.data.get(f.column_id)
            if not _cmp(f.op, left, f.value):
                ok = False
                break
        if ok:
            out.append(rec)
    return out


def _widget_to_out(w: ReportWidget) -> WidgetOut:
    return WidgetOut(
        id=str(w.id),
        title=w.title,
        widget_type=w.widget_type,
        table_id=str(w.table_id) if w.table_id else None,
        config=WidgetConfig.model_validate(w.config or {}),
        position=w.position,
        created_at=w.created_at,
    )


def _aggregate(agg: str, values: list[Any]) -> float | int | None:
    if agg == "count":
        return len(values)
    nums = [_parse_float(v) for v in values]
    nums = [n for n in nums if n is not None]
    if not nums:
        return None
    if agg == "sum":
        return round(sum(nums), 4)
    if agg == "avg":
        return round(sum(nums) / len(nums), 4)
    if agg == "min":
        return min(nums)
    if agg == "max":
        return max(nums)
    return None


async def _load_table(session, table_id: uuid.UUID, org_id: uuid.UUID) -> Table | None:
    stmt = (
        select(Table)
        .where(Table.id == table_id, Table.org_id == org_id)
        .options(selectinload(Table.columns))
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _build_widget_data(session, org_id: uuid.UUID, widget: ReportWidget) -> dict[str, Any]:
    cfg = WidgetConfig.model_validate(widget.config or {})
    if not widget.table_id:
        return {"type": widget.widget_type, "error": "table_id is required"}

    table = await _load_table(session, widget.table_id, org_id)
    if not table:
        return {"type": widget.widget_type, "error": "table not found"}

    rec_stmt = select(Record).where(Record.table_id == table.id).order_by(Record.position.asc(), Record.created_at.desc())
    records = list((await session.execute(rec_stmt)).scalars().all())
    filtered = _apply_filters(records, cfg.filters)

    columns_map: dict[str, Column] = {str(c.id): c for c in table.columns}

    if widget.widget_type == "metric":
        if cfg.aggregation == "count":
            value = len(filtered)
        else:
            if not cfg.value_column_id:
                return {"type": "metric", "error": "value_column_id is required"}
            values = [r.data.get(cfg.value_column_id) for r in filtered]
            value = _aggregate(cfg.aggregation, values)
        return {
            "type": "metric",
            "label": widget.title,
            "value": value,
            "total_records": len(filtered),
        }

    if widget.widget_type in ("bar", "line", "pie"):
        group_col = cfg.group_by_column_id
        if not group_col:
            return {"type": widget.widget_type, "error": "group_by_column_id is required"}

        grouped: dict[str, list[Record]] = defaultdict(list)
        for rec in filtered:
            raw = rec.data.get(group_col)
            key = str(raw) if raw not in (None, "") else "(Пусто)"
            grouped[key].append(rec)

        points: list[dict[str, Any]] = []
        for key, rows in grouped.items():
            if cfg.aggregation == "count":
                y = len(rows)
            else:
                if not cfg.value_column_id:
                    continue
                vals = [r.data.get(cfg.value_column_id) for r in rows]
                y = _aggregate(cfg.aggregation, vals)
            if y is not None:
                points.append({"x": key, "y": y})

        points.sort(key=lambda p: p["y"], reverse=True)
        points = points[: max(1, min(cfg.limit, 100))]
        return {
            "type": widget.widget_type,
            "points": points,
            "aggregation": cfg.aggregation,
            "group_by_column": columns_map.get(group_col).name if columns_map.get(group_col) else group_col,
        }

    if widget.widget_type == "table":
        selected_ids = cfg.selected_column_ids or [str(c.id) for c in sorted(table.columns, key=lambda c: c.position)[:6]]
        selected_ids = selected_ids[:12]
        header = [columns_map[cid].name if cid in columns_map else cid for cid in selected_ids]
        rows: list[list[str]] = []
        for rec in filtered[: max(1, min(cfg.limit, 200))]:
            rows.append([str(rec.data.get(cid, "")) for cid in selected_ids])
        return {
            "type": "table",
            "header": header,
            "rows": rows,
            "total": len(filtered),
        }

    return {"type": widget.widget_type, "error": "unsupported widget_type"}


@router.get("/dashboards", response_model=ApiResponse[list[DashboardOut]])
async def list_dashboards(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        stmt = select(ReportDashboard).where(ReportDashboard.org_id == current_user.org_id).order_by(ReportDashboard.created_at.desc())
        rows = list((await uow.session.execute(stmt)).scalars().all())
        items = [DashboardOut(id=str(d.id), name=d.name, description=d.description, created_at=d.created_at) for d in rows]
    return ApiResponse(data=items)


@router.post("/dashboards", response_model=ApiResponse[DashboardOut])
async def create_dashboard(
    body: DashboardCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        dash = ReportDashboard(
            org_id=current_user.org_id,
            created_by=current_user.user_id,
            name=body.name.strip(),
            description=body.description,
        )
        uow.session.add(dash)
        await uow.session.flush()
        await uow.commit()
        item = DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)
    return ApiResponse(data=item)


@router.patch("/dashboards/{dashboard_id}", response_model=ApiResponse[DashboardOut])
async def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
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
        item = DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)
    return ApiResponse(data=item)


@router.delete("/dashboards/{dashboard_id}", response_model=ApiResponse[None])
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
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
):
    async with UnitOfWork() as uow:
        stmt = (
            select(ReportDashboard)
            .where(ReportDashboard.id == dashboard_id, ReportDashboard.org_id == current_user.org_id)
            .options(selectinload(ReportDashboard.widgets))
        )
        dash = (await uow.session.execute(stmt)).scalar_one_or_none()
        if not dash:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})
        widgets = [_widget_to_out(w) for w in sorted(dash.widgets, key=lambda i: i.position)]
        item = DashboardDetailOut(id=str(dash.id), name=dash.name, description=dash.description, widgets=widgets)
    return ApiResponse(data=item)


@router.post("/dashboards/{dashboard_id}/widgets", response_model=ApiResponse[WidgetOut])
async def create_widget(
    dashboard_id: uuid.UUID,
    body: WidgetCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
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
        item = _widget_to_out(widget)
    return ApiResponse(data=item)


@router.patch("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[WidgetOut])
async def update_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    body: WidgetUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
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
        item = _widget_to_out(widget)
    return ApiResponse(data=item)


@router.delete("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[None])
async def delete_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
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
):
    async with UnitOfWork() as uow:
        stmt = (
            select(ReportDashboard)
            .where(ReportDashboard.id == dashboard_id, ReportDashboard.org_id == current_user.org_id)
            .options(selectinload(ReportDashboard.widgets))
        )
        dash = (await uow.session.execute(stmt)).scalar_one_or_none()
        if not dash:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Дашборд не найден"})

        ordered_widgets = sorted(dash.widgets, key=lambda i: i.position)
        items: list[WidgetDataOut] = []
        for w in ordered_widgets:
            data = await _build_widget_data(uow.session, current_user.org_id, w)
            items.append(WidgetDataOut(widget=_widget_to_out(w), data=data))

        detail = DashboardDetailOut(
            id=str(dash.id),
            name=dash.name,
            description=dash.description,
            widgets=[_widget_to_out(w) for w in ordered_widgets],
        )

    return ApiResponse(data=DashboardDataOut(dashboard=detail, items=items))
