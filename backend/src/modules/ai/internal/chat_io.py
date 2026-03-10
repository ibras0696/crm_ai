"""Вспомогательная логика AI-чата: сбор сообщений и вызов провайдера."""

from __future__ import annotations

import asyncio
import re
from typing import TYPE_CHECKING, Any

import httpx

from src.config import settings
from src.modules.ai.internal.prompts import ACTION_INSTRUCTIONS_PROMPT

if TYPE_CHECKING:
    from src.modules.ai.models import AIChatMessage


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
    """Собрать список сообщений для OpenAI-compatible chat-completions.

    Args:
        system_prompt: Основной system prompt.
        org_context: Контекст организации.
        db_messages: История из БД (ORM-объекты).
        history: История в plain-формате (`role/content`).
        user_message: Текущее сообщение пользователя.
        include_system_prompt: Добавлять ли `system_prompt`.
        include_action_instructions: Добавлять ли action-инструкции.
        compact_history: Включить компактный режим истории.

    Returns:
        Список сообщений в формате API chat-completions.
    """

    def _clip(text: str, limit: int = 1800) -> str:
        """Ограничить длину текста для стабильности запроса.

        Args:
            text: Исходный текст.
            limit: Максимальная длина в символах.

        Returns:
            Исходный текст или укороченная версия с пометкой.
        """
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
        history_tail = db_messages[-(4 if compact_history else 12) :]
        for msg in history_tail:
            clip_limit = 700 if compact_history else 1800
            messages.append({"role": msg.role, "content": _clip(msg.content, clip_limit)})
    else:
        raw_tail = history[-(4 if compact_history else 8) :]
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
    """Вызвать OpenAI-compatible endpoint `/v1/chat/completions`.

    Args:
        base_url: Базовый URL провайдера.
        bearer_token: Токен доступа.
        model: Имя модели.
        messages: Сообщения запроса.
        max_tokens: Верхняя граница токенов ответа.
        temperature: Температура генерации.

    Returns:
        JSON-ответ провайдера.

    Raises:
        httpx.RequestError: Ошибка сети.
        httpx.HTTPStatusError: Ошибка HTTP-кода ответа.
    """
    clean_base = base_url.rstrip("/")
    if clean_base.endswith("/v1"):
        clean_base = clean_base[:-3]
    timeout_s = float(getattr(settings, "AI_PROVIDER_TIMEOUT_S", 35.0) or 35.0)
    attempts = max(1, int(getattr(settings, "AI_PROVIDER_RETRY_ATTEMPTS", 2) or 2))
    for attempt in range(1, attempts + 1):
        try:
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
        except (httpx.TimeoutException, httpx.RequestError):
            if attempt >= attempts:
                raise
            await asyncio.sleep(min(2.0, 0.5 * attempt))


def resolve_timeweb_agent_id(base_url: str) -> str | None:
    """Извлечь `agent_id` из OpenAI-compatible URL Timeweb.

    Args:
        base_url: Базовый URL провайдера.

    Returns:
        Строковый `agent_id` или None, если URL не соответствует шаблону.
    """
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
    """Вызвать нативный API Timeweb `/call`.

    Args:
        base_url: Базовый URL с OpenAI-compatible формой (для извлечения agent_id).
        bearer_token: Токен доступа.
        message: Сообщение пользователя/провайдера.
        parent_message_id: ID родительского сообщения для цепочки диалога.

    Returns:
        JSON-ответ API Timeweb.

    Raises:
        ValueError: Если `agent_id` не удалось извлечь из URL.
        httpx.RequestError: Ошибка сети.
        httpx.HTTPStatusError: Ошибка HTTP-кода ответа.
    """
    agent_id = resolve_timeweb_agent_id(base_url)
    if not agent_id:
        raise ValueError("TIMEWEB_AGENT_ID_NOT_FOUND")
    payload: dict[str, Any] = {"message": message}
    if parent_message_id:
        payload["parent_message_id"] = parent_message_id
    timeout_s = float(getattr(settings, "AI_PROVIDER_TIMEOUT_S", 35.0) or 35.0)
    attempts = max(1, int(getattr(settings, "AI_PROVIDER_RETRY_ATTEMPTS", 2) or 2))
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(
                    f"https://api.timeweb.cloud/api/v1/cloud-ai/agents/{agent_id}/call",
                    headers={"Authorization": f"Bearer {bearer_token}", "Content-Type": "application/json"},
                    json=payload,
                )
                resp.raise_for_status()
                return resp.json()
        except (httpx.TimeoutException, httpx.RequestError):
            if attempt >= attempts:
                raise
            await asyncio.sleep(min(2.0, 0.5 * attempt))
