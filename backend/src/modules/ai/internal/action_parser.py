"""Парсинг `crm_action` из ответов AI-провайдера."""

from __future__ import annotations

import json
import re
from typing import Any


def _find_first_action_json(text: str) -> tuple[dict[str, Any] | None, str]:
    """Найти первый JSON-объект с непустым полем `action` в тексте.

    Args:
        text: Текст ответа модели.

    Returns:
        (payload, cleaned_text) где payload может быть None.
    """
    decoder = json.JSONDecoder()
    pos = 0
    while True:
        idx = text.find("{", pos)
        if idx == -1:
            return None, _strip_broken_action_blob(text)
        try:
            obj, end = decoder.raw_decode(text[idx:])
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                cleaned = (text[:idx] + text[idx + end :]).strip()
                return obj, cleaned
            pos = idx + max(1, end)
        except Exception:
            pos = idx + 1


def _strip_broken_action_blob(text: str) -> str:
    """Убрать сырой/битый action JSON из ответа, если он не распарсился.

    Если модель вывела обычный текст + незавершенный JSON с полем `action`,
    не показываем пользователю этот технический хвост.
    """
    idx = text.find("{")
    if idx == -1:
        return text
    tail = text[idx:]
    if '"action"' in tail or "'action'" in tail:
        head = text[:idx].strip()
        return head
    return text


def extract_action_payload(reply: str) -> tuple[dict[str, Any] | None, str]:
    """Извлечь `crm_action` из ответа модели.

    Поддерживаем 2 варианта:
    1) Блок ```crm_action { ... } ```
    2) "голый" JSON в тексте (fallback)

    Args:
        reply: Текст ответа модели.

    Returns:
        (payload, cleaned_reply)
    """
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
