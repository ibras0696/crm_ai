"""Сбор контекста организации для AI-диалогов."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.infrastructure.uow import UnitOfWork
from src.modules.knowledge.models import KBPage
from src.modules.schedule.models import Event
from src.modules.tables.models import Table
from src.modules.tables.records import Record

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    """Оценить количество токенов в тексте (эвристика)."""
    if not text:
        return 0
    chars_based = len(text) / 2.7
    bytes_based = len(text.encode("utf-8", errors="ignore")) / 4.0
    return max(1, int(max(chars_based, bytes_based)))


def context_flags(options: dict | None) -> dict[str, Any]:
    """Нормализовать опции контекста и проставить безопасные ограничения."""
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
    """Обрезать текст так, чтобы он приблизительно уложился в бюджет токенов."""
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
    """Собрать текстовый контекст организации (без user-specific фильтров)."""
    return await _build_org_context_internal(org_id=org_id, user_id=None, options=options)


async def _build_org_context_internal(
    org_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    options: dict | None = None,
) -> tuple[str, dict[str, Any]]:
    """Внутренняя реализация сборки контекста (org/user)."""
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
                records_by_table: dict[uuid.UUID, list[dict]] = {}
                if flags["include_table_records"]:
                    table_ids = [t.id for t in tables]
                    if table_ids:
                        ranked_recs = (
                            select(
                                Record.table_id.label("table_id"),
                                Record.data.label("data"),
                                func.row_number().over(
                                    partition_by=Record.table_id,
                                    order_by=Record.created_at.desc(),
                                ).label("rn"),
                            )
                            .where(Record.table_id.in_(table_ids))
                            .subquery()
                        )
                        rec_rows = (
                            await uow.session.execute(
                                select(ranked_recs.c.table_id, ranked_recs.c.data)
                                .where(ranked_recs.c.rn <= flags["records_per_table"])
                                .order_by(ranked_recs.c.table_id, ranked_recs.c.rn),
                            )
                        ).all()
                        for row in rec_rows:
                            table_id = row.table_id
                            if table_id not in records_by_table:
                                records_by_table[table_id] = []
                            records_by_table[table_id].append(row.data or {})

                for table_obj in tables:
                    if flags["include_table_schema"]:
                        col_parts = ", ".join(
                            f"{c.name}(id={c.id},type={c.field_type})"
                            for c in sorted(table_obj.columns, key=lambda x: x.position)
                        )
                        schema_lines.append(f"Table: {table_obj.name}(table_id={table_obj.id}) | Columns: {col_parts}")
                    if flags["include_table_records"]:
                        recs = records_by_table.get(table_obj.id, [])
                        if recs:
                            cmap = {str(c.id): c.name for c in table_obj.columns}
                            for rec in recs:
                                pairs = [f"{cmap.get(cid, cid[:8])}={val}" for cid, val in (rec or {}).items()]
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
    except Exception as exc:
        logger.exception("ai_context_build_failed", exc_info=exc)

    full_text = "\n".join(parts)
    text, truncated, used_tokens = _truncate_text_to_token_budget(full_text, flags["max_context_tokens"])
    meta["context_truncated"] = bool(truncated)
    meta["used_context_tokens"] = int(used_tokens)
    meta["estimated_total_tokens"] = int(meta["used_context_tokens"]) + int(meta["model_overhead_tokens"])
    return text, meta


async def build_org_context_for_user(
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    options: dict | None = None,
) -> tuple[str, dict[str, Any]]:
    """Собрать контекст организации для конкретного пользователя."""
    return await _build_org_context_internal(org_id=org_id, user_id=user_id, options=options)
