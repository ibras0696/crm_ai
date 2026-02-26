"""Вспомогательная логика AI-чата: сессии, сообщения и вызов провайдера."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import httpx
from sqlalchemy import select

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIChatMessage, AIChatSession
from src.modules.ai.internal.prompts import ACTION_INSTRUCTIONS_PROMPT

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
    *,
    include_system_prompt: bool = True,
    include_action_instructions: bool = True,
    compact_history: bool = False,
) -> list[dict[str, str]]:
    """Собрать массив сообщений для OpenAI-compatible chat completions."""
    def _clip(text: str, limit: int = 1800) -> str:
        value = str(text or "")
        if len(value) <= limit:
            return value
        return value[: limit - 64] + "\n\n[...сообщение сокращено для стабильности запроса...]"

    messages: list[dict[str, str]] = []
    if include_system_prompt and (system_prompt or "").strip():
        messages.append({"role": "system", "content": system_prompt})
    if org_context:
        messages.append({"role": "system", "content": f"Organization context:\n\n{_clip(org_context, 3500)}"})
    if include_action_instructions:
        messages.append(
            {
                "role": "system",
                "content": ACTION_INSTRUCTIONS_PROMPT,
            }
        )
    if db_messages:
        history_tail = db_messages[-(4 if compact_history else 12):]
        for msg in history_tail:
            clip_limit = 700 if compact_history else 1800
            messages.append({"role": msg.role, "content": _clip(msg.content, clip_limit)})
    else:
        raw_tail = history[-(4 if compact_history else 8):]
        for item in raw_tail:
            clip_limit = 700 if compact_history else 1800
            messages.append({"role": item.get("role", "user"), "content": _clip(item.get("content", ""), clip_limit)})
    messages.append({"role": "user", "content": _clip(user_message, 900 if compact_history else 2200)})
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
    timeout_s = float(getattr(settings, "AI_PROVIDER_TIMEOUT_S", 35.0) or 35.0)
    async with httpx.AsyncClient(timeout=timeout_s) as client:
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
    timeout_s = float(getattr(settings, "AI_PROVIDER_TIMEOUT_S", 35.0) or 35.0)
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            f"https://api.timeweb.cloud/api/v1/cloud-ai/agents/{agent_id}/call",
            headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()
