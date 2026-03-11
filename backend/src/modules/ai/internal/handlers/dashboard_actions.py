"""Обработчик AI-действия создания дашборда."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.modules.ai.internal.resolution import normalize_name, resolve_column_id, resolve_table_by_ref
from src.modules.ai.internal.widget_inference import (
    coerce_widget_type_by_semantics,
    contains_any,
    infer_widgets_for_table,
    normalize_aggregation,
    pick_group_column_for_widget,
    pick_numeric_column_for_widget,
    pick_time_column_for_widget,
    should_use_inferred_widgets,
)
from src.modules.reports.analytics_engine import build_widget_data
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.repository import ReportsRepository
from src.modules.reports.schemas import WidgetConfig

if TYPE_CHECKING:
    import uuid

    from src.infrastructure.uow import UnitOfWork
    from src.modules.tables.models import Table


async def handle_create_dashboard_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать дашборд (отчёт) и набор виджетов по payload."""
    name = str(action_payload.get("name") or "AI Dashboard").strip()[:255]
    description = str(action_payload.get("description") or "").strip() or None
    widgets_payload = action_payload.get("widgets") if isinstance(action_payload.get("widgets"), list) else []

    dash = ReportDashboard(org_id=org_id, created_by=user_id, name=name, description=description)
    uow.session.add(dash)
    await uow.session.flush()

    reports_repo = ReportsRepository(uow.session)
    tables = await reports_repo.list_org_tables_with_columns(org_id)
    table_record_counts: dict[str, int] = {}
    if tables:
        counts = await reports_repo.count_records_by_table_ids([t.id for t in tables])
        table_record_counts = {str(table_id): int(cnt or 0) for table_id, cnt in counts.items()}
        for t in tables:
            table_record_counts.setdefault(str(t.id), 0)

    normalized_message = normalize_name(user_message or "")
    preferred_widget_type = str(action_payload.get("preferred_widget_type") or "").strip().lower() or None
    global_table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    should_force_widget_type = bool(preferred_widget_type) and len(widgets_payload) <= 1
    if should_use_inferred_widgets(widgets_payload):
        inferred_table: Table | None = None
        if global_table_ref:
            inferred_table = resolve_table_by_ref(tables, global_table_ref)
        if inferred_table is None and normalized_message:
            for table_obj in tables:
                n = normalize_name(table_obj.name)
                if n and n in normalized_message:
                    inferred_table = table_obj
                    break
        if inferred_table is None and len(tables) == 1:
            inferred_table = tables[0]
        if inferred_table is None and tables:
            inferred_table = sorted(tables, key=lambda t: table_record_counts.get(str(t.id), 0), reverse=True)[0]
        if inferred_table is not None:
            widgets_payload = infer_widgets_for_table(inferred_table, normalized_message)

    if not widgets_payload:
        widgets_payload = [{"title": "Количество записей", "widget_type": "metric", "aggregation": "count"}]

    created_widgets: list[ReportWidget] = []
    skipped: list[dict[str, Any]] = []
    for idx, raw in enumerate(widgets_payload[:8]):
        if not isinstance(raw, dict):
            continue
        table_ref = str(raw.get("table_id") or raw.get("table_name") or global_table_ref).strip()
        if not table_ref and normalized_message:
            for table_obj in tables:
                n = normalize_name(table_obj.name)
                if n and n in normalized_message:
                    table_ref = table_obj.name
                    break
        if not table_ref and len(tables) == 1:
            table_ref = tables[0].name
        if not table_ref and tables:
            best_table = sorted(tables, key=lambda t: table_record_counts.get(str(t.id), 0), reverse=True)[0]
            table_ref = best_table.name
        table_obj = resolve_table_by_ref(tables, table_ref)
        if table_obj is None:
            skipped.append({"index": idx, "reason": "table_not_found", "table_ref": table_ref})
            continue

        title = str(raw.get("title") or f"Widget {idx + 1}")[:255]
        semantic_title = normalize_name(title)
        semantic_text = normalize_name(f"{semantic_title} {normalized_message}")
        widget_type = coerce_widget_type_by_semantics(
            current_type=str(raw.get("widget_type") or "metric"),
            semantic_text=semantic_title,
            forced_type=preferred_widget_type if should_force_widget_type else None,
        )
        agg_name = normalize_aggregation(raw.get("aggregation"))

        resolved_value_col = resolve_column_id(
            raw.get("value_column_id") or raw.get("value_column_name"), table_obj.columns
        )
        resolved_group_col = resolve_column_id(
            raw.get("group_by_column_id") or raw.get("group_by_column_name"), table_obj.columns
        )
        resolved_time_col = resolve_column_id(
            raw.get("time_column_id") or raw.get("time_column_name"), table_obj.columns
        )

        revenue_like = contains_any(
            semantic_text, ("выруч", "доход", "сумм", "оборот", "revenue", "amount", "sales", "цена")
        )
        status_like = contains_any(semantic_title, ("статус", "status", "state", "этап", "stage"))
        trend_like = contains_any(
            semantic_title, ("динам", "trend", "по дат", "врем", "time", "день", "недел", "месяц")
        ) or contains_any(
            normalized_message,
            ("динам", "trend", "по дат", "врем", "time", "день", "недел", "месяц"),
        )

        numeric_col = pick_numeric_column_for_widget(list(table_obj.columns), semantic_text)
        group_col = pick_group_column_for_widget(list(table_obj.columns), semantic_text)
        time_col = pick_time_column_for_widget(list(table_obj.columns))

        if widget_type == "metric":
            if revenue_like and agg_name == "count":
                agg_name = "sum"
            if agg_name in ("sum", "avg", "min", "max") and not resolved_value_col and numeric_col:
                resolved_value_col = str(numeric_col.id)
        elif widget_type in ("bar", "line", "area", "pie", "donut"):
            if revenue_like and not status_like and agg_name == "count":
                agg_name = "sum"
            if status_like and agg_name != "count" and not resolved_value_col:
                agg_name = "count"
            if agg_name in ("sum", "avg", "min", "max") and not resolved_value_col and numeric_col:
                resolved_value_col = str(numeric_col.id)
            if widget_type in ("line", "area") and not resolved_time_col and trend_like and time_col:
                resolved_time_col = str(time_col.id)
            if not resolved_time_col and not resolved_group_col and group_col:
                resolved_group_col = str(group_col.id)

        selected_column_ids: list[str] = []
        for col_ref in raw.get("selected_column_ids") or raw.get("selected_column_names") or []:
            col_id = resolve_column_id(col_ref, table_obj.columns)
            if col_id:
                selected_column_ids.append(col_id)

        raw_filters = raw.get("filters") or []
        normalized_filters: list[dict[str, Any]] = []
        if isinstance(raw_filters, list):
            for f in raw_filters:
                if not isinstance(f, dict):
                    continue
                resolved_filter_col = resolve_column_id(f.get("column_id") or f.get("column_name"), table_obj.columns)
                if not resolved_filter_col:
                    continue
                normalized_filters.append(
                    {"column_id": resolved_filter_col, "op": str(f.get("op") or "eq"), "value": f.get("value")}
                )

        cfg = WidgetConfig.model_validate(
            {
                "aggregation": agg_name,
                "value_column_id": resolved_value_col,
                "group_by_column_id": resolved_group_col,
                "time_column_id": resolved_time_col,
                "time_granularity": str(raw.get("time_granularity") or "day"),
                "filters": normalized_filters,
                "limit": int(raw.get("limit") or 10),
                "selected_column_ids": selected_column_ids,
            }
        )
        widget = ReportWidget(
            dashboard_id=dash.id,
            org_id=org_id,
            title=title,
            widget_type=widget_type,
            table_id=table_obj.id if table_obj else None,
            config=cfg.model_dump(),
            position=idx,
        )
        uow.session.add(widget)
        created_widgets.append(widget)

    await uow.session.flush()
    preview_items = [
        {
            "widget_id": str(widget.id),
            "title": widget.title,
            "widget_type": widget.widget_type,
            "table_id": str(widget.table_id) if widget.table_id else None,
            "config": widget.config or {},
            "data": await build_widget_data(reports_repo, org_id, widget),
        }
        for widget in created_widgets
    ]
    return {
        "action": "create_dashboard",
        "ok": True,
        "dashboard": {"id": str(dash.id), "name": dash.name, "description": dash.description},
        "items": preview_items,
        "skipped": skipped,
    }
