"""Парсинг `crm_action` из ответов AI-провайдера."""

from __future__ import annotations

import json
import re
from typing import Any


def _coerce_legacy_crm_action(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Преобразовать legacy-формат (`crm_action`) к текущему формату (`action`)."""
    crm_action = str(payload.get("crm_action") or "").strip().lower()
    if not crm_action:
        return None

    entity_type = str(payload.get("entity_type") or payload.get("entity") or "").strip().lower()
    props = payload.get("properties")
    properties = props if isinstance(props, dict) else {}

    if crm_action == "create_entity":
        # KB / Course-like сущности -> create_kb_page
        if entity_type in {"course", "kb_page", "knowledge_page", "knowledge_article", "wiki_page", "article"}:
            title = (
                properties.get("title")
                or properties.get("name")
                or payload.get("title")
                or payload.get("name")
                or "Новая страница"
            )
            content = (
                properties.get("content")
                or properties.get("description")
                or properties.get("body")
                or payload.get("content")
                or payload.get("description")
                or ""
            )
            pages = properties.get("pages") or payload.get("pages")
            out: dict[str, Any] = {
                "action": "create_kb_page",
                "title": str(title),
                "content": str(content),
            }
            if isinstance(pages, list):
                out["pages"] = pages
            return out

        # Таблица -> create_table
        if entity_type in {"table", "data_table"}:
            return {
                "action": "create_table",
                "name": properties.get("name") or payload.get("name") or payload.get("title") or "Новая таблица",
                "description": properties.get("description") or payload.get("description") or "",
                "columns": properties.get("columns") or payload.get("columns") or [],
                "records": properties.get("records") or payload.get("records") or [],
            }

        # Дашборд -> create_dashboard
        if entity_type in {"dashboard", "report"}:
            return {
                "action": "create_dashboard",
                "name": properties.get("name") or payload.get("name") or payload.get("title") or "Новый дашборд",
                "description": properties.get("description") or payload.get("description") or "",
                "widgets": properties.get("widgets") or payload.get("widgets") or [],
            }

        # Событие -> create_schedule_event
        if entity_type in {"event", "schedule_event", "calendar_event"}:
            event = properties if properties else payload
            return {
                "action": "create_schedule_event",
                "title": event.get("title") or event.get("name") or payload.get("title"),
                "start_at": event.get("start_at") or event.get("startAt") or payload.get("start_at"),
                "end_at": event.get("end_at") or event.get("endAt") or payload.get("end_at"),
                "description": event.get("description") or payload.get("description"),
            }
    return None


def _normalize_action_payload(payload: Any) -> dict[str, Any] | None:
    """Привести payload к одиночному валидному action-словарю.

    Args:
        payload: Объект, полученный после JSON-декодирования.

    Returns:
        Валидный action-словарь или None, если action не найден.
    """
    if isinstance(payload, dict):
        if str(payload.get("action") or "").strip():
            return payload
        legacy = _coerce_legacy_crm_action(payload)
        if legacy is not None and str(legacy.get("action") or "").strip():
            return legacy
    if isinstance(payload, list):
        actions = [x for x in payload if isinstance(x, dict) and str(x.get("action") or "").strip()]
        if not actions:
            legacy_actions: list[dict[str, Any]] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                coerced = _coerce_legacy_crm_action(item)
                if isinstance(coerced, dict) and str(coerced.get("action") or "").strip():
                    legacy_actions.append(coerced)
            actions = legacy_actions
        if not actions:
            return None
        action_names = {str(x.get("action") or "").strip() for x in actions}
        if action_names == {"create_schedule_event"}:
            events: list[dict[str, Any]] = []
            for item in actions:
                event = dict(item)
                event.pop("action", None)
                events.append(event)
            return {"action": "create_schedule_event", "events": events}
        # Fallback: если mixed actions, берем первое валидное.
        return actions[0]
    return None


def _find_action_json_array(text: str) -> tuple[dict[str, Any] | None, str]:
    """Найти в тексте JSON-массив, содержащий action-пейлоад.

    Args:
        text: Текст ответа модели.

    Returns:
        Кортеж `(payload, cleaned_text)`.
    """
    decoder = json.JSONDecoder()
    pos = 0
    while True:
        idx = text.find("[", pos)
        if idx == -1:
            return None, text
        try:
            obj, end = decoder.raw_decode(text[idx:])
            normalized = _normalize_action_payload(obj)
            if normalized is not None:
                cleaned = (text[:idx] + text[idx + end :]).strip()
                return normalized, cleaned
            pos = idx + max(1, end)
        except Exception:
            pos = idx + 1


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
            normalized = _normalize_action_payload(obj)
            if normalized is not None:
                cleaned = (text[:idx] + text[idx + end :]).strip()
                return normalized, cleaned
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
    if '"action"' in tail or "'action'" in tail or '"crm_action"' in tail or "'crm_action'" in tail:
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
    pattern = r"```crm_action\s*([\{\[][\s\S]*?[\}\]])\s*```"
    match = re.search(pattern, reply)
    if match:
        payload_raw = match.group(1)
        cleaned = re.sub(pattern, "", reply).strip()
        try:
            payload = _normalize_action_payload(json.loads(payload_raw))
            if payload is not None:
                return payload, cleaned
        except Exception:
            pass
        return None, cleaned
    payload_from_array, cleaned_from_array = _find_action_json_array(reply)
    if payload_from_array is not None:
        return payload_from_array, cleaned_from_array
    return _find_first_action_json(reply)
