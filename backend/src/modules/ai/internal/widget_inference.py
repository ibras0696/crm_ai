"""Эвристики подбора виджетов и параметров для AI-дашбордов."""

from __future__ import annotations

import re
from typing import Any

from src.modules.ai.internal.resolution import normalize_name
from src.modules.tables.models import Column, FieldType, Table


def is_generic_widget_title(title: Any) -> bool:
    """Проверить, что заголовок виджета выглядит шаблонным.

    Args:
        title: Заголовок виджета.

    Returns:
        True если заголовок низкосигнальный (Widget 1, Виджет 2 и т.п.).
    """
    value = str(title or "").strip().lower()
    if not value:
        return True
    return bool(re.fullmatch(r"(widget|виджет)\s*\d*", value))


def should_use_inferred_widgets(widgets_payload: list[dict[str, Any]]) -> bool:
    """Определить, нужно ли заменять widgets эвристикой.

    Args:
        widgets_payload: Список виджетов из ответа модели.

    Returns:
        True если payload выглядит низкосигнальным.
    """
    if not widgets_payload:
        return True
    checked = 0
    low_signal = 0
    for raw in widgets_payload[:8]:
        if not isinstance(raw, dict):
            continue
        checked += 1
        agg = str(raw.get("aggregation") or "count").strip().lower()
        wtype = str(raw.get("widget_type") or "metric").strip().lower()
        has_group = bool(raw.get("group_by_column_id") or raw.get("group_by_column_name"))
        has_value = bool(raw.get("value_column_id") or raw.get("value_column_name"))
        if (
            agg == "count"
            and wtype == "metric"
            and not has_group
            and not has_value
            and is_generic_widget_title(raw.get("title"))
        ):
            low_signal += 1
    return checked > 0 and low_signal == checked


def pick_column_by_keywords(
    columns: list[Column], keywords: tuple[str, ...], allow_types: tuple[str, ...] | None = None
) -> Column | None:
    """Подобрать колонку по ключевым словам и допустимым типам.

    Args:
        columns: Колонки таблицы.
        keywords: Ключевые слова.
        allow_types: Допустимые типы поля.

    Returns:
        Найденная колонка или None.
    """
    for col in columns:
        if allow_types and col.field_type not in allow_types:
            continue
        if any(k in normalize_name(col.name) for k in keywords):
            return col
    return None


def infer_widgets_for_table(table_obj: Table, normalized_message: str) -> list[dict[str, Any]]:
    """Сгенерировать базовый набор виджетов по структуре таблицы.

    Args:
        table_obj: Таблица с колонками.
        normalized_message: Нормализованный текст запроса.

    Returns:
        Список payload-виджетов (не более 8).
    """
    columns = list(table_obj.columns)
    text_cols = [c for c in columns if c.field_type in (FieldType.TEXT, FieldType.SELECT, FieldType.MULTI_SELECT)]
    num_cols = [c for c in columns if c.field_type in (FieldType.NUMBER, FieldType.FORMULA)]
    date_cols = [c for c in columns if c.field_type in (FieldType.DATE, FieldType.DATETIME)]

    salary_col = pick_column_by_keywords(num_cols, ("salary", "зарп", "оклад", "доход", "wage", "pay"))
    value_col = salary_col or (num_cols[0] if num_cols else None)
    dept_col = pick_column_by_keywords(text_cols, ("отдел", "department", "dept", "team"))
    role_col = pick_column_by_keywords(text_cols, ("должн", "position", "role", "title", "проф"))
    date_col = pick_column_by_keywords(date_cols, ("дата", "date", "hire", "прием"))

    employee_like = any(x in normalized_message for x in ("employee", "staff", "personnel", "сотруд", "штат"))
    total_title = "Всего сотрудников" if employee_like else "Всего записей"
    avg_title = "Средняя зарплата" if salary_col else "Среднее значение"
    sum_title = "Фонд оплаты" if salary_col else "Сумма значений"

    widgets: list[dict[str, Any]] = [{"title": total_title, "widget_type": "metric", "aggregation": "count"}]
    if value_col:
        widgets.append(
            {"title": avg_title, "widget_type": "metric", "aggregation": "avg", "value_column_id": str(value_col.id)}
        )
        widgets.append(
            {"title": sum_title, "widget_type": "metric", "aggregation": "sum", "value_column_id": str(value_col.id)}
        )
    if dept_col:
        widgets.append(
            {
                "title": "По отделам",
                "widget_type": "bar",
                "aggregation": "count",
                "group_by_column_id": str(dept_col.id),
                "limit": 20,
            }
        )
    if role_col:
        widgets.append(
            {
                "title": "По должностям",
                "widget_type": "bar",
                "aggregation": "count",
                "group_by_column_id": str(role_col.id),
                "limit": 20,
            }
        )
    if date_col and value_col:
        widgets.append(
            {
                "title": "Динамика по времени",
                "widget_type": "line",
                "aggregation": "sum",
                "value_column_id": str(value_col.id),
                "time_column_id": str(date_col.id),
                "time_granularity": "month",
                "limit": 24,
            }
        )
    return widgets[:8]


def contains_any(normalized_text: str, keywords: tuple[str, ...]) -> bool:
    """Проверить, содержит ли текст хотя бы одно ключевое слово."""
    return any(k in normalized_text for k in keywords)


def normalize_widget_type(raw_type: Any) -> str:
    """Нормализовать тип виджета к поддерживаемому набору."""
    value = str(raw_type or "metric").strip().lower()
    allowed = {"metric", "bar", "line", "area", "pie", "donut", "table"}
    return value if value in allowed else "metric"


def normalize_aggregation(raw_agg: Any) -> str:
    """Нормализовать агрегацию виджета к поддерживаемому набору."""
    value = str(raw_agg or "count").strip().lower()
    allowed = {"count", "sum", "avg", "min", "max"}
    return value if value in allowed else "count"


def pick_numeric_column_for_widget(columns: list[Column], normalized_text: str) -> Column | None:
    """Выбрать числовую колонку под расчеты виджета."""
    numeric_cols = [c for c in columns if c.field_type in (FieldType.NUMBER, FieldType.FORMULA)]
    if not numeric_cols:
        return None
    revenue_hints = ("выруч", "доход", "сумм", "оборот", "revenue", "amount", "sales", "цена", "оплат", "платеж")
    if contains_any(normalized_text, revenue_hints):
        preferred = pick_column_by_keywords(numeric_cols, revenue_hints)
        if preferred:
            return preferred
    return numeric_cols[0]


def pick_group_column_for_widget(columns: list[Column], normalized_text: str) -> Column | None:
    """Выбрать колонку группировки для графического виджета."""
    text_cols = [c for c in columns if c.field_type in (FieldType.TEXT, FieldType.SELECT, FieldType.MULTI_SELECT)]
    if not text_cols:
        return None

    status_hints = ("статус", "status", "state", "этап", "stage")
    category_hints = ("катег", "category", "тип", "source", "источник", "канал")
    top_hints = ("клиент", "client", "курс", "товар", "product", "назван")
    if contains_any(normalized_text, status_hints):
        preferred = pick_column_by_keywords(text_cols, status_hints)
        if preferred:
            return preferred
    if contains_any(normalized_text, category_hints):
        preferred = pick_column_by_keywords(text_cols, category_hints)
        if preferred:
            return preferred
    if contains_any(normalized_text, top_hints):
        preferred = pick_column_by_keywords(text_cols, top_hints)
        if preferred:
            return preferred
    return text_cols[0]


def pick_time_column_for_widget(columns: list[Column]) -> Column | None:
    """Выбрать колонку времени для временного графика."""
    date_cols = [c for c in columns if c.field_type in (FieldType.DATE, FieldType.DATETIME)]
    if not date_cols:
        return None
    preferred = pick_column_by_keywords(date_cols, ("дата", "date", "time", "время", "created", "оплат"))
    return preferred or date_cols[0]


def coerce_widget_type_by_semantics(*, current_type: str, semantic_text: str, forced_type: str | None = None) -> str:
    """Скорректировать тип виджета по смыслу запроса/заголовка."""
    if forced_type:
        return normalize_widget_type(forced_type)

    widget_type = normalize_widget_type(current_type)
    if widget_type == "table":
        return widget_type

    status_like = contains_any(semantic_text, ("статус", "status", "state", "этап", "stage", "доля"))
    trend_like = contains_any(semantic_text, ("динам", "trend", "по дат", "врем", "time", "день", "недел", "месяц"))
    total_like = contains_any(semantic_text, ("общ", "итог", "total", "всего"))
    top_like = contains_any(semantic_text, ("топ", "top", "рейтинг", "rank", "лидер"))
    bar_like = contains_any(semantic_text, ("bar", "гистограмм", "столб", "колонк", "chart"))

    if status_like and widget_type in {"metric", "bar", "line", "area"}:
        return "pie"
    if trend_like and widget_type in {"metric", "bar", "pie", "donut"}:
        return "line"
    if total_like and widget_type in {"bar", "line", "area", "pie", "donut"}:
        return "metric"
    if top_like and widget_type in {"metric", "line", "pie", "donut"}:
        return "bar"
    if bar_like and widget_type == "metric":
        return "bar"
    return widget_type
