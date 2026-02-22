from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.billing.models import Plan
from src.modules.knowledge.models import KBPage
from src.modules.schedule.models import Event
from src.modules.tables.models import Table


class AIRepository:
    """Репозиторий AI: только запросы к БД, без бизнес-логики.

    Правило: никаких бизнес-решений (например, "какой тариф эффективный") и никакой
    сетевой логики. Только чтение/запись БД.
    """

    def __init__(self, session: AsyncSession):
        """Создать репозиторий для работы с AI-данными.

        Args:
            session: AsyncSession SQLAlchemy для выполнения запросов.

        Returns:
            None.
        """
        self.session = session

    async def get_active_plan(self, *, name: str) -> Plan | None:
        """Получить активный тариф из БД по имени.

        Args:
            name: Имя тарифа (например, "free", "team", "business").

        Returns:
            Объект Plan или None.
        """
        return (
            (await self.session.execute(select(Plan).where(Plan.name == name, Plan.is_active.is_(True))))
            .scalars()
            .first()
        )

    async def usage_stats(self, *, org_id: uuid.UUID, since: datetime | None = None) -> tuple[int, int, int, int]:
        """Агрегаты использования AI по организации.

        Args:
            org_id: ID организации.
            since: Если задано, учитываем логи только начиная с этого времени.

        Returns:
            Кортеж: (requests, total_tokens, prompt_tokens, completion_tokens).
        """
        stmt = select(
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
        ).where(AIUsageLog.org_id == org_id)
        if since is not None:
            stmt = stmt.where(AIUsageLog.created_at >= since)
        row = (await self.session.execute(stmt)).one()
        return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0), int(row[3] or 0)

    async def usage_by_user(self, *, org_id: uuid.UUID) -> list[tuple[uuid.UUID | None, int, int]]:
        """Детализация использования AI по пользователям организации.

        Args:
            org_id: ID организации.

        Returns:
            Список кортежей: (user_id, requests, tokens).
        """
        rows = (
            await self.session.execute(
                select(
                    AIUsageLog.user_id,
                    func.count(AIUsageLog.id).label("requests"),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0).label("tokens"),
                )
                .where(AIUsageLog.org_id == org_id)
                .group_by(AIUsageLog.user_id)
                .order_by(func.sum(AIUsageLog.total_tokens).desc())
            )
        ).all()
        return [(r.user_id, int(r.requests or 0), int(r.tokens or 0)) for r in rows]

    async def list_sessions_with_last_preview(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> list[tuple[uuid.UUID, str, datetime, datetime, str | None]]:
        """Список сессий + превью последнего сообщения (без N+1).

        Args:
            org_id: ID организации.
            user_id: ID пользователя.
            limit: Лимит количества сессий.
            offset: Смещение.

        Returns:
            Список кортежей:
            (session_id, title, created_at, updated_at, last_content).
        """
        last_content_sq = (
            select(AIChatMessage.content)
            .where(AIChatMessage.session_id == AIChatSession.id)
            .order_by(AIChatMessage.created_at.desc())
            .limit(1)
            .scalar_subquery()
        )
        stmt = (
            select(
                AIChatSession.id,
                AIChatSession.title,
                AIChatSession.created_at,
                AIChatSession.updated_at,
                last_content_sq.label("last_content"),
            )
            .where(AIChatSession.org_id == org_id, AIChatSession.user_id == user_id)
            .order_by(AIChatSession.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        rows = (await self.session.execute(stmt)).all()
        return [(r.id, r.title, r.created_at, r.updated_at, r.last_content) for r in rows]

    async def create_session(self, *, org_id: uuid.UUID, user_id: uuid.UUID, title: str) -> AIChatSession:
        """Создать AIChatSession.

        Args:
            org_id: ID организации.
            user_id: ID пользователя.
            title: Заголовок.

        Returns:
            Созданный объект AIChatSession (уже с id после flush).
        """
        session = AIChatSession(org_id=org_id, user_id=user_id, title=title)
        self.session.add(session)
        await self.session.flush()
        return session

    async def get_session(self, *, org_id: uuid.UUID, user_id: uuid.UUID, session_id: uuid.UUID) -> AIChatSession | None:
        """Получить сессию по id, проверив принадлежность org/user.

        Args:
            org_id: ID организации.
            user_id: ID пользователя.
            session_id: ID сессии.

        Returns:
            AIChatSession или None.
        """
        return (
            (
                await self.session.execute(
                    select(AIChatSession).where(
                        AIChatSession.id == session_id,
                        AIChatSession.org_id == org_id,
                        AIChatSession.user_id == user_id,
                    )
                )
            )
            .scalars()
            .first()
        )

    async def delete_session(self, session: AIChatSession) -> None:
        """Удалить сессию (сообщения удалятся каскадно).

        Args:
            session: Объект AIChatSession.

        Returns:
            None
        """
        await self.session.delete(session)

    async def list_messages(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        session_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> list[AIChatMessage]:
        """Список сообщений сессии.

        Args:
            org_id: ID организации (ownership check).
            user_id: ID пользователя (ownership check).
            session_id: ID сессии.
            limit: Лимит количества сообщений.
            offset: Смещение.

        Returns:
            Список AIChatMessage по возрастанию created_at.
        """
        # Дополнительная защита в самом репозитории: проверяем принадлежность чата
        # пользователю/организации на уровне SQL.
        return list(
            (
                await self.session.execute(
                    select(AIChatMessage)
                    .join(AIChatSession, AIChatSession.id == AIChatMessage.session_id)
                    .where(
                        AIChatMessage.session_id == session_id,
                        AIChatSession.org_id == org_id,
                        AIChatSession.user_id == user_id,
                    )
                    .order_by(AIChatMessage.created_at.asc())
                    .offset(offset)
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    async def list_kb_pages(self, *, org_id: uuid.UUID, limit: int = 300) -> list[KBPage]:
        """Получить опубликованные страницы базы знаний.

        Args:
            org_id: ID организации.
            limit: Лимит количества страниц.

        Returns:
            Список моделей KBPage.
        """
        return (
            await self.session.execute(
                select(KBPage)
                .where(KBPage.org_id == org_id, KBPage.is_published.is_(True))
                .order_by(KBPage.position.asc())
                .limit(limit)
            )
        ).scalars().all()

    async def list_tables_with_columns(self, *, org_id: uuid.UUID, limit: int = 200) -> list[Table]:
        """Получить таблицы организации вместе с колонками.

        Args:
            org_id: ID организации.
            limit: Лимит количества таблиц.

        Returns:
            Список моделей Table с предзагруженными columns.
        """
        return (
            await self.session.execute(
                select(Table)
                .where(Table.org_id == org_id, Table.is_archived.is_(False))
                .options(selectinload(Table.columns))
                .order_by(Table.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()

    async def list_schedule_events(self, *, org_id: uuid.UUID, limit: int = 100) -> list[Event]:
        """Получить события расписания организации.

        Args:
            org_id: ID организации.
            limit: Лимит количества событий.

        Returns:
            Список моделей Event.
        """
        return (
            await self.session.execute(
                select(Event)
                .where(Event.org_id == org_id)
                .order_by(Event.start_at.desc())
                .limit(limit)
            )
        ).scalars().all()
