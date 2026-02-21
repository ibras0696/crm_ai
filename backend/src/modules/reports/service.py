"""Service helpers for dashboard widget execution."""

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.modules.reports.models import ReportWidget
from src.modules.reports.schemas import WidgetConfig, WidgetFilter, WidgetOut
from src.modules.tables.models import Column, Table
from src.modules.tables.records import Record


def parse_float(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return None


def parse_datetime_value(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(float(v), tz=timezone.utc)
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
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
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


async def load_table(session, table_id: uuid.UUID, org_id: uuid.UUID) -> Table | None:
    stmt = select(Table).where(Table.id == table_id, Table.org_id == org_id).options(selectinload(Table.columns))
    return (await session.execute(stmt)).scalar_one_or_none()


async def build_widget_data(session, org_id: uuid.UUID, widget: ReportWidget) -> dict[str, Any]:
    cfg = WidgetConfig.model_validate(widget.config or {})
    if not widget.table_id:
        return {"type": widget.widget_type, "error": "table_id is required"}

    table = await load_table(session, widget.table_id, org_id)
    if not table:
        return {"type": widget.widget_type, "error": "table not found"}

    rec_stmt = select(Record).where(Record.table_id == table.id).order_by(Record.position.asc(), Record.created_at.desc())
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
        selected_ids = cfg.selected_column_ids or [str(c.id) for c in sorted(table.columns, key=lambda c: c.position)[:6]]
        selected_ids = selected_ids[:12]
        header = [columns_map[cid].name if cid in columns_map else cid for cid in selected_ids]
        rows: list[list[str]] = []
        for rec in filtered[: max(1, min(cfg.limit, 200))]:
            rows.append([str(rec.data.get(cid, "")) for cid in selected_ids])
        return {"type": "table", "header": header, "rows": rows, "total": len(filtered)}

    return {"type": widget.widget_type, "error": "unsupported widget_type"}
