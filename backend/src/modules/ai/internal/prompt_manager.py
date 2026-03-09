"""Менеджер системных промптов для разных ходов диалога."""

from __future__ import annotations

from src.modules.ai.internal.intent_router import IntentDecision


def _clip_text(text: str, limit: int) -> str:
    """Обрезать длинный текст промпта до безопасного размера."""
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 80)].rstrip() + "\n\n[...сокращено для компактного режима...]"


def _tools_hint_for_domain(domain: str) -> str:
    """Вернуть краткий список инструментов по домену запроса."""
    if domain == "table":
        return (
            "- Таблицы: create_table, create_columns, create_records.\n"
            "- Для чтения/аналитики таблиц не добавляй crm_action."
        )
    if domain == "dashboard":
        return (
            "- Дашборды: create_dashboard.\n"
            "- Не модифицируй таблицы, если пользователь просит только отчет/дашборд."
        )
    if domain == "schedule":
        return (
            "- Расписание: create_schedule_event.\n"
            "- Для просмотра расписания не добавляй crm_action."
        )
    if domain == "knowledge":
        return (
            "- База знаний: create_kb_page.\n"
            "- Для чтения/поиска по KB не добавляй crm_action."
        )
    if domain == "document":
        return (
            "- Документы: create_document.\n"
            "- Для анализа уже существующих документов не добавляй crm_action."
        )
    return (
        "- Если пользователь явно просит изменение сущностей CRM, добавь один crm_action.\n"
        "- Если явного запроса на изменение нет, отвечай без crm_action."
    )


def build_turn_system_prompt(
    *,
    base_system_prompt: str,
    first_turn: bool,
    action_mode: bool,
    intent_decision: IntentDecision,
    has_selected_context: bool,
) -> str:
    """Построить system prompt для текущего хода.

    Первый ход:
    - возвращаем полный промпт (он задает полный контракт чата).

    Последующие ходы:
    - возвращаем компактную версию с ключевыми правилами и инструментами.
    """
    # Для action-запросов всегда даем полный промпт:
    # модель должна видеть полный контракт инструментов.
    if first_turn or action_mode:
        return str(base_system_prompt or "").strip()

    base_compact = _clip_text(base_system_prompt, 900)
    context_hint = (
        "- Пользователь выбрал контекст в UI: используй его как источник истины.\n"
        if has_selected_context
        else ""
    )
    return (
        f"{base_compact}\n\n"
        "КОМПАКТНЫЙ РЕЖИМ (продолжение чата):\n"
        "- Сохраняй ответ коротким и по делу.\n"
        "- Не придумывай данные, опирайся на фактический контекст.\n"
        f"{context_hint}"
        f"{_tools_hint_for_domain(intent_decision.domain)}"
    ).strip()
