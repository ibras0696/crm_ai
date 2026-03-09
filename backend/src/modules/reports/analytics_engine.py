"""Shared analytics/query helpers for reports dashboards."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from src.modules.reports.models import ReportWidget
from src.modules.reports.repository import ReportsRepository
from src.modules.reports.schemas import (
    AnalyticsFieldOut,
    AnalyticsFilter,
    AnalyticsMetric,
    AnalyticsQueryRequest,
    AnalyticsSort,
    AnalyticsTableSchemaOut,
    WidgetConfig,
    WidgetOut,
)
from src.modules.tables.models import Column, Table
from src.modules.tables.records import Record

NUMBER_LIKE_TYPES = {"number", "formula"}
DATE_LIKE_TYPES = {"date", "datetime"}
LIST_LIKE_TYPES = {"select", "multi_select"}
BOOLEAN_LIKE_TYPES = {"boolean"}


def parse_float(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return None


def parse_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if isinstance(v, int | float):
        if v == 1:
            return True
        if v == 0:
            return False
    if isinstance(v, str):
        normalized = v.strip().lower()
        if normalized in {"true", "1", "yes", "да"}:
            return True
        if normalized in {"false", "0", "no", "нет"}:
            return False
    return None


def parse_datetime_value(v: Any) -> datetime | None:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, int | float):
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
        parsed = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def analytics_type_for_field(field_type: str) -> str:
    normalized = str(field_type or "").lower()
    if normalized in NUMBER_LIKE_TYPES:
        return "number"
    if normalized in DATE_LIKE_TYPES:
        return "date"
    if normalized in LIST_LIKE_TYPES:
        return "list"
    if normalized in BOOLEAN_LIKE_TYPES:
        return "boolean"
    return "text"


def filter_ops_for_field(field_type: str) -> list[str]:
    analytics_type = analytics_type_for_field(field_type)
    if analytics_type == "number":
        return ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"]
    if analytics_type == "date":
        return ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty"]
    if analytics_type == "boolean":
        return ["eq", "neq", "is_empty", "not_empty"]
    if analytics_type == "list":
        return ["eq", "neq", "contains", "in", "not_in", "is_empty", "not_empty"]
    return ["eq", "neq", "contains", "in", "not_in", "is_empty", "not_empty"]


def aggregations_for_field(field_type: str) -> list[str]:
    analytics_type = analytics_type_for_field(field_type)
    if analytics_type == "number":
        return ["count", "sum", "avg", "min", "max"]
    if analytics_type == "date":
        return ["count", "min", "max"]
    return ["count"]


def date_bucket_label(dt: datetime, granularity: str) -> str:
    g = (granularity or "day").strip().lower()
    if g == "month":
        return f"{dt.year:04d}-{dt.month:02d}"
    if g == "week":
        iso_year, iso_week, _ = dt.isocalendar()
        return f"{iso_year:04d}-W{iso_week:02d}"
    return dt.date().isoformat()


def value_is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def normalize_filter_values(filt: AnalyticsFilter) -> list[Any]:
    if filt.values:
        return list(filt.values)
    if isinstance(filt.value, list):
        return list(filt.value)
    if filt.value is None:
        return []
    return [filt.value]


def compare_values(op: str, left: Any, filt: AnalyticsFilter) -> bool:
    if op == "is_empty":
        return value_is_empty(left)
    if op == "not_empty":
        return not value_is_empty(left)

    if isinstance(left, list):
        values = ["" if item is None else str(item) for item in left]
        right_value = "" if filt.value is None else str(filt.value)
        right_values = {str(item) for item in normalize_filter_values(filt)}
        if op == "eq":
            return right_value in values
        if op == "neq":
            return right_value not in values
        if op == "contains":
            return any(right_value.lower() in item.lower() for item in values)
        if op == "in":
            return any(item in right_values for item in values)
        if op == "not_in":
            return all(item not in right_values for item in values)
        left = ",".join(values)

    left_s = "" if left is None else str(left)
    right_s = "" if filt.value is None else str(filt.value)

    left_b = parse_bool(left)
    right_b = parse_bool(filt.value)
    if left_b is not None and right_b is not None and op in {"eq", "neq"}:
        return left_b == right_b if op == "eq" else left_b != right_b

    if op == "eq":
        return left_s == right_s
    if op == "neq":
        return left_s != right_s
    if op == "contains":
        return right_s.lower() in left_s.lower()
    if op == "in":
        return left_s in {str(item) for item in normalize_filter_values(filt)}
    if op == "not_in":
        return left_s not in {str(item) for item in normalize_filter_values(filt)}

    left_dt = parse_datetime_value(left)
    right_dt = parse_datetime_value(filt.value)
    if left_dt is not None and right_dt is not None:
        if op == "gt":
            return left_dt > right_dt
        if op == "lt":
            return left_dt < right_dt
        if op == "gte":
            return left_dt >= right_dt
        if op == "lte":
            return left_dt <= right_dt
        if op == "between":
            from_dt = parse_datetime_value(filt.from_value)
            to_dt = parse_datetime_value(filt.to_value)
            if from_dt is None or to_dt is None:
                return False
            return from_dt <= left_dt <= to_dt

    left_n = parse_float(left)
    right_n = parse_float(filt.value)
    if left_n is not None and right_n is not None:
        if op == "gt":
            return left_n > right_n
        if op == "lt":
            return left_n < right_n
        if op == "gte":
            return left_n >= right_n
        if op == "lte":
            return left_n <= right_n
    if op == "between":
        from_n = parse_float(filt.from_value)
        to_n = parse_float(filt.to_value)
        if left_n is not None and from_n is not None and to_n is not None:
            return from_n <= left_n <= to_n
        from_s = "" if filt.from_value is None else str(filt.from_value)
        to_s = "" if filt.to_value is None else str(filt.to_value)
        return from_s <= left_s <= to_s

    if op == "gt":
        return left_s > right_s
    if op == "lt":
        return left_s < right_s
    if op == "gte":
        return left_s >= right_s
    if op == "lte":
        return left_s <= right_s
    return False


def apply_filters(records: list[Record], filters: list[AnalyticsFilter]) -> list[Record]:
    if not filters:
        return records
    out: list[Record] = []
    for rec in records:
        ok = True
        for filt in filters:
            left = rec.data.get(filt.column_id)
            if not compare_values(filt.op, left, filt):
                ok = False
                break
        if ok:
            out.append(rec)
    return out


def metric_values_from_rows(metric: AnalyticsMetric, rows: list[Record]) -> float | int | str | None:
    if metric.aggregation == "count":
        return len(rows)

    values = [record.data.get(metric.column_id or "") for record in rows]
    if metric.aggregation in {"sum", "avg", "min", "max"}:
        numeric_values = [value for value in (parse_float(item) for item in values) if value is not None]
        if numeric_values:
            if metric.aggregation == "sum":
                return round(sum(numeric_values), 4)
            if metric.aggregation == "avg":
                return round(sum(numeric_values) / len(numeric_values), 4)
            if metric.aggregation == "min":
                return min(numeric_values)
            if metric.aggregation == "max":
                return max(numeric_values)

        datetime_values = [value for value in (parse_datetime_value(item) for item in values) if value is not None]
        if datetime_values:
            if metric.aggregation == "min":
                return min(datetime_values).isoformat()
            if metric.aggregation == "max":
                return max(datetime_values).isoformat()

        text_values = [str(item) for item in values if not value_is_empty(item)]
        if text_values:
            if metric.aggregation == "min":
                return min(text_values)
            if metric.aggregation == "max":
                return max(text_values)

    return None


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


async def load_table(repo: ReportsRepository, table_id: uuid.UUID, org_id: uuid.UUID) -> Table | None:
    return await repo.get_table_with_columns(org_id, table_id)


async def load_tables_map(
    repo: ReportsRepository,
    *,
    org_id: uuid.UUID,
    table_ids: list[uuid.UUID],
) -> dict[uuid.UUID, Table]:
    return await repo.get_tables_map_by_ids(org_id=org_id, table_ids=table_ids)


async def load_records_map(
    repo: ReportsRepository,
    *,
    table_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[Record]]:
    return await repo.list_records_map_by_table_ids(table_ids=table_ids)


def field_schema_from_column(column: Column) -> AnalyticsFieldOut:
    return AnalyticsFieldOut(
        id=str(column.id),
        name=column.name,
        field_type=column.field_type,
        analytics_type=analytics_type_for_field(column.field_type),
        position=column.position,
        is_primary=column.is_primary,
        supported_aggregations=aggregations_for_field(column.field_type),
        supported_filter_ops=filter_ops_for_field(column.field_type),
    )


def build_table_schema(table: Table, records_count: int) -> AnalyticsTableSchemaOut:
    ordered_columns = sorted(table.columns, key=lambda item: item.position)
    fields = [field_schema_from_column(column) for column in ordered_columns]
    default_metric = next((field.id for field in fields if field.analytics_type == "number"), None)
    default_time = next((field.id for field in fields if field.analytics_type == "date"), None)
    default_group = next(
        (
            field.id
            for field in fields
            if field.analytics_type in {"list", "text"} and not next((col for col in table.columns if str(col.id) == field.id and col.is_primary), None)
        ),
        None,
    )
    if default_group is None:
        default_group = next((field.id for field in fields if field.is_primary), None)
    return AnalyticsTableSchemaOut(
        table_id=str(table.id),
        table_name=table.name,
        total_records=records_count,
        fields=fields,
        default_metric_column_id=default_metric,
        default_group_by_column_id=default_group,
        default_time_column_id=default_time,
    )


def query_from_widget(widget: ReportWidget, extra_filters: list[AnalyticsFilter] | None = None) -> AnalyticsQueryRequest:
    config = WidgetConfig.model_validate(widget.config or {})
    metrics = config.metrics or [
        AnalyticsMetric(
            key="value",
            aggregation=config.aggregation,
            column_id=config.value_column_id,
            label=widget.title,
        )
    ]
    filters = [AnalyticsFilter.model_validate(item.model_dump()) for item in config.filters]
    if extra_filters:
        filters.extend(extra_filters)
    sort = AnalyticsSort(
        by=config.sort_by,
        metric_key=config.sort_metric_key,
        direction=config.sort_direction,
    )
    return AnalyticsQueryRequest(
        table_id=str(widget.table_id) if widget.table_id else "",
        widget_type=widget.widget_type,
        title=widget.title,
        metrics=metrics,
        group_by_column_id=config.group_by_column_id,
        time_column_id=config.time_column_id,
        date_bucket=config.time_granularity,
        filters=filters,
        sort=sort,
        limit=config.limit,
        selected_column_ids=config.selected_column_ids,
    )


def sorted_group_rows(rows: list[dict[str, Any]], sort: AnalyticsSort | None) -> list[dict[str, Any]]:
    if not rows:
        return rows
    sort = sort or AnalyticsSort()
    reverse = sort.direction != "asc"
    if sort.by == "label":
        return sorted(rows, key=lambda item: str(item["label"]), reverse=reverse)
    metric_key = sort.metric_key or next(iter(rows[0]["metrics"].keys()), "value")
    return sorted(
        rows,
        key=lambda item: (item["metrics"].get(metric_key) is None, item["metrics"].get(metric_key)),
        reverse=reverse,
    )


async def execute_query(
    repo: ReportsRepository,
    org_id: uuid.UUID,
    query: AnalyticsQueryRequest,
    *,
    tables_map: dict[uuid.UUID, Table] | None = None,
    records_map: dict[uuid.UUID, list[Record]] | None = None,
) -> tuple[Table | None, dict[str, Any]]:
    try:
        table_uuid = uuid.UUID(query.table_id)
    except ValueError:
        return None, {"type": query.widget_type, "error": "table not found"}

    table = (tables_map or {}).get(table_uuid)
    if table is None:
        table = await load_table(repo, table_uuid, org_id)
    if table is None:
        return None, {"type": query.widget_type, "error": "table not found"}

    has_prefetched_records = records_map is not None and table.id in records_map
    records = list((records_map or {}).get(table.id, []))
    if not has_prefetched_records:
        records = await repo.list_records_by_table(table.id)
    filtered = apply_filters(records, query.filters)

    columns_map: dict[str, Column] = {str(column.id): column for column in table.columns}
    metrics = query.metrics or [AnalyticsMetric()]
    primary_metric = metrics[0]

    if query.widget_type == "metric":
        metric_values = {metric.key: metric_values_from_rows(metric, filtered) for metric in metrics}
        return table, {
            "type": "metric",
            "label": query.title or primary_metric.label or "Метрика",
            "value": metric_values.get(primary_metric.key),
            "metrics": metric_values,
            "total_records": len(filtered),
        }

    group_column_id = query.time_column_id or query.group_by_column_id
    if query.widget_type in {"bar", "line", "area", "pie", "donut"}:
        if not group_column_id:
            return table, {"type": query.widget_type, "error": "group_by_column_id or time_column_id is required"}
        grouped: dict[str, list[Record]] = defaultdict(list)
        for rec in filtered:
            raw = rec.data.get(group_column_id)
            if query.time_column_id:
                dt_value = parse_datetime_value(raw)
                key = date_bucket_label(dt_value, query.date_bucket) if dt_value else "(Empty)"
            else:
                if isinstance(raw, list):
                    key = ", ".join(str(item) for item in raw) or "(Empty)"
                else:
                    key = str(raw) if not value_is_empty(raw) else "(Empty)"
            grouped[key].append(rec)

        rows: list[dict[str, Any]] = []
        for key, group_rows in grouped.items():
            metric_values = {metric.key: metric_values_from_rows(metric, group_rows) for metric in metrics}
            rows.append({"label": key, "metrics": metric_values, "count": len(group_rows)})

        rows = sorted_group_rows(rows, query.sort)[: query.limit]
        return table, {
            "type": query.widget_type,
            "rows": rows,
            "points": [{"x": row["label"], "y": row["metrics"].get(primary_metric.key)} for row in rows],
            "series": [{"key": metric.key, "label": metric.label or metric.key} for metric in metrics],
            "group_by_column": columns_map.get(group_column_id).name if columns_map.get(group_column_id) else group_column_id,
            "time_granularity": query.date_bucket if query.time_column_id else None,
            "total_records": len(filtered),
        }

    if query.widget_type == "table":
        if group_column_id:
            label_name = columns_map.get(group_column_id).name if columns_map.get(group_column_id) else "Группа"
            grouped: dict[str, list[Record]] = defaultdict(list)
            for rec in filtered:
                raw = rec.data.get(group_column_id)
                if query.time_column_id:
                    dt_value = parse_datetime_value(raw)
                    key = date_bucket_label(dt_value, query.date_bucket) if dt_value else "(Empty)"
                else:
                    if isinstance(raw, list):
                        key = ", ".join(str(item) for item in raw) or "(Empty)"
                    else:
                        key = str(raw) if not value_is_empty(raw) else "(Empty)"
                grouped[key].append(rec)
            group_rows: list[dict[str, Any]] = []
            for key, group_records in grouped.items():
                metric_values = {metric.key: metric_values_from_rows(metric, group_records) for metric in metrics}
                group_rows.append({"label": key, "metrics": metric_values, "count": len(group_records)})
            group_rows = sorted_group_rows(group_rows, query.sort)[: query.limit]
            header = [label_name] + [metric.label or metric.key for metric in metrics]
            rows = [[str(row["label"]), *[str(row["metrics"].get(metric.key, "—")) for metric in metrics]] for row in group_rows]
            return table, {"type": "table", "header": header, "rows": rows, "total": len(filtered)}

        selected_ids = query.selected_column_ids or [str(col.id) for col in sorted(table.columns, key=lambda c: c.position)[:6]]
        selected_ids = selected_ids[:12]
        header = [columns_map[cid].name if cid in columns_map else cid for cid in selected_ids]
        rows: list[list[str]] = []
        for rec in filtered[: query.limit]:
            row = []
            for cid in selected_ids:
                value = rec.data.get(cid, "")
                if isinstance(value, list):
                    row.append(", ".join(str(item) for item in value))
                else:
                    row.append("" if value is None else str(value))
            rows.append(row)
        return table, {"type": "table", "header": header, "rows": rows, "total": len(filtered)}

    return table, {"type": query.widget_type, "error": "unsupported widget_type"}


async def build_widget_data(
    repo: ReportsRepository,
    org_id: uuid.UUID,
    widget: ReportWidget,
    *,
    tables_map: dict[uuid.UUID, Table] | None = None,
    records_map: dict[uuid.UUID, list[Record]] | None = None,
    extra_filters: list[AnalyticsFilter] | None = None,
) -> dict[str, Any]:
    query = query_from_widget(widget, extra_filters=extra_filters)
    _, data = await execute_query(
        repo,
        org_id,
        query,
        tables_map=tables_map,
        records_map=records_map,
    )
    return data
