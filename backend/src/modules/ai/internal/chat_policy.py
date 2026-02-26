"""Политики для AI-чата: эвристики контекста, action-режима и бюджета токенов."""

from __future__ import annotations

import re

from src.modules.ai.internal.intent_router import IntentDecision, interpret_user_intent


def looks_like_table_create_request(text: str) -> bool:
    """Проверить, похож ли текст на запрос создания таблицы."""
    t = (text or "").lower()
    return ("созд" in t and "таблиц" in t) or ("create" in t and "table" in t)


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
        except Exception:
            return None
        if 1 <= value <= 5000:
            return value
    return None


def looks_like_broken_action(reply_raw: str) -> bool:
    """Понять, содержит ли ответ признаки сломанного action-пейлоада."""
    text = (reply_raw or "").lower()
    return ("action" in text and "{" in text) or "crm_action" in text


def looks_like_action_request(text: str) -> bool:
    """Проверить, похоже ли сообщение на действие CRM."""
    decision = interpret_user_intent(text)
    return bool(decision.is_action)


def looks_like_context_query(text: str) -> bool:
    """Проверить, относится ли запрос к данным/контексту CRM."""
    decision = interpret_user_intent(text)
    return bool(decision.is_context_query)


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
    ui_intent: str | None,
    context_options: dict | None,
    user_message: str,
) -> bool:
    """Решить, нужно ли прикладывать контекст организации к запросу."""
    if not include_context:
        return False
    decision = build_intent_decision(user_message, ui_intent)
    if decision.is_action or decision.is_context_query:
        return True
    # Явный выбор источников в UI должен уважаться даже для коротких запросов.
    if has_selected_context(context_options):
        return True
    # Один ui_intent без текстового запроса на действие не должен принудительно
    # тянуть контекст (иначе в чате копится скрытый перерасход токенов).
    _ = ui_intent
    return False


def should_enable_action_mode(*, user_message: str, ui_intent: str | None) -> bool:
    """Определить, нужен ли тяжелый action-режим промпта."""
    decision = build_intent_decision(user_message, ui_intent)
    return bool(decision.is_action)


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
