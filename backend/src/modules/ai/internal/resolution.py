"""Утилиты резолвинга таблиц/колонок и нормализации типов для AI-действий."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from src.modules.tables.models import Column, FieldType, Table


def normalize_name(value: str) -> str:
    """Нормализовать строку для приблизительного сравнения.

    Args:
        value: Исходная строка.

    Returns:
        Нормализованная строка (lowercase, без лишних пробелов).
    """
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def resolve_table_by_ref(tables: list[Table], table_ref: str) -> Table | None:
    """Найти таблицу по ссылке (id или name) с "мягким" сопоставлением.

    Args:
        tables: Список таблиц организации.
        table_ref: Ссылка из payload.

    Returns:
        Table или None.
    """
    if not table_ref:
        return None
    clean_ref = normalize_name(table_ref)
    by_id = {str(t.id): t for t in tables}
    if table_ref in by_id:
        return by_id[table_ref]
    exact = {normalize_name(t.name): t for t in tables}
    if clean_ref in exact:
        return exact[clean_ref]
    best: tuple[float, Table | None] = (0.0, None)
    for table_obj in tables:
        table_norm = normalize_name(table_obj.name)
        score = SequenceMatcher(None, clean_ref, table_norm).ratio()
        if clean_ref in table_norm or table_norm in clean_ref:
            score = max(score, 0.82)
        if score > best[0]:
            best = (score, table_obj)
    return best[1] if best[0] >= 0.72 else None


def resolve_column_id(column_ref: Any, columns: list[Column]) -> str | None:
    """Резолв колонки по ссылке из payload (id/имя).

    Args:
        column_ref: Ссылка на колонку (id/имя/объект).
        columns: Колонки таблицы.

    Returns:
        ID колонки (str) или None.
    """
    if not column_ref:
        return None
    raw = str(column_ref).strip()
    if not raw:
        return None
    for col in columns:
        if str(col.id) == raw:
            return str(col.id)
    normalized = normalize_name(raw)
    by_exact = {normalize_name(c.name): str(c.id) for c in columns}
    if normalized in by_exact:
        return by_exact[normalized]
    best: tuple[float, str | None] = (0.0, None)
    for col in columns:
        col_norm = normalize_name(col.name)
        score = SequenceMatcher(None, normalized, col_norm).ratio()
        if normalized in col_norm or col_norm in normalized:
            score = max(score, 0.82)
        if score > best[0]:
            best = (score, str(col.id))
    return best[1] if best[0] >= 0.7 else None


def safe_field_type(raw: Any) -> str:
    """Привести field_type к допустимому значению.

    Args:
        raw: Сырый тип (строка/любой объект).

    Returns:
        Корректное значение FieldType (строкой).
    """
    value = str(raw or "").strip().lower()
    if value in FieldType.ALL:
        return value
    mapping = {
        "string": FieldType.TEXT,
        "str": FieldType.TEXT,
        "int": FieldType.NUMBER,
        "float": FieldType.NUMBER,
        "bool": FieldType.BOOLEAN,
        "select_one": FieldType.SELECT,
        "multi-select": FieldType.MULTI_SELECT,
        "multiselect": FieldType.MULTI_SELECT,
        "timestamp": FieldType.DATETIME,
    }
    return mapping.get(value, FieldType.TEXT)
