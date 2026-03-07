from __future__ import annotations

"""Helper-вызовы модели для восстановления/синтеза crm_action."""

import json
from collections.abc import Awaitable, Callable

from src.modules.ai.internal.prompts import (
    ACTION_SYNTH_SYSTEM_PROMPT,
    JSON_REPAIR_SYSTEM_PROMPT,
    build_repair_user_prompt,
    build_synthesis_user_prompt,
)
from src.modules.ai.internal.chat_controller_parts.provider import _extract_provider_reply, _extract_usage_dict
from src.modules.ai.service import extract_action_payload

OpenAICall = Callable[..., Awaitable[dict]]


async def _repair_action_payload_with_model(
    *,
    base_url: str,
    bearer_token: str,
    model: str,
    broken_reply: str,
    openai_call: OpenAICall,
) -> tuple[dict | None, dict[str, int]]:
    """Попробовать восстановить валидный action JSON из битого ответа.

    Args:
        base_url: Базовый URL провайдера.
        bearer_token: Токен доступа.
        model: Имя модели.
        broken_reply: Сырой ответ с частично сломанным action.
        openai_call: Функция вызова OpenAI-compatible API.

    Returns:
        Кортеж `(action_payload, usage)`:
        `action_payload` — dict или None, `usage` — словарь токенов helper-вызова.
    """
    repair_messages = [
        {
            "role": "system",
            "content": JSON_REPAIR_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": build_repair_user_prompt(broken_reply),
        },
    ]
    try:
        data = await openai_call(
            base_url,
            bearer_token,
            model,
            repair_messages,
            max_tokens=1200,
            temperature=0,
        )
        raw = _extract_provider_reply(data).strip()
        if not raw:
            return None, _extract_usage_dict(data)
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
    except Exception:
        return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


async def _synthesize_missing_action_with_model(
    *,
    base_url: str,
    bearer_token: str,
    model: str,
    user_message: str,
    assistant_reply: str,
    openai_call: OpenAICall,
) -> tuple[dict | None, dict[str, int]]:
    """Синтезировать action JSON, если основной ответ не вернул `crm_action`.

    Args:
        base_url: Базовый URL провайдера.
        bearer_token: Токен доступа.
        model: Имя модели.
        user_message: Сообщение пользователя.
        assistant_reply: Ответ ассистента без action-блока.
        openai_call: Функция вызова OpenAI-compatible API.

    Returns:
        Кортеж `(action_payload, usage)`:
        `action_payload` — dict или None, `usage` — словарь токенов helper-вызова.
    """
    synth_messages = [
        {
            "role": "system",
            "content": ACTION_SYNTH_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": build_synthesis_user_prompt(user_message, assistant_reply),
        },
    ]
    try:
        data = await openai_call(
            base_url,
            bearer_token,
            model,
            synth_messages,
            max_tokens=1400,
            temperature=0,
        )
        raw = _extract_provider_reply(data).strip()
        if not raw:
            return None, _extract_usage_dict(data)
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
    except Exception:
        return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
