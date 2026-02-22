"""AI service logic: context, chat session, and action execution."""

import json
import re
import uuid
from datetime import datetime, timezone
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIChatMessage, AIChatSession
from src.modules.knowledge.models import KBPage
from src.modules.schedule.models import Event
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.schemas import WidgetConfig
from src.modules.reports.service import build_widget_data
from src.modules.schedule.models import Event
from src.modules.tables.models import Column, FieldType, Table
from src.modules.tables.records import Record


def estimate_tokens(text: str) -> int:
    # Tokenization differs per provider/model; we intentionally overestimate a bit.
    # Heuristic: take the max of char-based and UTF-8 byte-based approximations.
    if not text:
        return 0
    chars_based = len(text) / 2.7
    bytes_based = len(text.encode("utf-8", errors="ignore")) / 4.0
    return max(1, int(max(chars_based, bytes_based)))


def context_flags(options: dict | None) -> dict[str, Any]:
    src = options or {}
    kb_ids = [str(x) for x in (src.get("selected_kb_page_ids") or []) if str(x).strip()]
    table_ids = [str(x) for x in (src.get("selected_table_ids") or []) if str(x).strip()]
    schedule_ids = [str(x) for x in (src.get("selected_schedule_event_ids") or []) if str(x).strip()]
    return {
        "include_kb": bool(src.get("include_kb", True)),
        "include_table_schema": bool(src.get("include_table_schema", True)),
        "include_table_records": bool(src.get("include_table_records", True)),
        "include_schedule": bool(src.get("include_schedule", True)),
        "kb_limit": max(1, min(int(src.get("kb_limit", 30)), 300)),
        "tables_limit": max(1, min(int(src.get("tables_limit", 20)), 200)),
        "records_per_table": max(1, min(int(src.get("records_per_table", 5)), 20)),
        "schedule_days": max(1, min(int(src.get("schedule_days", 30)), 180)),
        "max_context_tokens": max(200, min(int(src.get("max_context_tokens", 2500)), 20000)),
        "selected_kb_page_ids": kb_ids,
        "selected_table_ids": table_ids,
        "selected_schedule_event_ids": schedule_ids,
    }


def _truncate_text_to_token_budget(text: str, budget_tokens: int) -> tuple[str, bool, int]:
    if not text or budget_tokens <= 0:
        return "", False, 0
    est = estimate_tokens(text)
    if est <= budget_tokens:
        return text, False, est
    allowed_bytes = max(1, int(budget_tokens * 4.0))
    raw = text.encode("utf-8", errors="ignore")[:allowed_bytes]
    truncated = raw.decode("utf-8", errors="ignore")
    return truncated, True, estimate_tokens(truncated)


async def build_org_context(org_id: uuid.UUID, options: dict | None = None) -> tuple[str, dict[str, Any]]:
    return await _build_org_context_internal(org_id=org_id, user_id=None, options=options)


async def _build_org_context_internal(
    org_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    options: dict | None = None,
) -> tuple[str, dict[str, Any]]:
    flags = context_flags(options)
    parts: list[str] = []
    meta: dict[str, Any] = {
        "enabled": True,
        "sources": {
            "kb": {"enabled": flags["include_kb"], "chars": 0, "estimated_tokens": 0},
            "table_schema": {"enabled": flags["include_table_schema"], "chars": 0, "estimated_tokens": 0},
            "table_records": {"enabled": flags["include_table_records"], "chars": 0, "estimated_tokens": 0},
            "schedule": {"enabled": flags["include_schedule"], "chars": 0, "estimated_tokens": 0},
        },
        "selected": {
            "kb_pages": flags["selected_kb_page_ids"],
            "tables": flags["selected_table_ids"],
            "schedule_events": flags["selected_schedule_event_ids"],
        },
        "model_overhead_tokens": 280,
        "max_context_tokens": flags["max_context_tokens"],
        "used_context_tokens": 0,
        "context_truncated": False,
        "estimated_prompt_tokens": 0,
        "prompt_message_overhead_tokens": 0,
        "estimated_total_tokens": 0,
    }

    try:
        async with UnitOfWork() as uow:
            if flags["include_kb"]:
                kb_stmt = select(KBPage).where(KBPage.org_id == org_id, KBPage.is_published.is_(True))
                if flags["selected_kb_page_ids"]:
                    valid: list[uuid.UUID] = []
                    for raw in flags["selected_kb_page_ids"]:
                        try:
                            valid.append(uuid.UUID(raw))
                        except ValueError:
                            continue
                    if valid:
                        kb_stmt = kb_stmt.where(KBPage.id.in_(valid))
                kb_stmt = kb_stmt.order_by(KBPage.position.asc()).limit(flags["kb_limit"])
                kb_rows = (await uow.session.execute(kb_stmt)).scalars().all()
                if kb_rows:
                    kb_lines = [f"--- {p.title} ---\n{(p.content or '')[:500]}" for p in kb_rows]
                    kb_block = "\n".join(kb_lines)
                    parts.append("=== KNOWLEDGE BASE ===")
                    parts.append(kb_block)
                    meta["sources"]["kb"]["chars"] = len(kb_block)
                    meta["sources"]["kb"]["estimated_tokens"] = estimate_tokens(kb_block)

            tbl_stmt = (
                select(Table)
                .where(Table.org_id == org_id, Table.is_archived.is_(False))
                .options(selectinload(Table.columns))
            )
            if flags["selected_table_ids"]:
                valid_tids: list[uuid.UUID] = []
                for raw in flags["selected_table_ids"]:
                    try:
                        valid_tids.append(uuid.UUID(raw))
                    except ValueError:
                        continue
                if valid_tids:
                    tbl_stmt = tbl_stmt.where(Table.id.in_(valid_tids))
            tbl_stmt = tbl_stmt.limit(flags["tables_limit"])
            tables = (await uow.session.execute(tbl_stmt)).scalars().all()

            if tables and (flags["include_table_schema"] or flags["include_table_records"]):
                parts.append("\n=== TABLES ===")
                schema_lines: list[str] = []
                sample_lines: list[str] = []
                for table_obj in tables:
                    if flags["include_table_schema"]:
                        col_parts = ", ".join(
                            f"{c.name}(id={c.id},type={c.field_type})"
                            for c in sorted(table_obj.columns, key=lambda x: x.position)
                        )
                        schema_lines.append(f"Table: {table_obj.name}(table_id={table_obj.id}) | Columns: {col_parts}")
                    if flags["include_table_records"]:
                        recs = (
                            await uow.session.execute(
                                select(Record).where(Record.table_id == table_obj.id).limit(flags["records_per_table"])
                            )
                        ).scalars().all()
                        if recs:
                            cmap = {str(c.id): c.name for c in table_obj.columns}
                            for rec in recs:
                                pairs = [f"{cmap.get(cid, cid[:8])}={val}" for cid, val in (rec.data or {}).items()]
                                sample_lines.append(f"[{table_obj.name}] {', '.join(pairs[:10])}")
                if schema_lines:
                    schema_block = "\n".join(schema_lines)
                    parts.append(schema_block)
                    meta["sources"]["table_schema"]["chars"] = len(schema_block)
                    meta["sources"]["table_schema"]["estimated_tokens"] = estimate_tokens(schema_block)
                if sample_lines:
                    sample_block = "\n".join(sample_lines)
                    parts.append(sample_block)
                    meta["sources"]["table_records"]["chars"] = len(sample_block)
                    meta["sources"]["table_records"]["estimated_tokens"] = estimate_tokens(sample_block)

            if flags["include_schedule"]:
                now = datetime.now(timezone.utc)
                since = now - timedelta(days=30)
                until = now + timedelta(days=flags["schedule_days"])
                sched_stmt = select(Event).where(Event.org_id == org_id, Event.start_at >= since, Event.start_at <= until)
                if user_id:
                    sched_stmt = sched_stmt.where((Event.assigned_to == user_id) | (Event.created_by == user_id))
                sched_stmt = sched_stmt.order_by(Event.start_at.asc()).limit(200)
                if flags["selected_schedule_event_ids"]:
                    valid_eids: list[uuid.UUID] = []
                    for raw in flags["selected_schedule_event_ids"]:
                        try:
                            valid_eids.append(uuid.UUID(raw))
                        except ValueError:
                            continue
                    if valid_eids:
                        sched_stmt = (
                            select(Event)
                            .where(Event.org_id == org_id, Event.id.in_(valid_eids))
                            .order_by(Event.start_at.asc())
                            .limit(200)
                        )
                events = (await uow.session.execute(sched_stmt)).scalars().all()
                if not events and user_id:
                    # Fallback: if personal schedule is empty, include org-level nearest events.
                    events = (
                        await uow.session.execute(
                            select(Event)
                            .where(Event.org_id == org_id, Event.start_at >= since, Event.start_at <= until)
                            .order_by(Event.start_at.asc())
                            .limit(100)
                        )
                    ).scalars().all()
                if events:
                    schedule_lines: list[str] = []
                    for ev in events:
                        start_s = ev.start_at.isoformat() if ev.start_at else ""
                        end_s = ev.end_at.isoformat() if ev.end_at else ""
                        rec = ev.recurrence or "none"
                        schedule_lines.append(
                            f"{start_s} | {ev.title} | recurrence={rec} | all_day={ev.all_day} | end={end_s} | done={ev.is_done}"
                        )
                    schedule_block = "\n".join(schedule_lines)
                    parts.append("\n=== SCHEDULE ===")
                    parts.append(schedule_block)
                    meta["sources"]["schedule"]["chars"] = len(schedule_block)
                    meta["sources"]["schedule"]["estimated_tokens"] = estimate_tokens(schedule_block)
    except Exception:
        pass

    full_text = "\n".join(parts)
    text, truncated, used_tokens = _truncate_text_to_token_budget(full_text, flags["max_context_tokens"])
    meta["context_truncated"] = bool(truncated)
    meta["used_context_tokens"] = int(used_tokens)
    # Backwards-compatible: keep estimated_total_tokens as "context + overhead" until routes add prompt estimate.
    meta["estimated_total_tokens"] = int(meta["used_context_tokens"]) + int(meta["model_overhead_tokens"])
    return text, meta


async def build_org_context_for_user(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    options: dict | None = None,
) -> tuple[str, dict[str, Any]]:
    return await _build_org_context_internal(org_id=org_id, user_id=user_id, options=options)


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _resolve_table_by_ref(tables: list[Table], table_ref: str) -> Table | None:
    if not table_ref:
        return None
    clean_ref = _normalize_name(table_ref)
    by_id = {str(t.id): t for t in tables}
    if table_ref in by_id:
        return by_id[table_ref]
    exact = { _normalize_name(t.name): t for t in tables }
    if clean_ref in exact:
        return exact[clean_ref]
    best: tuple[float, Table | None] = (0.0, None)
    for table_obj in tables:
        score = SequenceMatcher(None, clean_ref, _normalize_name(table_obj.name)).ratio()
        if clean_ref in _normalize_name(table_obj.name) or _normalize_name(table_obj.name) in clean_ref:
            score = max(score, 0.82)
        if score > best[0]:
            best = (score, table_obj)
    return best[1] if best[0] >= 0.72 else None


def _resolve_column_id(column_ref: Any, columns: list[Column]) -> str | None:
    if not column_ref:
        return None
    raw = str(column_ref).strip()
    if not raw:
        return None
    for col in columns:
        if str(col.id) == raw:
            return str(col.id)
    normalized = _normalize_name(raw)
    by_exact = {_normalize_name(c.name): str(c.id) for c in columns}
    if normalized in by_exact:
        return by_exact[normalized]
    best: tuple[float, str | None] = (0.0, None)
    for col in columns:
        score = SequenceMatcher(None, normalized, _normalize_name(col.name)).ratio()
        if normalized in _normalize_name(col.name) or _normalize_name(col.name) in normalized:
            score = max(score, 0.82)
        if score > best[0]:
            best = (score, str(col.id))
    return best[1] if best[0] >= 0.7 else None


def _safe_field_type(raw: Any) -> str:
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


def _is_generic_widget_title(title: Any) -> bool:
    value = str(title or "").strip().lower()
    if not value:
        return True
    return bool(re.fullmatch(r"(widget|виджет)\s*\d*", value))


def _should_use_inferred_widgets(widgets_payload: list[dict[str, Any]]) -> bool:
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
        generic = _is_generic_widget_title(raw.get("title"))
        if agg == "count" and wtype == "metric" and not has_group and not has_value and generic:
            low_signal += 1
    return checked > 0 and low_signal == checked


def _pick_column_by_keywords(columns: list[Column], keywords: tuple[str, ...], allow_types: tuple[str, ...] | None = None) -> Column | None:
    for col in columns:
        if allow_types and col.field_type not in allow_types:
            continue
        name_norm = _normalize_name(col.name)
        if any(k in name_norm for k in keywords):
            return col
    return None


def _infer_widgets_for_table(table_obj: Table, normalized_message: str) -> list[dict[str, Any]]:
    columns = list(table_obj.columns)
    text_cols = [c for c in columns if c.field_type in (FieldType.TEXT, FieldType.SELECT, FieldType.MULTI_SELECT)]
    num_cols = [c for c in columns if c.field_type in (FieldType.NUMBER, FieldType.FORMULA)]
    date_cols = [c for c in columns if c.field_type in (FieldType.DATE, FieldType.DATETIME)]

    salary_col = _pick_column_by_keywords(num_cols, ("salary", "зарп", "оклад", "доход", "wage", "pay"))
    value_col = salary_col or (num_cols[0] if num_cols else None)
    dept_col = _pick_column_by_keywords(text_cols, ("отдел", "department", "dept", "team"))
    role_col = _pick_column_by_keywords(text_cols, ("должн", "position", "role", "title", "проф"))
    date_col = _pick_column_by_keywords(date_cols, ("дата", "date", "hire", "прием"))

    employee_like = any(x in normalized_message for x in ("employee", "staff", "personnel", "сотруд", "штат"))
    total_title = "Всего сотрудников" if employee_like else "Всего записей"
    avg_title = "Средняя зарплата" if salary_col else "Среднее значение"
    sum_title = "Фонд оплаты" if salary_col else "Сумма значений"

    widgets: list[dict[str, Any]] = [{"title": total_title, "widget_type": "metric", "aggregation": "count"}]

    if value_col:
        widgets.append({"title": avg_title, "widget_type": "metric", "aggregation": "avg", "value_column_id": str(value_col.id)})
        widgets.append({"title": sum_title, "widget_type": "metric", "aggregation": "sum", "value_column_id": str(value_col.id)})
    if dept_col:
        widgets.append({"title": "По отделам", "widget_type": "bar", "aggregation": "count", "group_by_column_id": str(dept_col.id), "limit": 20})
    if role_col:
        widgets.append({"title": "По должностям", "widget_type": "bar", "aggregation": "count", "group_by_column_id": str(role_col.id), "limit": 20})
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


def _resolve_row_key_to_column_id(row_key: Any, columns: list[Column]) -> str | None:
    if row_key is None:
        return None
    key = str(row_key).strip()
    if not key:
        return None
    for col in columns:
        if str(col.id) == key:
            return str(col.id)
    normalized = _normalize_name(key)
    by_name = {_normalize_name(c.name): str(c.id) for c in columns}
    if normalized in by_name:
        return by_name[normalized]
    return None


def _extract_rows_payload(action_payload: dict[str, Any]) -> list[dict[str, Any]]:
    source = action_payload.get("records")
    if not isinstance(source, list):
        source = action_payload.get("rows")
    if not isinstance(source, list):
        source = action_payload.get("data_rows")
    if not isinstance(source, list):
        return []
    out: list[dict[str, Any]] = []
    for item in source[:200]:
        if isinstance(item, dict):
            out.append(item)
    return out


def _infer_rows_from_message(user_message: str | None, columns: list[Column]) -> list[dict[str, Any]]:
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
    text_target = primary or next((c for c in columns if c.field_type in (FieldType.TEXT, FieldType.URL, FieldType.EMAIL, FieldType.PHONE)), None)
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
            options_norm = {_normalize_name(str(o)): str(o) for o in options}
            picked: str | None = None
            for i, tok in enumerate(tokens):
                if i in used:
                    continue
                norm_tok = _normalize_name(tok)
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
    if not rows_payload:
        return [], [], 0

    # Hard limit to keep requests predictable and avoid huge payloads / UI breakage.
    max_rows = 20
    ignored = max(0, len(rows_payload) - max_rows)
    rows_payload = rows_payload[:max_rows]

    col_ids = {str(c.id) for c in table_obj.columns}
    primary_col = next((c for c in table_obj.columns if c.is_primary), None)
    max_position = (
        await uow.session.execute(select(func.coalesce(func.max(Record.position), -1)).where(Record.table_id == table_obj.id))
    ).scalar_one()

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
            table_id=table_obj.id,
            org_id=org_id,
            created_by=user_id,
            data=record_data,
            position=int(max_position),
        )
        uow.session.add(rec)
        created.append(rec)
        if len(preview) < 5:
            preview.append({col_name_by_id.get(k, k): v for k, v in record_data.items()})

    await uow.session.flush()
    return created, preview, ignored


async def get_or_create_session(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    chat_id: str | None,
    first_message: str,
) -> AIChatSession:
    if chat_id:
        try:
            existing = (
                await uow.session.execute(
                    select(AIChatSession).where(
                        AIChatSession.id == uuid.UUID(chat_id),
                        AIChatSession.org_id == org_id,
                        AIChatSession.user_id == user_id,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                return existing
        except Exception:
            pass

    title = (first_message or "Новый чат").strip()[:80] or "Новый чат"
    session = AIChatSession(org_id=org_id, user_id=user_id, title=title)
    uow.session.add(session)
    await uow.session.flush()
    return session


def _find_first_action_json(text: str) -> tuple[dict[str, Any] | None, str]:
    decoder = json.JSONDecoder()
    pos = 0
    while True:
        idx = text.find("{", pos)
        if idx == -1:
            return None, text
        try:
            obj, end = decoder.raw_decode(text[idx:])
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                cleaned = (text[:idx] + text[idx + end :]).strip()
                return obj, cleaned
            pos = idx + max(1, end)
        except Exception:
            pos = idx + 1


def extract_action_payload(reply: str) -> tuple[dict[str, Any] | None, str]:
    if not reply:
        return None, reply
    pattern = r"```crm_action\s*(\{[\s\S]*?\})\s*```"
    match = re.search(pattern, reply)
    if match:
        payload_raw = match.group(1)
        cleaned = re.sub(pattern, "", reply).strip()
        try:
            payload = json.loads(payload_raw)
            if isinstance(payload, dict):
                return payload, cleaned
        except Exception:
            pass
        return None, cleaned
    return _find_first_action_json(reply)


async def handle_create_dashboard_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    name = str(action_payload.get("name") or "AI Dashboard").strip()[:255]
    description = str(action_payload.get("description") or "").strip() or None
    widgets_payload = action_payload.get("widgets") if isinstance(action_payload.get("widgets"), list) else []

    dash = ReportDashboard(org_id=org_id, created_by=user_id, name=name, description=description)
    uow.session.add(dash)
    await uow.session.flush()

    tables = (
        await uow.session.execute(
            select(Table).where(Table.org_id == org_id, Table.is_archived.is_(False)).options(selectinload(Table.columns))
        )
    ).scalars().all()
    table_record_counts: dict[str, int] = {}
    for table_obj in tables:
        cnt = (
            await uow.session.execute(select(func.count(Record.id)).where(Record.table_id == table_obj.id))
        ).scalar() or 0
        table_record_counts[str(table_obj.id)] = int(cnt)

    normalized_message = _normalize_name(user_message or "")
    wants_bar_like = any(x in normalized_message for x in ("bar", "гистограмм", "диаграм", "chart"))
    wants_sum_like = any(x in normalized_message for x in (" sum", "сумм", "выручк", "total"))
    global_table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    if _should_use_inferred_widgets(widgets_payload):
        inferred_table: Table | None = None
        if global_table_ref:
            inferred_table = _resolve_table_by_ref(tables, global_table_ref)
        if inferred_table is None and normalized_message:
            for table_obj in tables:
                n = _normalize_name(table_obj.name)
                if n and n in normalized_message:
                    inferred_table = table_obj
                    break
        if inferred_table is None and len(tables) == 1:
            inferred_table = tables[0]
        if inferred_table is None and tables:
            inferred_table = sorted(tables, key=lambda t: table_record_counts.get(str(t.id), 0), reverse=True)[0]
        if inferred_table is not None:
            widgets_payload = _infer_widgets_for_table(inferred_table, normalized_message)

    # Fallback: ensure we always create at least one valid widget if user asked for a dashboard
    # but provider returned an empty/invalid widgets list.
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
                n = _normalize_name(table_obj.name)
                if n and n in normalized_message:
                    table_ref = table_obj.name
                    break
        if not table_ref and len(tables) == 1:
            table_ref = tables[0].name
        if not table_ref and tables:
            best_table = sorted(tables, key=lambda t: table_record_counts.get(str(t.id), 0), reverse=True)[0]
            table_ref = best_table.name
        table_obj = _resolve_table_by_ref(tables, table_ref)
        if table_obj is None:
            skipped.append({"index": idx, "reason": "table_not_found", "table_ref": table_ref})
            continue

        resolved_value_col = _resolve_column_id(
            raw.get("value_column_id") or raw.get("value_column_name"),
            table_obj.columns,
        )
        resolved_group_col = _resolve_column_id(
            raw.get("group_by_column_id") or raw.get("group_by_column_name"),
            table_obj.columns,
        )
        agg_name = str(raw.get("aggregation") or "count")
        widget_type = str(raw.get("widget_type") or "metric")
        if wants_bar_like and widget_type == "metric":
            widget_type = "bar"
        if wants_sum_like and agg_name == "count":
            agg_name = "sum"
        if agg_name in ("sum", "avg", "min", "max") and not resolved_value_col:
            num_col = next((c for c in table_obj.columns if c.field_type in (FieldType.NUMBER, FieldType.FORMULA)), None)
            if num_col:
                resolved_value_col = str(num_col.id)
        if widget_type in ("bar", "line", "pie") and not resolved_group_col:
            text_col = next((c for c in table_obj.columns if c.field_type in (FieldType.TEXT, FieldType.SELECT, FieldType.MULTI_SELECT)), None)
            if text_col:
                resolved_group_col = str(text_col.id)
        selected_column_ids: list[str] = []
        for col_ref in (raw.get("selected_column_ids") or raw.get("selected_column_names") or []):
            col_id = _resolve_column_id(col_ref, table_obj.columns)
            if col_id:
                selected_column_ids.append(col_id)

        raw_filters = raw.get("filters") or []
        normalized_filters: list[dict[str, Any]] = []
        if isinstance(raw_filters, list):
            for f in raw_filters:
                if not isinstance(f, dict):
                    continue
                resolved_filter_col = _resolve_column_id(
                    f.get("column_id") or f.get("column_name"),
                    table_obj.columns,
                )
                if not resolved_filter_col:
                    continue
                normalized_filters.append(
                    {
                        "column_id": resolved_filter_col,
                        "op": str(f.get("op") or "eq"),
                        "value": f.get("value"),
                    }
                )

        cfg = WidgetConfig.model_validate(
            {
                "aggregation": agg_name,
                "value_column_id": resolved_value_col,
                "group_by_column_id": resolved_group_col,
                "time_column_id": _resolve_column_id(raw.get("time_column_id") or raw.get("time_column_name"), table_obj.columns),
                "time_granularity": str(raw.get("time_granularity") or "day"),
                "filters": normalized_filters,
                "limit": int(raw.get("limit") or 10),
                "selected_column_ids": selected_column_ids,
            }
        )
        widget = ReportWidget(
            dashboard_id=dash.id,
            org_id=org_id,
            title=str(raw.get("title") or f"Widget {idx + 1}")[:255],
            widget_type=widget_type,
            table_id=table_obj.id if table_obj else None,
            config=cfg.model_dump(),
            position=idx,
        )
        uow.session.add(widget)
        created_widgets.append(widget)

    await uow.session.flush()
    preview_items: list[dict[str, Any]] = []
    for widget in created_widgets:
        preview_items.append(
            {
                "widget_id": str(widget.id),
                "title": widget.title,
                "widget_type": widget.widget_type,
                "table_id": str(widget.table_id) if widget.table_id else None,
                "config": widget.config or {},
                "data": await build_widget_data(uow.session, org_id, widget),
            }
        )
    return {
        "action": "create_dashboard",
        "dashboard": {"id": str(dash.id), "name": dash.name, "description": dash.description},
        "items": preview_items,
        "skipped": skipped,
    }


async def handle_create_table_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    name = str(action_payload.get("name") or action_payload.get("table_name") or "").strip()[:255]
    if not name:
        return {"action": "create_table", "ok": False, "error": "table_name_required"}

    description = str(action_payload.get("description") or "").strip() or None
    icon = str(action_payload.get("icon") or "").strip() or None
    color = str(action_payload.get("color") or "").strip()[:20] or None

    table_obj = Table(
        org_id=org_id,
        created_by=user_id,
        name=name,
        description=description,
        icon=icon,
        color=color,
        is_archived=False,
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
        col_name = str(raw.get("name") or "").strip()[:255]
        if not col_name:
            continue
        field_type = _safe_field_type(raw.get("field_type"))
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
    created_records, records_preview, ignored = await _create_records_for_table(uow, org_id, user_id, table_obj, rows_payload)
    return {
        "action": "create_table",
        "ok": True,
        "table": {
            "id": str(table_obj.id),
            "name": table_obj.name,
            "description": table_obj.description,
        },
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
    table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    raw_columns = action_payload.get("columns")
    columns_payload = raw_columns if isinstance(raw_columns, list) else []
    if not table_ref:
        return {"action": "create_columns", "ok": False, "error": "table_ref_required"}
    if not columns_payload:
        return {"action": "create_columns", "ok": False, "error": "columns_required"}

    tables = (
        await uow.session.execute(
            select(Table).where(Table.org_id == org_id, Table.is_archived.is_(False)).options(selectinload(Table.columns))
        )
    ).scalars().all()
    table_obj = _resolve_table_by_ref(tables, table_ref)
    if table_obj is None:
        return {"action": "create_columns", "ok": False, "error": "table_not_found", "table_ref": table_ref}

    existing_names = {_normalize_name(c.name) for c in table_obj.columns}
    max_position = max((int(c.position or 0) for c in table_obj.columns), default=-1)
    created_columns: list[Column] = []
    skipped: list[dict[str, Any]] = []
    primary_exists = any(bool(c.is_primary) for c in table_obj.columns)

    for idx, raw in enumerate(columns_payload[:50]):
        if not isinstance(raw, dict):
            continue
        col_name = str(raw.get("name") or "").strip()[:255]
        if not col_name:
            continue
        normalized_name = _normalize_name(col_name)
        if normalized_name in existing_names:
            skipped.append({"index": idx, "name": col_name, "reason": "already_exists"})
            continue

        field_type = _safe_field_type(raw.get("field_type"))
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
    created_records, records_preview, ignored = await _create_records_for_table(uow, org_id, user_id, table_obj, rows_payload)
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
    table_ref = str(action_payload.get("table_id") or action_payload.get("table_name") or "").strip()
    if not table_ref:
        return {"action": "create_records", "ok": False, "error": "table_ref_required"}
    tables = (
        await uow.session.execute(
            select(Table).where(Table.org_id == org_id, Table.is_archived.is_(False)).options(selectinload(Table.columns))
        )
    ).scalars().all()
    table_obj = _resolve_table_by_ref(tables, table_ref)
    if table_obj is None:
        return {"action": "create_records", "ok": False, "error": "table_not_found", "table_ref": table_ref}

    rows_payload = _extract_rows_payload(action_payload)
    if not rows_payload:
        rows_payload = _infer_rows_from_message(user_message, list(table_obj.columns))
    if not rows_payload:
        return {"action": "create_records", "ok": False, "error": "records_required"}

    created_records, records_preview, ignored = await _create_records_for_table(uow, org_id, user_id, table_obj, rows_payload)
    return {
        "action": "create_records",
        "ok": True,
        "table": {"id": str(table_obj.id), "name": table_obj.name},
        "records_created": len(created_records),
        "records_ignored": int(ignored),
        "records_preview": records_preview,
    }


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Accept RFC3339 with Z.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def handle_create_schedule_event_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    title = str(action_payload.get("title") or action_payload.get("name") or "").strip()[:500]
    if not title:
        return {"action": "create_schedule_event", "ok": False, "error": "title_required"}

    start_at = _parse_dt(action_payload.get("start_at"))
    if start_at is None:
        return {"action": "create_schedule_event", "ok": False, "error": "start_at_required"}

    end_at = _parse_dt(action_payload.get("end_at"))
    description = str(action_payload.get("description") or "").strip() or None
    color = str(action_payload.get("color") or "").strip()[:20] or None
    recurrence = str(action_payload.get("recurrence") or "").strip() or None
    all_day = bool(action_payload.get("all_day") or False)

    assigned_to_raw = action_payload.get("assigned_to")
    assigned_to: uuid.UUID | None = None
    try:
        if assigned_to_raw:
            assigned_to = uuid.UUID(str(assigned_to_raw))
    except Exception:
        assigned_to = None
    if assigned_to is None:
        assigned_to = user_id

    event = Event(
        org_id=org_id,
        created_by=user_id,
        assigned_to=assigned_to,
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
        all_day=all_day,
        color=color,
        recurrence=recurrence,
    )
    uow.session.add(event)
    await uow.session.flush()
    return {
        "action": "create_schedule_event",
        "ok": True,
        "event": {
            "id": str(event.id),
            "title": event.title,
            "start_at": event.start_at.isoformat(),
            "end_at": event.end_at.isoformat() if event.end_at else None,
            "recurrence": event.recurrence,
        },
    }


async def handle_create_kb_page_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    title = str(action_payload.get("title") or action_payload.get("name") or "").strip()[:500]
    if not title:
        return {"action": "create_kb_page", "ok": False, "error": "title_required"}

    content = action_payload.get("content")
    if content is not None:
        content = str(content)
    icon = str(action_payload.get("icon") or "").strip() or None

    parent_id_raw = action_payload.get("parent_id")
    parent_id: uuid.UUID | None = None
    try:
        if parent_id_raw:
            parent_id = uuid.UUID(str(parent_id_raw))
    except Exception:
        parent_id = None

    slug = title.lower().replace(" ", "-")[:200]
    page = KBPage(
        org_id=org_id,
        created_by=user_id,
        title=title,
        slug=slug,
        content=content,
        parent_id=parent_id,
        icon=icon,
    )
    uow.session.add(page)
    await uow.session.flush()
    return {
        "action": "create_kb_page",
        "ok": True,
        "page": {"id": str(page.id), "title": page.title, "slug": page.slug},
    }


def build_messages(
    system_prompt: str,
    org_context: str,
    db_messages: list[AIChatMessage],
    history: list[dict[str, str]],
    user_message: str,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if org_context:
        messages.append({"role": "system", "content": f"Organization context:\n\n{org_context}"})
    messages.append(
        {
            "role": "system",
            "content": (
                "IMPORTANT:\n"
                "- Only append ONE final ```crm_action``` block at the end of your answer.\n"
                "- If the user asks for a dashboard/report, do NOT modify tables. Return create_dashboard only.\n"
                "- Do NOT create columns/records unless the user explicitly asked to change/fill a table.\n"
                "- Never dump huge JSON in the normal text. Put the action JSON ONLY inside the final ```crm_action``` block.\n"
                "- Keep payloads small: if user asks for 50/100+ rows, create the table first with empty records, then offer to fill in batches (<= 20 rows per request).\n"
                "If user asks to create dashboard/report, append final block:\n"
                "```crm_action\n"
                '{"action":"create_dashboard","name":"...","description":"...","widgets":[...]}\n'
                "```"
                "\nIf user asks to create a table, append final block:\n"
                "```crm_action\n"
                '{"action":"create_table","name":"...","description":"...","columns":[{"name":"...","field_type":"text"}],"records":[{"Название":"..."}]}\n'
                "```"
                "\nIf user asks to add columns to an existing table, append final block:\n"
                "```crm_action\n"
                '{"action":"create_columns","table_name":"...","columns":[{"name":"...","field_type":"number"}]}\n'
                "```"
                "\nIf user asks to fill table rows, append final block:\n"
                "```crm_action\n"
                '{"action":"create_records","table_name":"...","records":[{"Column":"Value"}]}\n'
                "```"
                "\nIf user asks to create a schedule event, append final block:\n"
                "```crm_action\n"
                '{"action":"create_schedule_event","title":"...","start_at":"2026-01-01T10:00:00Z","end_at":null,"all_day":false,"recurrence":null}\n'
                "```"
                "\nIf user asks to create a knowledge base page, append final block:\n"
                "```crm_action\n"
                '{"action":"create_kb_page","title":"...","content":"# Title\\n..."}\n'
                "```"
            ),
        }
    )
    if db_messages:
        for msg in db_messages[-20:]:
            messages.append({"role": msg.role, "content": msg.content})
    else:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_message})
    return messages


async def call_openai_compatible_api(
    base_url: str,
    bearer_token: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int = 2000,
) -> dict[str, Any]:
    clean_base = base_url.rstrip("/")
    if clean_base.endswith("/v1"):
        clean_base = clean_base[:-3]
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{clean_base}/v1/chat/completions",
            headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
            # Lower temperature improves determinism for action selection.
            json={"model": model, "messages": messages, "max_tokens": max(256, int(max_tokens)), "temperature": 0.3},
        )
        resp.raise_for_status()
        return resp.json()

