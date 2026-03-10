"""Обработчики AI-действий для модуля таблиц."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.internal.resolution import normalize_name, resolve_table_by_ref, safe_field_type
from src.modules.tables.models import Column, FieldType, Table
from src.modules.tables.records import Record

if TYPE_CHECKING:
    import uuid

    from src.infrastructure.uow import UnitOfWork


def _resolve_row_key_to_column_id(row_key: Any, columns: list[Column]) -> str | None:
    """Сопоставить ключ строки (название колонки/alias) к ID колонки таблицы."""
    if row_key is None:
        return None
    key = str(row_key).strip()
    if not key:
        return None
    for col in columns:
        if str(col.id) == key:
            return str(col.id)
    normalized = normalize_name(key)
    by_name = {normalize_name(c.name): str(c.id) for c in columns}
    if normalized in by_name:
        return by_name[normalized]
    return None


def _extract_rows_payload(action_payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Извлечь список строк/records из payload действия."""
    source = action_payload.get("records")
    if isinstance(source, dict):
        columns_raw = source.get("columns")
        rows_raw = source.get("rows")
        if isinstance(columns_raw, list) and isinstance(rows_raw, list):
            columns = [str(c).strip() for c in columns_raw if str(c).strip()]
            out: list[dict[str, Any]] = []
            if not columns:
                return out
            for row in rows_raw[:2000]:
                if isinstance(row, list):
                    rec: dict[str, Any] = {}
                    for idx, val in enumerate(row[: len(columns)]):
                        rec[columns[idx]] = val
                    if rec:
                        out.append(rec)
                elif isinstance(row, dict):
                    out.append(row)
            return out

    if source is None:
        source = action_payload.get("rows")
    if source is None:
        source = action_payload.get("data_rows")
    if source is None:
        columns_raw = action_payload.get("records_columns")
        rows_raw = action_payload.get("records_rows")
        if isinstance(columns_raw, list) and isinstance(rows_raw, list):
            source = {"columns": columns_raw, "rows": rows_raw}
            action_payload = {**action_payload, "records": source}
            return _extract_rows_payload(action_payload)
        source = action_payload.get("records_compact")
        if isinstance(source, dict):
            action_payload = {**action_payload, "records": source}
            return _extract_rows_payload(action_payload)

    if not isinstance(source, list):
        return []

    out: list[dict[str, Any]] = []
    for item in source[:2000]:
        if isinstance(item, dict):
            out.append(item)
    return out


async def _resolve_plan_limits(uow: UnitOfWork, *, org_id: uuid.UUID) -> tuple[int, int]:
    """Получить лимиты тарифа по таблицам и записям.

    Args:
        uow: UnitOfWork с активной сессией БД.
        org_id: ID организации.

    Returns:
        Кортеж `(max_tables, max_records)`.
    """
    repo = AIRepository(uow.session)
    plan = await repo.resolve_effective_plan(org_id=org_id)
    max_tables = int(getattr(plan, "max_tables", 0) or 0)
    max_records = int(getattr(plan, "max_records", 0) or 0)
    return max_tables, max_records


def _infer_rows_from_message(user_message: str | None, columns: list[Column]) -> list[dict[str, Any]]:
    """Попытаться извлечь строки из текста пользователя, если payload пустой."""
    text = (user_message or "").strip()
    if not text:
        return []
    marker = re.search(r"(rows?|строк[аи]?|запис[иь])\s*:\s*(.+)$", text, flags=re.IGNORECASE | re.DOTALL)
    if not marker:
        return []
    tail = marker.group(2).strip()
    if not tail:
        return []

    segments = [s.strip(" .,\n\t") for s in re.split(r"[;\n]+", tail) if s.strip(" .,\n\t")]
    if not segments:
        return []
    segments = segments[:100]

    primary = next((c for c in columns if c.is_primary), None)
    text_target = primary or next(
        (c for c in columns if c.field_type in (FieldType.TEXT, FieldType.URL, FieldType.EMAIL, FieldType.PHONE)), None
    )
    num_columns = [c for c in columns if c.field_type in (FieldType.NUMBER, FieldType.FORMULA)]
    date_columns = [c for c in columns if c.field_type in (FieldType.DATE, FieldType.DATETIME)]
    select_columns = [c for c in columns if c.field_type in (FieldType.SELECT, FieldType.MULTI_SELECT)]

    out: list[dict[str, Any]] = []
    for seg in segments:
        tokens = [t for t in re.split(r"\s+", seg) if t]
        if not tokens:
            continue
        used: set[int] = set()
        row: dict[str, Any] = {}

        for col in num_columns:
            for i, tok in enumerate(tokens):
                if i in used:
                    continue
                if re.fullmatch(r"-?\d+(?:[.,]\d+)?", tok):
                    val = tok.replace(",", ".")
                    row[col.name] = float(val) if "." in val else int(val)
                    used.add(i)
                    break

        for col in date_columns:
            for i, tok in enumerate(tokens):
                if i in used:
                    continue
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", tok) or re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", tok):
                    row[col.name] = tok
                    used.add(i)
                    break

        for col in select_columns:
            options = ((col.config or {}).get("options") if isinstance(col.config, dict) else None) or []
            options_norm = {normalize_name(str(o)): str(o) for o in options}
            picked: str | None = None
            for i, tok in enumerate(tokens):
                if i in used:
                    continue
                norm_tok = normalize_name(tok)
                if norm_tok in options_norm:
                    picked = options_norm[norm_tok]
                    used.add(i)
                    break
            if picked is None:
                for i in range(len(tokens) - 1, -1, -1):
                    if i not in used:
                        picked = tokens[i]
                        used.add(i)
                        break
            if picked is not None:
                row[col.name] = picked

        if text_target:
            rest = [tok for i, tok in enumerate(tokens) if i not in used]
            row[text_target.name] = " ".join(rest).strip() or f"Row {len(out) + 1}"

        if row:
            out.append(row)
    return out


async def _create_records_for_table(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID | None,
    table_obj: Table,
    rows_payload: list[dict[str, Any]],
) -> tuple[list[Record], list[dict[str, Any]], int]:
    """Создать записи в таблице по подготовленному payload."""
    if not rows_payload:
        return [], [], 0

    repo = AIRepository(uow.session)
    ignored = 0
    _, max_records = await _resolve_plan_limits(uow, org_id=org_id)
    if max_records > 0:
        current_records = await repo.count_records(org_id=org_id)
        remaining = max_records - current_records
        if remaining <= 0:
            return [], [], len(rows_payload)
        if len(rows_payload) > remaining:
            ignored += len(rows_payload) - remaining
            rows_payload = rows_payload[:remaining]

    await repo.lock_table(table_id=table_obj.id)

    max_rows = 1000
    ignored += max(0, len(rows_payload) - max_rows)
    rows_payload = rows_payload[:max_rows]

    col_ids = {str(c.id) for c in table_obj.columns}
    primary_col = next((c for c in table_obj.columns if c.is_primary), None)
    max_position = await repo.get_max_record_position(table_id=table_obj.id)

    created: list[Record] = []
    preview: list[dict[str, Any]] = []
    col_name_by_id = {str(c.id): c.name for c in table_obj.columns}
    for idx, raw in enumerate(rows_payload):
        record_data: dict[str, Any] = {}
        for k, v in raw.items():
            cid = _resolve_row_key_to_column_id(k, table_obj.columns)
            if cid:
                record_data[cid] = v
            elif isinstance(k, str) and k in col_ids:
                record_data[k] = v
        if primary_col and str(primary_col.id) not in record_data:
            record_data[str(primary_col.id)] = f"Row {idx + 1}"
        max_position += 1
        rec = Record(
            table_id=table_obj.id, org_id=org_id, created_by=user_id, data=record_data, position=int(max_position)
        )
        uow.session.add(rec)
        created.append(rec)
        if len(preview) < 5:
            preview.append({col_name_by_id.get(k, k): v for k, v in record_data.items()})

    await uow.session.flush()
    return created, preview, ignored


async def handle_create_table_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать таблицу (с колонками и опциональными записями)."""
    name = str(action_payload.get("name") or action_payload.get("table_name") or "").strip()[:120]
    if not name:
        return {"action": "create_table", "ok": False, "error": "table_name_required"}
    max_tables, _ = await _resolve_plan_limits(uow, org_id=org_id)
    if max_tables > 0:
        current_tables = await AIRepository(uow.session).count_tables(org_id=org_id)
        if current_tables >= max_tables:
            return {"action": "create_table", "ok": False, "error": "table_limit_reached"}

    description = str(action_payload.get("description") or "").strip() or None
    icon = str(action_payload.get("icon") or "").strip() or None
    color = str(action_payload.get("color") or "").strip()[:20] or None
    table_obj = Table(
        org_id=org_id, created_by=user_id, name=name, description=description, icon=icon, color=color, is_archived=False
    )
    uow.session.add(table_obj)
    await uow.session.flush()

    raw_columns = action_payload.get("columns")
    columns_payload = raw_columns if isinstance(raw_columns, list) else []
    created_columns: list[Column] = []
    primary_exists = False

    for idx, raw in enumerate(columns_payload[:50]):
        if not isinstance(raw, dict):
            continue
        col_name = str(raw.get("name") or "").strip()[:120]
        if not col_name:
            continue
        field_type = safe_field_type(raw.get("field_type"))
        is_primary = bool(raw.get("is_primary", False)) and not primary_exists
        is_required = bool(raw.get("is_required", False)) or is_primary
        col_config = raw.get("config") if isinstance(raw.get("config"), dict) else None
        if field_type in (FieldType.SELECT, FieldType.MULTI_SELECT):
            options = raw.get("options")
            if isinstance(options, list):
                opts = [str(x).strip() for x in options if str(x).strip()]
                if opts:
                    col_config = {"options": opts}
        column = Column(
            table_id=table_obj.id,
            name=col_name,
            field_type=field_type,
            position=idx,
            is_required=is_required,
            is_primary=is_primary,
            config=col_config,
            default_value=(str(raw.get("default_value")) if raw.get("default_value") is not None else None),
        )
        created_columns.append(column)
        if is_primary:
            primary_exists = True

    if not created_columns:
        created_columns.append(
            Column(
                table_id=table_obj.id,
                name="Название",
                field_type=FieldType.TEXT,
                position=0,
                is_required=True,
                is_primary=True,
            )
        )
    elif not any(c.is_primary for c in created_columns):
        first = created_columns[0]
        first.is_primary = True
        first.is_required = True

    for col in created_columns:
        uow.session.add(col)

    await uow.session.flush()
    await uow.session.refresh(table_obj, attribute_names=["columns"])
    rows_payload = _extract_rows_payload(action_payload)
    if not rows_payload:
        rows_payload = _infer_rows_from_message(user_message, list(table_obj.columns))
    created_records, records_preview, ignored = await _create_records_for_table(
        uow, org_id, user_id, table_obj, rows_payload
    )
    return {
        "action": "create_table",
        "ok": True,
        "table": {"id": str(table_obj.id), "name": table_obj.name, "description": table_obj.description},
        "columns": [
            {
                "id": str(col.id),
                "name": col.name,
                "field_type": col.field_type,
                "is_primary": col.is_primary,
                "is_required": col.is_required,
            }
            for col in created_columns
        ],
        "records_created": len(created_records),
        "records_ignored": int(ignored),
        "records_preview": records_preview,
    }


async def handle_create_columns_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Добавить колонки в существующую таблицу и (опционально) создать записи."""
    table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    raw_columns = action_payload.get("columns")
    columns_payload = raw_columns if isinstance(raw_columns, list) else []
    if not table_ref:
        return {"action": "create_columns", "ok": False, "error": "table_ref_required"}
    if not columns_payload:
        return {"action": "create_columns", "ok": False, "error": "columns_required"}

    tables = await AIRepository(uow.session).list_active_tables_with_columns(org_id=org_id)
    table_obj = resolve_table_by_ref(tables, table_ref)
    if table_obj is None:
        return {"action": "create_columns", "ok": False, "error": "table_not_found", "table_ref": table_ref}

    await AIRepository(uow.session).lock_table(table_id=table_obj.id)

    existing_names = {normalize_name(c.name) for c in table_obj.columns}
    max_position = max((int(c.position) for c in table_obj.columns), default=-1)
    created_columns: list[Column] = []
    skipped: list[dict[str, Any]] = []
    primary_exists = any(bool(c.is_primary) for c in table_obj.columns)

    for idx, raw in enumerate(columns_payload[:50]):
        if not isinstance(raw, dict):
            continue
        col_name = str(raw.get("name") or "").strip()[:120]
        if not col_name:
            continue
        normalized_name = normalize_name(col_name)
        if normalized_name in existing_names:
            skipped.append({"index": idx, "name": col_name, "reason": "already_exists"})
            continue

        field_type = safe_field_type(raw.get("field_type"))
        is_primary = bool(raw.get("is_primary", False)) and not primary_exists
        is_required = bool(raw.get("is_required", False)) or is_primary
        col_config = raw.get("config") if isinstance(raw.get("config"), dict) else None
        if field_type in (FieldType.SELECT, FieldType.MULTI_SELECT):
            options = raw.get("options")
            if isinstance(options, list):
                opts = [str(x).strip() for x in options if str(x).strip()]
                if opts:
                    col_config = {"options": opts}

        max_position += 1
        column = Column(
            table_id=table_obj.id,
            name=col_name,
            field_type=field_type,
            position=max_position,
            is_required=is_required,
            is_primary=is_primary,
            config=col_config,
            default_value=(str(raw.get("default_value")) if raw.get("default_value") is not None else None),
        )
        uow.session.add(column)
        created_columns.append(column)
        existing_names.add(normalized_name)
        if is_primary:
            primary_exists = True

    await uow.session.flush()
    await uow.session.refresh(table_obj, attribute_names=["columns"])
    rows_payload = _extract_rows_payload(action_payload)
    if not rows_payload:
        rows_payload = _infer_rows_from_message(user_message, list(table_obj.columns))
    created_records, records_preview, ignored = await _create_records_for_table(
        uow, org_id, user_id, table_obj, rows_payload
    )
    return {
        "action": "create_columns",
        "ok": True,
        "table": {"id": str(table_obj.id), "name": table_obj.name},
        "created": [
            {
                "id": str(col.id),
                "name": col.name,
                "field_type": col.field_type,
                "is_primary": col.is_primary,
                "is_required": col.is_required,
            }
            for col in created_columns
        ],
        "skipped": skipped,
        "records_created": len(created_records),
        "records_ignored": int(ignored),
        "records_preview": records_preview,
    }


async def handle_create_records_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Добавить записи в существующую таблицу."""
    table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    if not table_ref:
        return {"action": "create_records", "ok": False, "error": "table_ref_required"}
    tables = await AIRepository(uow.session).list_active_tables_with_columns(org_id=org_id)
    table_obj = resolve_table_by_ref(tables, table_ref)
    if table_obj is None:
        return {"action": "create_records", "ok": False, "error": "table_not_found", "table_ref": table_ref}

    rows_payload = _extract_rows_payload(action_payload)
    if not rows_payload:
        rows_payload = _infer_rows_from_message(user_message, list(table_obj.columns))
    if not rows_payload:
        return {"action": "create_records", "ok": False, "error": "records_required"}

    created_records, records_preview, ignored = await _create_records_for_table(
        uow, org_id, user_id, table_obj, rows_payload
    )
    if not created_records and ignored > 0:
        return {
            "action": "create_records",
            "ok": False,
            "error": "record_limit_reached",
            "message": "Достигнут лимит тарифа по записям.",
        }
    return {
        "action": "create_records",
        "ok": True,
        "table": {"id": str(table_obj.id), "name": table_obj.name},
        "records_created": len(created_records),
        "records_ignored": int(ignored),
        "records_preview": records_preview,
    }
