"""Политики для AI-чата: эвристики контекста, action-режима и бюджета токенов."""

from __future__ import annotations

import re

from src.modules.ai.internal.intent_router import IntentDecision, interpret_user_intent


def looks_like_table_create_request(text: str) -> bool:
    """Проверить, похож ли текст на запрос создания таблицы."""
    t = (text or "").lower()
    return ("созд" in t and "таблиц" in t) or ("create" in t and "table" in t)


_ACTION_TO_DOMAIN = {
    "create_table": "table",
    "create_columns": "table",
    "create_records": "table",
    "create_dashboard": "dashboard",
    "create_schedule_event": "schedule",
    "create_kb_page": "knowledge",
    "edit_kb_page": "knowledge",
    "create_document": "document",
}

_UI_INTENT_TO_DOMAIN = {
    "create_table": "table",
    "create_columns": "table",
    "create_records": "table",
    "create_dashboard": "dashboard",
    "create_schedule_event": "schedule",
    "create_kb_page": "knowledge",
    "create_document": "document",
}

_CONTINUE_ACTION_MARKERS = (
    "продолж",
    "continue",
    "дальше",
    "далее",
)

_NEGATED_DOMAIN_MARKERS = {
    "table": ("таблиц", "table"),
    "schedule": ("расписан", "календар", "schedule", "calendar"),
    "knowledge": ("база знаний", "kb", "wiki", "knowledge"),
    "dashboard": ("дашборд", "график", "dashboard", "chart"),
    "document": ("документ", "docx", "pdf", "document", "file"),
}


def infer_action_domain(action_payload: dict | None) -> str | None:
    """Определить домен действия по имени action."""
    if not isinstance(action_payload, dict):
        return None
    action_name = str(action_payload.get("action") or "").strip().lower()
    return _ACTION_TO_DOMAIN.get(action_name)


def _looks_like_action_continuation(text: str) -> bool:
    t = (text or "").lower()
    return any(marker in t for marker in _CONTINUE_ACTION_MARKERS)


def _domain_is_negated_in_message(text: str, domain: str) -> bool:
    markers = _NEGATED_DOMAIN_MARKERS.get(domain, ())
    lowered = (text or "").lower()
    for marker in markers:
        escaped = re.escape(marker)
        if " " in marker:
            pattern = rf"(?:^|[\s,;:()])(?:не|not|without)\s+{escaped}"
        else:
            pattern = rf"(?:^|[\s,;:()])(?:не|not|without)\s+\w*{escaped}\w*"
        if re.search(pattern, lowered):
            return True
    return False


def reject_action_reason(
    *,
    action_payload: dict | None,
    user_message: str,
    intent_decision: IntentDecision,
    ui_intent: str | None,
) -> str | None:
    """Вернуть причину, по которой action нельзя исполнять, или None."""
    action_domain = infer_action_domain(action_payload)
    if not action_domain:
        return None

    if _domain_is_negated_in_message(user_message, action_domain):
        return "domain_negated_by_user"

    ui_domain = _UI_INTENT_TO_DOMAIN.get(str(ui_intent or "").strip().lower())
    if ui_domain and ui_domain != action_domain:
        return "ui_intent_domain_mismatch"

    explicit_action_requested = bool(
        intent_decision.is_action or ui_domain or _looks_like_action_continuation(user_message)
    )
    if not explicit_action_requested:
        return "action_not_requested"

    if (
        intent_decision.domain != "general"
        and intent_decision.mode in {"create", "update", "delete"}
        and intent_decision.domain != action_domain
    ):
        return "intent_domain_mismatch"

    return None


def extract_requested_record_count(text: str) -> int | None:
    """Извлечь запрошенное количество записей из текста пользователя."""
    t = (text or "").lower()
    patterns = [
        r"(\d{1,5})\s*(?:запис(?:ей|и|ь)|строк(?:и)?|слов(?:а)?)",
        r"(?:на|с)\s*(\d{1,5})\s*(?:запис(?:ей|и|ь)|строк(?:и)?|слов(?:а)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, t)
        if not match:
            continue
        try:
            value = int(match.group(1))
        except (TypeError, ValueError):
            return None
        if 1 <= value <= 5000:
            return value
    return None


def looks_like_broken_action(reply_raw: str) -> bool:
    """Понять, содержит ли ответ признаки сломанного action-пейлоада."""
    text = (reply_raw or "").lower()
    return ("action" in text and "{" in text) or "crm_action" in text


def build_intent_decision(user_message: str, ui_intent: str | None) -> IntentDecision:
    """Построить нормализованное решение intent-роутера."""
    return interpret_user_intent(user_message, ui_intent=ui_intent)


def has_selected_context(context_options: dict | None) -> bool:
    """Проверить, выбрал ли пользователь объекты контекста в UI."""
    opts = context_options if isinstance(context_options, dict) else {}
    selected_tables = opts.get("selected_table_ids") or []
    selected_kb = opts.get("selected_kb_page_ids") or []
    selected_schedule = opts.get("selected_schedule_event_ids") or []
    return bool(selected_tables or selected_kb or selected_schedule)


def should_attach_context(
    *,
    include_context: bool,
    context_options: dict | None,
    intent_decision: IntentDecision,
) -> bool:
    """Решить, нужно ли прикладывать контекст организации к запросу."""
    if not include_context:
        return False
    if intent_decision.is_action or intent_decision.is_context_query:
        return True
    # Явный выбор источников в UI должен уважаться даже для коротких запросов.
    return has_selected_context(context_options)


def resolve_provider_max_tokens(
    *,
    max_tokens_per_request: int,
    action_mode: bool,
    requested_records_target: int | None,
    is_table_create_request: bool,
) -> int:
    """Рассчитать верхнюю границу completion токенов для провайдера."""
    limit = max(256, int(max_tokens_per_request))
    # Для обычного диалога жестко срезаем budget.
    provider_max_tokens = min(limit, 900) if not action_mode else limit
    if requested_records_target and is_table_create_request:
        desired = 1200 + int(requested_records_target * 18)
        provider_max_tokens = max(provider_max_tokens, min(limit, min(6000, desired)))
    return max(256, int(provider_max_tokens))
