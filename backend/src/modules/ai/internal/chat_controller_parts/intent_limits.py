from __future__ import annotations

"""Проверки и подсказки лимитов тарифа для action-intent в AI-чате."""

import uuid

from src.infrastructure.uow import UnitOfWork
from src.modules.ai.internal.repository import AIRepository


async def _load_action_limits(uow: UnitOfWork, *, org_id: uuid.UUID) -> dict[str, int]:
    """Загрузить текущие лимиты и фактическое потребление по сущностям.

    Args:
        uow: UnitOfWork с доступом к БД.
        org_id: ID организации.

    Returns:
        Словарь с лимитами и текущими счетчиками (tables/records/kb pages).
    """
    repo = AIRepository(uow.session)
    plan = await repo.resolve_effective_plan(org_id=org_id)
    max_tables = int(getattr(plan, "max_tables", 0) or 0)
    max_records = int(getattr(plan, "max_records", 0) or 0)
    current_tables = await repo.count_tables(org_id=org_id)
    current_records = await repo.count_records(org_id=org_id)
    current_kb_pages = await repo.count_kb_pages(org_id=org_id)
    return {
        "max_tables": max_tables,
        "max_records": max_records,
        "current_tables": current_tables,
        "current_records": current_records,
        "current_kb_pages": current_kb_pages,
    }


def _build_limits_hint(intent: str, limits: dict[str, int]) -> str:
    """Сформировать текстовую подсказку модели о тарифных ограничениях.

    Args:
        intent: UI intent (`create_table` или `create_kb_page`).
        limits: Словарь лимитов и текущего потребления.

    Returns:
        Текст подсказки для system prompt.
    """
    max_tables = int(limits.get("max_tables", 0))
    max_records = int(limits.get("max_records", 0))
    cur_tables = int(limits.get("current_tables", 0))
    cur_records = int(limits.get("current_records", 0))
    cur_kb = int(limits.get("current_kb_pages", 0))
    remain_tables = max(0, max_tables - cur_tables) if max_tables > 0 else -1
    remain_records = max(0, max_records - cur_records) if max_records > 0 else -1
    remain_kb = max(0, max_records - cur_kb) if max_records > 0 else -1
    if intent == "create_table":
        return (
            "\n\nОграничения тарифа (актуальные):\n"
            + f"- Таблицы: {cur_tables}/{max_tables if max_tables > 0 else 'без лимита'}"
            + (f" (осталось {remain_tables})\n" if max_tables > 0 else "\n")
            + f"- Записи в организации: {cur_records}/{max_records if max_records > 0 else 'без лимита'}"
            + (f" (осталось {remain_records})\n" if max_records > 0 else "\n")
            + "Если лимит = 0, не предлагай создание. Сразу объясни, что достигнут лимит."
        )
    if intent == "create_kb_page":
        return (
            "\n\nОграничения тарифа (актуальные):\n"
            + f"- Страницы базы знаний: {cur_kb}/{max_records if max_records > 0 else 'без лимита'}"
            + (f" (осталось {remain_kb})\n" if max_records > 0 else "\n")
            + "Если лимит = 0, не предлагай создание. Сразу объясни, что достигнут лимит."
        )
    return ""


def _intent_limit_error(intent: str, limits: dict[str, int]) -> dict | None:
    """Проверить, достигнут ли лимит для конкретного intent.

    Args:
        intent: Имя intent.
        limits: Лимиты и текущие счетчики.

    Returns:
        Словарь ошибки лимита или None, если лимит не достигнут.
    """
    max_tables = int(limits.get("max_tables", 0))
    max_records = int(limits.get("max_records", 0))
    cur_tables = int(limits.get("current_tables", 0))
    cur_records = int(limits.get("current_records", 0))
    cur_kb = int(limits.get("current_kb_pages", 0))
    if intent == "create_table" and max_tables > 0 and cur_tables >= max_tables:
        return {"code": "TABLE_LIMIT_REACHED", "message": "Достигнут лимит тарифа по таблицам."}
    if intent == "create_table" and max_records > 0 and cur_records >= max_records:
        return {"code": "RECORD_LIMIT_REACHED", "message": "Достигнут лимит тарифа по записям."}
    if intent == "create_kb_page" and max_records > 0 and cur_kb >= max_records:
        return {"code": "KNOWLEDGE_LIMIT_REACHED", "message": "Достигнут лимит тарифа по записям базы знаний."}
    return None
