"""Service layer and helper functions for reports and dashboards."""

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.repository import ReportsRepository
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
    WidgetConfig,
    WidgetCreateRequest,
    WidgetDataOut,
    WidgetFilter,
    WidgetOut,
    WidgetUpdateRequest,
)
from src.modules.tables.models import Column, Table
from src.modules.tables.records import Record


def parse_float(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return None


def parse_datetime_value(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v
    if isinstance(v, int | float):
        try:
            return datetime.fromtimestamp(float(v), tz=datetime.UTC)
        except (TypeError, ValueError, OSError):
            return None
    if not isinstance(v, str):
        return None
    s = v.strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=datetime.UTC)
        except ValueError:
            continue
    return None


def date_bucket_label(dt: datetime, granularity: str) -> str:
    g = (granularity or "day").strip().lower()
    if g == "month":
        return f"{dt.year:04d}-{dt.month:02d}"
    if g == "week":
        iso_year, iso_week, _ = dt.isocalendar()
        return f"{iso_year:04d}-W{iso_week:02d}"
    return dt.date().isoformat()


def cmp_values(op: str, left: Any, right: Any) -> bool:
    left_s = "" if left is None else str(left)
    right_s = "" if right is None else str(right)
    if op == "eq":
        return left_s == right_s
    if op == "neq":
        return left_s != right_s
    if op == "contains":
        return right_s.lower() in left_s.lower()

    left_n = parse_float(left)
    right_n = parse_float(right)
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


def apply_filters(records: list[Record], filters: list[WidgetFilter]) -> list[Record]:
    if not filters:
        return records
    out: list[Record] = []
    for rec in records:
        ok = True
        for filt in filters:
            left = rec.data.get(filt.column_id)
            if not cmp_values(filt.op, left, filt.value):
                ok = False
                break
        if ok:
            out.append(rec)
    return out


def widget_to_out(widget: ReportWidget) -> WidgetOut:
    return WidgetOut(
        id=str(widget.id),
        title=widget.title,
        widget_type=widget.widget_type,
        table_id=str(widget.table_id) if widget.table_id else None,
        config=WidgetConfig.model_validate(widget.config or {}),
        position=widget.position,
        created_at=widget.created_at,
    )


def aggregate(agg: str, values: list[Any]) -> float | int | None:
    if agg == "count":
        return len(values)
    nums = [parse_float(v) for v in values]
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


async def load_table(session: AsyncSession, table_id: uuid.UUID, org_id: uuid.UUID) -> Table | None:
    stmt = select(Table).where(Table.id == table_id, Table.org_id == org_id).options(selectinload(Table.columns))
    return (await session.execute(stmt)).scalar_one_or_none()


async def build_widget_data(session: AsyncSession, org_id: uuid.UUID, widget: ReportWidget) -> dict[str, Any]:
    cfg = WidgetConfig.model_validate(widget.config or {})
    if not widget.table_id:
        return {"type": widget.widget_type, "error": "table_id is required"}

    table = await load_table(session, widget.table_id, org_id)
    if not table:
        return {"type": widget.widget_type, "error": "table not found"}

    rec_stmt = (
        select(Record)
        .where(Record.table_id == table.id)
        .order_by(Record.position.asc(), Record.created_at.desc())
    )
    records = list((await session.execute(rec_stmt)).scalars().all())
    filtered = apply_filters(records, cfg.filters)

    columns_map: dict[str, Column] = {str(c.id): c for c in table.columns}

    if widget.widget_type == "metric":
        if cfg.aggregation == "count":
            value = len(filtered)
        else:
            if not cfg.value_column_id:
                return {"type": "metric", "error": "value_column_id is required"}
            values = [r.data.get(cfg.value_column_id) for r in filtered]
            value = aggregate(cfg.aggregation, values)
        return {"type": "metric", "label": widget.title, "value": value, "total_records": len(filtered)}

    if widget.widget_type in ("bar", "line", "area", "pie", "donut"):
        use_time_grouping = bool(cfg.time_column_id)
        group_col = cfg.time_column_id if use_time_grouping else cfg.group_by_column_id
        if not group_col:
            return {"type": widget.widget_type, "error": "group_by_column_id or time_column_id is required"}

        grouped: dict[str, list[Record]] = defaultdict(list)
        for rec in filtered:
            raw = rec.data.get(group_col)
            if use_time_grouping:
                dt_value = parse_datetime_value(raw)
                key = date_bucket_label(dt_value, cfg.time_granularity) if dt_value else "(Empty)"
            else:
                key = str(raw) if raw not in (None, "") else "(Empty)"
            grouped[key].append(rec)

        points: list[dict[str, Any]] = []
        for key, rows in grouped.items():
            if cfg.aggregation == "count":
                y = len(rows)
            else:
                if not cfg.value_column_id:
                    continue
                vals = [r.data.get(cfg.value_column_id) for r in rows]
                y = aggregate(cfg.aggregation, vals)
            if y is not None:
                points.append({"x": key, "y": y})

        if use_time_grouping:
            points.sort(key=lambda p: str(p["x"]))
        else:
            points.sort(key=lambda p: p["y"], reverse=True)
        points = points[: max(1, min(cfg.limit, 100))]
        return {
            "type": widget.widget_type,
            "points": points,
            "aggregation": cfg.aggregation,
            "group_by_column": columns_map.get(group_col).name if columns_map.get(group_col) else group_col,
            "time_granularity": cfg.time_granularity if use_time_grouping else None,
        }

    if widget.widget_type == "table":
        selected_ids = cfg.selected_column_ids or [
            str(col.id) for col in sorted(table.columns, key=lambda c: c.position)[:6]
        ]
        selected_ids = selected_ids[:12]
        header = [columns_map[cid].name if cid in columns_map else cid for cid in selected_ids]
        rows: list[list[str]] = []
        for rec in filtered[: max(1, min(cfg.limit, 200))]:
            rows.append([str(rec.data.get(cid, "")) for cid in selected_ids])
        return {"type": "table", "header": header, "rows": rows, "total": len(filtered)}

    return {"type": widget.widget_type, "error": "unsupported widget_type"}


class ReportsService:
    """Application service for reports module."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ReportsRepository(session)

    async def org_summary(self, *, org_id: uuid.UUID) -> OrgReport:
        tables = await self.repo.list_org_tables_with_columns(org_id)
        table_ids = [table.id for table in tables]
        counts = await self.repo.count_records_by_table_ids(table_ids)

        summaries: list[TableSummary] = []
        total_records = 0
        total_columns = 0
        for table in tables:
            cnt = counts.get(table.id, 0)
            total_records += cnt
            col_cnt = len(table.columns)
            total_columns += col_cnt
            summaries.append(
                TableSummary(
                    id=str(table.id),
                    name=table.name,
                    records_count=cnt,
                    columns_count=col_cnt,
                ),
            )
        return OrgReport(
            tables_count=len(tables),
            records_count=total_records,
            columns_count=total_columns,
            tables=summaries,
        )

    async def table_analytics(self, *, org_id: uuid.UUID, body: ColumnAggRequest) -> TableAggResponse | None:
        try:
            table_uuid = uuid.UUID(body.table_id)
        except ValueError:
            return None
        table = await self.repo.get_table_with_columns(org_id, table_uuid)
        if not table:
            return None

        records = await self.repo.list_records_by_table(table.id)
        target_cols = table.columns
        if body.column_ids:
            col_set = set(body.column_ids)
            target_cols = [column for column in table.columns if str(column.id) in col_set]

        col_results: list[ColumnAggResult] = []
        for col in target_cols:
            cid = str(col.id)
            values = [
                rec.data.get(cid)
                for rec in records
                if rec.data.get(cid) is not None and str(rec.data.get(cid)).strip() != ""
            ]
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
                    num = parse_float(val)
                    if num is not None:
                        nums.append(num)
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
            agg.top_values = [{"value": key, "count": count} for key, count in freq.most_common(10)]
            col_results.append(agg)

        return TableAggResponse(
            table_id=str(table.id),
            table_name=table.name,
            total_records=len(records),
            columns=col_results,
        )

    async def records_timeline(self, *, org_id: uuid.UUID, days: int) -> list[TimeSeriesPoint]:
        cutoff = datetime.now(datetime.UTC) - timedelta(days=days)
        rows = await self.repo.records_timeline(org_id, cutoff)
        return [TimeSeriesPoint(date=str(day.date()), count=count) for day, count in rows]

    async def list_dashboards(self, *, org_id: uuid.UUID) -> list[DashboardOut]:
        rows = await self.repo.list_dashboards(org_id)
        return [
            DashboardOut(
                id=str(dash.id),
                name=dash.name,
                description=dash.description,
                created_at=dash.created_at,
            )
            for dash in rows
        ]

    async def create_dashboard(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: DashboardCreateRequest,
    ) -> DashboardOut:
        dash = ReportDashboard(
            org_id=org_id,
            created_by=user_id,
            name=body.name.strip(),
            description=body.description,
        )
        dash = await self.repo.create_dashboard(dash)
        return DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)

    async def update_dashboard(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        body: DashboardUpdateRequest,
    ) -> DashboardOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return None
        if body.name is not None:
            dash.name = body.name.strip()
        if body.description is not None:
            dash.description = body.description
        await self.session.flush()
        return DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)

    async def delete_dashboard(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> bool:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return False
        await self.repo.delete_dashboard(dash)
        return True

    async def get_dashboard(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> DashboardDetailOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id, with_widgets=True)
        if not dash:
            return None
        widgets = [widget_to_out(widget) for widget in sorted(dash.widgets, key=lambda item: item.position)]
        return DashboardDetailOut(id=str(dash.id), name=dash.name, description=dash.description, widgets=widgets)

    async def create_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        body: WidgetCreateRequest,
    ) -> WidgetOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return None
        table_uuid = uuid.UUID(body.table_id) if body.table_id else None
        widget = ReportWidget(
            dashboard_id=dashboard_id,
            org_id=org_id,
            title=body.title,
            widget_type=body.widget_type,
            table_id=table_uuid,
            config=body.config.model_dump(),
            position=body.position,
        )
        widget = await self.repo.create_widget(widget)
        return widget_to_out(widget)

    async def update_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        widget_id: uuid.UUID,
        body: WidgetUpdateRequest,
    ) -> WidgetOut | None:
        widget = await self.repo.get_widget_for_dashboard_org(
            widget_id=widget_id,
            dashboard_id=dashboard_id,
            org_id=org_id,
        )
        if not widget:
            return None
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
        await self.session.flush()
        return widget_to_out(widget)

    async def delete_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        widget_id: uuid.UUID,
    ) -> bool:
        widget = await self.repo.get_widget_for_dashboard_org(
            widget_id=widget_id,
            dashboard_id=dashboard_id,
            org_id=org_id,
        )
        if not widget:
            return False
        await self.repo.delete_widget(widget)
        return True

    async def dashboard_data(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> DashboardDataOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id, with_widgets=True)
        if not dash:
            return None
        ordered_widgets = sorted(dash.widgets, key=lambda item: item.position)
        items: list[WidgetDataOut] = []
        for widget in ordered_widgets:
            data = await build_widget_data(self.session, org_id, widget)
            items.append(WidgetDataOut(widget=widget_to_out(widget), data=data))

        detail = DashboardDetailOut(
            id=str(dash.id),
            name=dash.name,
            description=dash.description,
            widgets=[widget_to_out(widget) for widget in ordered_widgets],
        )
        return DashboardDataOut(dashboard=detail, items=items)
