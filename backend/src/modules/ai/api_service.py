from __future__ import annotations

"""Сервисные функции для AI API (тонкий слой поверх репозитория).

Здесь нет SQL. Этот файл предназначен для сборки данных из БД в удобные структуры,
которые использует API/интерфейс.
"""

from datetime import datetime, timezone

from src.common.enums import PlanTier
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.limits import resolve_org_plan
from src.modules.ai.repository import AIRepository


async def build_ai_status(*, org_id):
    """Собрать статус AI и статистику использования (для UI).

    Args:
        org_id: ID организации.

    Returns:
        Словарь со статусом включенности, конфигурацией, планом, статистикой и лимитами.
    """
    configured = bool(settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY)
    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        plan_tier = await resolve_org_plan(uow.session, org_id=org_id)
        plan = plan_tier.value
        plan_db = await repo.get_active_plan(name=plan)

        total = await repo.usage_stats(org_id=org_id)
        today = await repo.usage_stats(org_id=org_id, since=day_start)

    daily_limit_by_plan = {
        PlanTier.FREE.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        PlanTier.TEAM.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        PlanTier.BUSINESS.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
    }
    rpm_limit_by_plan = {
        PlanTier.FREE.value: int(getattr(settings, "AI_RPM_PER_USER_FREE", 0) or 0),
        PlanTier.TEAM.value: int(getattr(settings, "AI_RPM_PER_USER_TEAM", 0) or 0),
        PlanTier.BUSINESS.value: int(getattr(settings, "AI_RPM_PER_USER_BUSINESS", 0) or 0),
    }
    daily_limit = daily_limit_by_plan.get(plan) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0)
    rpm_limit = rpm_limit_by_plan.get(plan) or int(settings.AI_RPM_PER_USER or 0)

    # Если лимиты доступны в БД (таблица plans), используем их как источник правды.
    if plan_db:
        if int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
            daily_limit = int(plan_db.ai_tokens_per_day)
        if int(getattr(plan_db, "ai_rpm_per_user", 0) or 0) > 0:
            rpm_limit = int(plan_db.ai_rpm_per_user)
        max_tokens_per_req = int(getattr(plan_db, "ai_max_tokens_per_request", 0) or 0) or int(settings.AI_MAX_TOKENS_PER_REQUEST)
    else:
        max_tokens_per_req = int(settings.AI_MAX_TOKENS_PER_REQUEST)

    return {
        "enabled": bool(settings.ENABLE_AI),
        "configured": configured,
        "plan": plan,
        "stats": {
            "total_requests": total[0],
            "total_tokens": total[1],
            "prompt_tokens": total[2],
            "completion_tokens": total[3],
        },
        "today": {
            "requests": today[0],
            "total_tokens": today[1],
            "prompt_tokens": today[2],
            "completion_tokens": today[3],
        },
        "limits": {
            "daily_tokens": int(daily_limit),
            "rpm_per_user": int(rpm_limit),
            "max_tokens_per_request": int(max_tokens_per_req),
        },
    }


async def build_ai_usage_by_user(*, org_id):
    """Детализация использования AI по пользователям организации.

    Args:
        org_id: ID организации.

    Returns:
        Список словарей: user_id, requests, tokens.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        return await repo.usage_by_user(org_id=org_id)


async def build_chat_sessions(*, org_id, user_id):
    """Получить список чат-сессий пользователя с превью последнего сообщения.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.

    Returns:
        Список словарей с данными ChatSessionOut.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        return await repo.list_sessions_with_last_preview(org_id=org_id, user_id=user_id)


async def create_chat_session(*, org_id, user_id, title: str):
    """Создать чат-сессию.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        title: Заголовок сессии.

    Returns:
        Словарь с данными ChatSessionOut.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        session = await repo.create_session(org_id=org_id, user_id=user_id, title=title)
        await uow.commit()
        return {
            "id": str(session.id),
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "last_message_preview": None,
        }


async def delete_chat_session(*, org_id, user_id, chat_id):
    """Удалить чат-сессию пользователя (с проверкой org/user).

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        chat_id: ID сессии.

    Returns:
        True если удалили, иначе False.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        session = await repo.get_session(org_id=org_id, user_id=user_id, session_id=chat_id)
        if not session:
            return False
        await repo.delete_session(session)
        await uow.commit()
        return True


async def build_chat_messages(*, org_id, user_id, chat_id):
    """Получить список сообщений чата.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        chat_id: ID сессии.

    Returns:
        Список сообщений или None, если сессия не найдена/не принадлежит пользователю.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        session = await repo.get_session(org_id=org_id, user_id=user_id, session_id=chat_id)
        if not session:
            return None
        msgs = await repo.list_messages(session_id=chat_id)
        return msgs


async def build_context_sources(*, org_id):
    """Список доступных источников контекста (KB/таблицы/расписание) для UI.

    Args:
        org_id: ID организации.

    Returns:
        Словарь со списками kb_pages/tables/schedule_events.
    """
    async with UnitOfWork() as uow:
        repo = AIRepository(uow.session)
        return await repo.context_sources(org_id=org_id)

