"""Сервис работы с AI-чат сессиями.

В модуле размещена бизнес-логика создания/поиска сессии.
Запросы к БД выполняются через `AIRepository`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from src.modules.ai.internal.repository import AIRepository

if TYPE_CHECKING:
    import uuid

    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.models import AIChatSession

logger = logging.getLogger(__name__)


async def get_or_create_session(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    chat_id: str | None,
    first_message: str,
) -> AIChatSession:
    """Получить существующую сессию пользователя или создать новую.

    Args:
        uow: UnitOfWork с активной сессией БД.
        org_id: ID организации.
        user_id: ID пользователя.
        chat_id: ID существующей сессии (может быть None).
        first_message: Первое сообщение для генерации заголовка новой сессии.

    Returns:
        Объект `AIChatSession`, существующий или только что созданный.
    """
    repo = AIRepository(uow.session)
    try:
        existing = await repo.get_session_for_user_by_chat_id(
            org_id=org_id,
            user_id=user_id,
            chat_id=chat_id,
        )
        if existing is not None:
            return existing
    except Exception as exc:
        logger.warning("ai_get_session_failed_fallback_to_new", exc_info=exc)

    title = (first_message or "Новый чат").strip()[:80] or "Новый чат"
    return await repo.create_session(org_id=org_id, user_id=user_id, title=title)
