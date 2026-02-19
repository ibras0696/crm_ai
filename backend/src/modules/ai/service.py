"""AI service logic: context, chat session, and action execution."""

import json
import re
import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIChatMessage, AIChatSession
from src.modules.knowledge.models import KBPage
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.routes import WidgetConfig, _build_widget_data
from src.modules.tables.models import Table
from src.modules.tables.records import Record


def estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / 3.0)) if text else 0


def context_flags(options: dict | None) -> dict[str, Any]:
    src = options or {}
    kb_ids = [str(x) for x in (src.get("selected_kb_page_ids") or []) if str(x).strip()]
    table_ids = [str(x) for x in (src.get("selected_table_ids") or []) if str(x).strip()]
    return {
        "include_kb": bool(src.get("include_kb", True)),
        "include_table_schema": bool(src.get("include_table_schema", True)),
        "include_table_records": bool(src.get("include_table_records", True)),
        "kb_limit": max(1, min(int(src.get("kb_limit", 30)), 300)),
        "tables_limit": max(1, min(int(src.get("tables_limit", 20)), 200)),
        "records_per_table": max(1, min(int(src.get("records_per_table", 5)), 20)),
        "selected_kb_page_ids": kb_ids,
        "selected_table_ids": table_ids,
    }


async def build_org_context(org_id: uuid.UUID, options: dict | None = None) -> tuple[str, dict[str, Any]]:
    flags = context_flags(options)
    parts: list[str] = []
    meta: dict[str, Any] = {
        "enabled": True,
        "sources": {
            "kb": {"enabled": flags["include_kb"], "chars": 0, "estimated_tokens": 0},
            "table_schema": {"enabled": flags["include_table_schema"], "chars": 0, "estimated_tokens": 0},
            "table_records": {"enabled": flags["include_table_records"], "chars": 0, "estimated_tokens": 0},
        },
        "selected": {"kb_pages": flags["selected_kb_page_ids"], "tables": flags["selected_table_ids"]},
        "model_overhead_tokens": 120,
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
                        cols = ", ".join(c.name for c in sorted(table_obj.columns, key=lambda x: x.position))
                        schema_lines.append(f"Table: {table_obj.name} | Columns: {cols}")
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
    except Exception:
        pass

    text = "\n".join(parts)[:6000]
    base_total = (
        meta["sources"]["kb"]["estimated_tokens"]
        + meta["sources"]["table_schema"]["estimated_tokens"]
        + meta["sources"]["table_records"]["estimated_tokens"]
    )
    meta["estimated_total_tokens"] = max(int(base_total * 1.35) + int(meta["model_overhead_tokens"]), estimate_tokens(text))
    return text, meta


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

    title = (first_message or "\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442").strip()[:80] or "\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442"
    session = AIChatSession(org_id=org_id, user_id=user_id, title=title)
    uow.session.add(session)
    await uow.session.flush()
    return session


def extract_action_payload(reply: str) -> tuple[dict[str, Any] | None, str]:
    if not reply:
        return None, reply
    pattern = r"```crm_action\s*(\{[\s\S]*?\})\s*```"
    match = re.search(pattern, reply)
    if not match:
        return None, reply
    payload_raw = match.group(1)
    cleaned = re.sub(pattern, "", reply).strip()
    try:
        payload = json.loads(payload_raw)
        if isinstance(payload, dict):
            return payload, cleaned
    except Exception:
        return None, cleaned
    return None, cleaned


async def handle_create_dashboard_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
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
    tables_by_id = {str(t.id): t for t in tables}
    tables_by_name = {t.name.strip().lower(): t for t in tables}

    created_widgets: list[ReportWidget] = []
    for idx, raw in enumerate(widgets_payload[:8]):
        if not isinstance(raw, dict):
            continue
        table_ref = str(raw.get("table_id") or raw.get("table_name") or "").strip()
        table_obj = tables_by_id.get(table_ref) or tables_by_name.get(table_ref.lower())
        cfg = WidgetConfig.model_validate(
            {
                "aggregation": str(raw.get("aggregation") or "count"),
                "value_column_id": raw.get("value_column_id"),
                "group_by_column_id": raw.get("group_by_column_id"),
                "filters": raw.get("filters") or [],
                "limit": int(raw.get("limit") or 10),
                "selected_column_ids": raw.get("selected_column_ids") or [],
            }
        )
        widget = ReportWidget(
            dashboard_id=dash.id,
            org_id=org_id,
            title=str(raw.get("title") or f"Widget {idx + 1}")[:255],
            widget_type=str(raw.get("widget_type") or "metric"),
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
                "data": await _build_widget_data(uow.session, org_id, widget),
            }
        )
    return {
        "action": "create_dashboard",
        "dashboard": {"id": str(dash.id), "name": dash.name, "description": dash.description},
        "items": preview_items,
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
                "If user asks to create dashboard/report, append final block:\n"
                "```crm_action\n"
                '{"action":"create_dashboard","name":"...","description":"...","widgets":[...]}\n'
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
) -> dict[str, Any]:
    clean_base = base_url.rstrip("/")
    if clean_base.endswith("/v1"):
        clean_base = clean_base[:-3]
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{clean_base}/v1/chat/completions",
            headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages, "max_tokens": 2000, "temperature": 0.7},
        )
        resp.raise_for_status()
        return resp.json()
