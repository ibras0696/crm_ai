"""Вспомогательная логика AI-чата: сессии, сообщения и вызов провайдера."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import httpx
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIChatMessage, AIChatSession

logger = logging.getLogger(__name__)


async def get_or_create_session(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    chat_id: str | None,
    first_message: str,
) -> AIChatSession:
    """Получить существующую сессию чата или создать новую."""
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
        except Exception as exc:
            logger.warning("ai_get_session_failed_fallback_to_new", exc_info=exc)

    title = (first_message or "Новый чат").strip()[:80] or "Новый чат"
    session = AIChatSession(org_id=org_id, user_id=user_id, title=title)
    uow.session.add(session)
    await uow.session.flush()
    return session


def build_messages(
    system_prompt: str,
    org_context: str,
    db_messages: list[AIChatMessage],
    history: list[dict[str, str]],
    user_message: str,
) -> list[dict[str, str]]:
    """Собрать массив сообщений для OpenAI-compatible chat completions."""
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if org_context:
        messages.append({"role": "system", "content": f"Organization context:\n\n{org_context}"})
    messages.append(
        {
            "role": "system",
            "content": (
                "IMPORTANT:\n"
                "- Only append ONE final ```crm_action``` block at the end of your answer.\n"
                "- If user did not explicitly ask to create/change entities, do NOT append crm_action.\n"
                "- If the user asks for a dashboard/report, do NOT modify tables. Return create_dashboard only.\n"
                "- Do NOT create columns/records unless the user explicitly asked to change/fill a table.\n"
                "- For dashboards: explain in simple business language what is on horizontal axis, vertical axis and what filters are applied.\n"
                "- For dashboards: use only existing table/column names from context. Never invent missing columns.\n"
                "- If columns are not enough for requested dashboard, ask a short clarifying question instead of generating fake config.\n"
                "- Prefer human-friendly keys in action payload (for schedule: дата/время/повтор/цвет/напоминания).\n"
                "- Never dump huge JSON in the normal text. Put the action JSON ONLY inside the final ```crm_action``` block.\n"
                "- If user explicitly asks for many rows (100/500/1000), return records in action payload up to real system limits.\n"
                "- For table rows ALWAYS use compact records format ONLY: records={columns:[...],rows:[[...],[...]]}. NEVER use list of objects for records.\n"
                "If user asks to create dashboard/report, append final block:\n"
                "```crm_action\n"
                '{"action":"create_dashboard","name":"...","description":"...","widgets":[...]}\n'
                "```"
                "\nIf user asks to create a table, append final block:\n"
                "```crm_action\n"
                '{"action":"create_table","name":"...","description":"...","columns":[{"name":"...","field_type":"text"}],"records":{"columns":["Название"],"rows":[["..."]]}}\n'
                "```"
                "\nIf user asks to add columns to an existing table, append final block:\n"
                "```crm_action\n"
                '{"action":"create_columns","table_name":"...","columns":[{"name":"...","field_type":"number"}]}\n'
                "```"
                "\nIf user asks to fill table rows, append final block:\n"
                "```crm_action\n"
                '{"action":"create_records","table_name":"...","records":{"columns":["Column"],"rows":[["Value"]]}}\n'
                "```"
                "\nIf user asks to create a schedule event, append final block:\n"
                "```crm_action\n"
                '{"action":"create_schedule_event","title":"...","start_at":"2026-01-01T10:00:00Z","end_at":null,"all_day":false,"recurrence":null}\n'
                "```"
                "\nIf user asks to create a knowledge base page, append final block:\n"
                "```crm_action\n"
                '{"action":"create_kb_page","title":"Курс Python","content":"Описание курса","pages":[{"title":"Урок 1","content":"..."},{"title":"Урок 2","content":"..."}]}\n'
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
    temperature: float = 0.3,
) -> dict[str, Any]:
    """Вызвать OpenAI-compatible endpoint `/v1/chat/completions`."""
    clean_base = base_url.rstrip("/")
    if clean_base.endswith("/v1"):
        clean_base = clean_base[:-3]
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{clean_base}/v1/chat/completions",
            headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max(256, int(max_tokens)),
                "temperature": float(max(0.0, min(2.0, temperature))),
            },
        )
        resp.raise_for_status()
        return resp.json()


def resolve_timeweb_agent_id(base_url: str) -> str | None:
    """Извлечь agent_id из OpenAI-compatible URL Timeweb."""
    text = (base_url or "").strip().rstrip("/")
    m = re.search(r"/api/v1/cloud-ai/agents/([a-zA-Z0-9-]+)/v1$", text)
    if not m:
        return None
    return m.group(1)


async def call_timeweb_native_api(
    *,
    base_url: str,
    bearer_token: str,
    message: str,
    parent_message_id: str | None = None,
) -> dict[str, Any]:
    """Вызвать нативный API Timeweb `/call` c parent_message_id."""
    agent_id = resolve_timeweb_agent_id(base_url)
    if not agent_id:
        raise ValueError("TIMEWEB_AGENT_ID_NOT_FOUND")
    payload: dict[str, Any] = {"message": message}
    if parent_message_id:
        payload["parent_message_id"] = parent_message_id
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"https://api.timeweb.cloud/api/v1/cloud-ai/agents/{agent_id}/call",
            headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()
