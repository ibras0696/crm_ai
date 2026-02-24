from __future__ import annotations

"""Сервисные функции для AI API (тонкий слой поверх репозитория).

Здесь нет SQL. Этот слой собирает данные в структуры, удобные для API/интерфейса.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.limits import is_org_ai_enabled, resolve_org_plan, resolve_plan_limits
from src.modules.ai.models import AIChatMessage
from src.modules.ai.repository import AIRepository
from src.modules.billing.token_wallet import get_token_balance_view
from src.modules.ai.service import build_messages, build_org_context_for_user, estimate_tokens

logger = logging.getLogger(__name__)


async def build_ai_status(*, org_id: uuid.UUID) -> dict[str, Any]:
    """Собрать статус AI и статистику использования (для UI).

    Args:
        org_id: ID организации.

    Returns:
        Словарь со статусом включенности, наличием credentials, планом, статистикой и лимитами.
    """
    credentials_present = bool(settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY)
    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            org_ai_enabled = await is_org_ai_enabled(uow.session, org_id=org_id)
            plan_tier = await resolve_org_plan(uow.session, org_id=org_id)
            plan = plan_tier.value
            plan_db = await repo.get_active_plan(name=plan)

            total = await repo.usage_stats(org_id=org_id)
            today = await repo.usage_stats(org_id=org_id, since=day_start)
            wallet = await get_token_balance_view(uow.session, org_id=org_id)
    except Exception as exc:
        logger.exception("ai_build_status_failed", exc_info=exc)
        raise

    limits = resolve_plan_limits(plan_tier, plan_db)

    return {
        "enabled": bool(settings.ENABLE_AI and org_ai_enabled),
        "global_ai_enabled": bool(settings.ENABLE_AI),
        "org_ai_enabled": bool(org_ai_enabled),
        "effective_ai_enabled": bool(settings.ENABLE_AI and org_ai_enabled),
        # Сохраняем прежний ключ для обратной совместимости фронта.
        "configured": credentials_present,
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
            "daily_tokens": int(limits["daily_tokens"]),
            "rpm_per_user": int(limits["rpm_per_user"]),
            "max_tokens_per_request": int(limits["max_tokens_per_request"]),
        },
        "token_wallet": wallet,
    }


async def build_ai_usage_by_user(*, org_id: uuid.UUID) -> list[dict[str, Any]]:
    """Детализация использования AI по пользователям организации.

    Args:
        org_id: ID организации.

    Returns:
        Список словарей: user_id, requests, tokens.
    """
    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            rows = await repo.usage_by_user(org_id=org_id)
            return [
                {"user_id": str(user_id) if user_id is not None else None, "requests": reqs, "tokens": tokens}
                for user_id, reqs, tokens in rows
            ]
    except Exception as exc:
        logger.exception("ai_build_usage_by_user_failed", exc_info=exc)
        raise


async def build_chat_sessions(*, org_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int) -> list[dict[str, Any]]:
    """Получить список чат-сессий пользователя с превью последнего сообщения.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        limit: Лимит количества сессий.
        offset: Смещение.

    Returns:
        Список словарей с данными ChatSessionOut.
    """
    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            rows = await repo.list_sessions_with_last_preview(org_id=org_id, user_id=user_id, limit=limit, offset=offset)
            return [
                {
                    "id": str(session_id),
                    "title": title,
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "last_message_preview": (str(last_content)[:80] if last_content else None),
                }
                for session_id, title, created_at, updated_at, last_content in rows
            ]
    except Exception as exc:
        logger.exception("ai_build_chat_sessions_failed", exc_info=exc)
        raise


async def create_chat_session(*, org_id: uuid.UUID, user_id: uuid.UUID, title: str) -> dict[str, Any]:
    """Создать чат-сессию.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        title: Заголовок сессии.

    Returns:
        Словарь с данными ChatSessionOut.
    """
    try:
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
    except Exception as exc:
        logger.exception("ai_create_chat_session_failed", exc_info=exc)
        raise


async def delete_chat_session(*, org_id: uuid.UUID, user_id: uuid.UUID, chat_id: uuid.UUID) -> bool:
    """Удалить чат-сессию пользователя (с проверкой org/user).

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        chat_id: ID сессии.

    Returns:
        True если удалили, иначе False.
    """
    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            session = await repo.get_session(org_id=org_id, user_id=user_id, session_id=chat_id)
            if not session:
                return False
            await repo.delete_session(session)
            await uow.commit()
            return True
    except Exception as exc:
        logger.exception("ai_delete_chat_session_failed", exc_info=exc)
        raise


async def build_chat_messages(
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
    limit: int,
    offset: int,
) -> list[AIChatMessage] | None:
    """Получить список сообщений чата.

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        chat_id: ID сессии.
        limit: Лимит количества сообщений.
        offset: Смещение.

    Returns:
        Список сообщений или None, если сессия не найдена/не принадлежит пользователю.
    """
    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            session = await repo.get_session(org_id=org_id, user_id=user_id, session_id=chat_id)
            if not session:
                return None
            return await repo.list_messages(
                org_id=org_id,
                user_id=user_id,
                session_id=chat_id,
                limit=limit,
                offset=offset,
            )
    except Exception as exc:
        logger.exception("ai_build_chat_messages_failed", exc_info=exc)
        raise


async def build_context_estimate(
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    include_context: bool,
    context_options: dict | None,
    system_prompt: str | None,
    history: list[dict[str, str]],
    user_message: str | None,
) -> dict[str, Any]:
    """Оценить контекст и стоимость prompt (эвристика).

    Args:
        org_id: ID организации.
        user_id: ID пользователя.
        include_context: Флаг включения контекста.
        context_options: Опции контекста.
        system_prompt: Пользовательский системный промпт (опционально).
        history: История сообщений в формате role/content.
        user_message: Текущее сообщение пользователя.

    Returns:
        Словарь с оценкой токенов и источников контекста.
    """
    if not include_context:
        return {
            "enabled": False,
            "sources": {
                "kb": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                "table_schema": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                "table_records": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                "schedule": {"enabled": False, "chars": 0, "estimated_tokens": 0},
            },
            "selected": {"kb_pages": [], "tables": [], "schedule_events": []},
            "model_overhead_tokens": 0,
            "max_context_tokens": 0,
            "used_context_tokens": 0,
            "context_truncated": False,
            "estimated_prompt_tokens": 0,
            "prompt_message_overhead_tokens": 0,
            "estimated_total_tokens": 0,
        }

    org_context, meta = await build_org_context_for_user(org_id, user_id, context_options)
    effective_system_prompt = system_prompt or settings.AI_SYSTEM_PROMPT
    safe_user_message = user_message or ""
    safe_history = (history or [])[-10:]

    prompt_messages = build_messages(
        effective_system_prompt,
        org_context,
        db_messages=[],
        history=safe_history,
        user_message=safe_user_message,
    )
    message_overhead = 4 * len(prompt_messages) + 2
    content_joined = "\n".join((m.get("content") or "") for m in prompt_messages)
    estimated_prompt_tokens = estimate_tokens(content_joined) + message_overhead

    meta["prompt_message_overhead_tokens"] = int(message_overhead)
    meta["estimated_prompt_tokens"] = int(estimated_prompt_tokens)
    meta["estimated_total_tokens"] = int(estimated_prompt_tokens)
    return meta


async def build_context_sources(*, org_id: uuid.UUID) -> dict[str, Any]:
    """Список доступных источников контекста (KB/таблицы/расписание) для UI.

    Args:
        org_id: ID организации.

    Returns:
        Словарь со списками kb_pages/tables/schedule_events.
    """
    try:
        async with UnitOfWork() as uow:
            repo = AIRepository(uow.session)
            kb_pages = await repo.list_kb_pages(org_id=org_id, limit=300)
            tables = await repo.list_tables_with_columns(org_id=org_id, limit=200)
            schedule_events = await repo.list_schedule_events(org_id=org_id, limit=100)
            return {
                "kb_pages": [{"id": str(p.id), "title": p.title, "parent_id": str(p.parent_id) if p.parent_id else None} for p in kb_pages],
                "tables": [
                    {
                        "id": str(t.id),
                        "name": t.name,
                        "columns": [{"id": str(c.id), "name": c.name} for c in sorted(t.columns, key=lambda x: x.position)],
                    }
                    for t in tables
                ],
                "schedule_events": [
                    {
                        "id": str(ev.id),
                        "title": ev.title,
                        "start_at": ev.start_at.isoformat() if ev.start_at else None,
                        "recurrence": ev.recurrence,
                    }
                    for ev in schedule_events
                ],
            }
    except Exception as exc:
        logger.exception("ai_build_context_sources_failed", exc_info=exc)
        raise
