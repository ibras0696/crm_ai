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

    async def usage_by_user(self, *, org_id: uuid.UUID) -> list[dict]:
        """Детализация использования AI по пользователям организации.

        Args:
            org_id: ID организации.

        Returns:
            Список словарей: user_id, requests, tokens.
        """
        rows = (
            await self.session.execute(
                select(
                    AIUsageLog.user_id,
                    func.count(AIUsageLog.id).label("requests"),
                    func.sum(AIUsageLog.total_tokens).label("tokens"),
                )
                .where(AIUsageLog.org_id == org_id)
                .group_by(AIUsageLog.user_id)
                .order_by(func.sum(AIUsageLog.total_tokens).desc())
            )
        ).all()
        return [{"user_id": str(r.user_id), "requests": int(r.requests or 0), "tokens": int(r.tokens or 0)} for r in rows]

    async def list_sessions_with_last_preview(self, *, org_id: uuid.UUID, user_id: uuid.UUID) -> list[dict]:
        """Список сессий + превью последнего сообщения (без N+1).

        Args:
            org_id: ID организации.
            user_id: ID пользователя.

        Returns:
            Список словарей, совместимых с ChatSessionOut.
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
        )
        rows = (await self.session.execute(stmt)).all()
        items: list[dict] = []
        for r in rows:
            last_preview = None
            if r.last_content:
                last_preview = str(r.last_content)[:80]
            items.append(
                {
                    "id": str(r.id),
                    "title": r.title,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                    "last_message_preview": last_preview,
                }
            )
        return items

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

    async def list_messages(self, *, session_id: uuid.UUID) -> list[AIChatMessage]:
        """Список сообщений сессии.

        Args:
            session_id: ID сессии.

        Returns:
            Список AIChatMessage по возрастанию created_at.
        """
        return list(
            (
                await self.session.execute(
                    select(AIChatMessage).where(AIChatMessage.session_id == session_id).order_by(AIChatMessage.created_at.asc())
                )
            )
            .scalars()
            .all()
        )

    async def context_sources(self, *, org_id: uuid.UUID) -> dict:
        """Получить источники контекста для UI.

        Args:
            org_id: ID организации.

        Returns:
            Словарь со списками kb_pages/tables/schedule_events.
        """
        kb_pages = (
            await self.session.execute(
                select(KBPage)
                .where(KBPage.org_id == org_id, KBPage.is_published.is_(True))
                .order_by(KBPage.position.asc())
                .limit(300)
            )
        ).scalars().all()
        tables = (
            await self.session.execute(
                select(Table)
                .where(Table.org_id == org_id, Table.is_archived.is_(False))
                .options(selectinload(Table.columns))
                .order_by(Table.created_at.desc())
                .limit(200)
            )
        ).scalars().all()
        schedule_events = (
            await self.session.execute(
                select(Event)
                .where(Event.org_id == org_id)
                .order_by(Event.start_at.desc())
                .limit(300)
            )
        ).scalars().all()

        return {
            "kb_pages": [{"id": str(p.id), "title": p.title} for p in kb_pages],
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
