from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.common.enums import SubscriptionStatus
from src.modules.ai.models import (
    AIChatMessage,
    AIChatSession,
    AIRuntimeAudit,
    AIRuntimeSecret,
    AIRuntimeSettings,
    AIUsageLog,
)
from src.modules.auth.models import User
from src.modules.billing.models import Plan
from src.modules.knowledge.models import KBPage
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.schedule.models import Event
from src.modules.tables.models import Table
from src.modules.tables.records import Record


class AIRepository:
    """Репозиторий AI: только запросы к БД"""

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

    async def resolve_effective_plan_name(self, *, org_id: uuid.UUID) -> str:
        """Определить эффективный тариф организации.

        Приоритет:
        1) активная/просроченная подписка,
        2) поле `Organization.plan`,
        3) fallback `free`.

        Args:
            org_id: ID организации.

        Returns:
            Имя тарифа в нижнем регистре.
        """
        sub = (
            await self.session.execute(select(Subscription).where(Subscription.org_id == org_id).limit(1))
        ).scalar_one_or_none()
        if sub and str(getattr(sub.status, "value", sub.status)) in {
            SubscriptionStatus.ACTIVE.value,
            SubscriptionStatus.PAST_DUE.value,
        }:
            return str(getattr(sub.plan, "value", sub.plan)).lower()

        org_plan = (
            await self.session.execute(select(Organization.plan).where(Organization.id == org_id).limit(1))
        ).scalar_one_or_none()
        return str(getattr(org_plan, "value", org_plan or "free")).lower()

    async def resolve_effective_plan(self, *, org_id: uuid.UUID) -> Plan | None:
        """Получить модель эффективного тарифа организации.

        Args:
            org_id: ID организации.

        Returns:
            Объект Plan или None.
        """
        plan_name = await self.resolve_effective_plan_name(org_id=org_id)
        return await self.get_active_plan(name=plan_name)

    async def count_tables(self, *, org_id: uuid.UUID) -> int:
        """Посчитать количество таблиц в организации.

        Args:
            org_id: ID организации.

        Returns:
            Количество таблиц.
        """
        result = await self.session.execute(select(func.count(Table.id)).where(Table.org_id == org_id))
        return int(result.scalar() or 0)

    async def count_records(self, *, org_id: uuid.UUID) -> int:
        """Посчитать количество записей в организации.

        Args:
            org_id: ID организации.

        Returns:
            Количество записей.
        """
        result = await self.session.execute(select(func.count(Record.id)).where(Record.org_id == org_id))
        return int(result.scalar() or 0)

    async def count_kb_pages(self, *, org_id: uuid.UUID) -> int:
        """Посчитать количество страниц базы знаний в организации.

        Args:
            org_id: ID организации.

        Returns:
            Количество страниц KB.
        """
        result = await self.session.execute(select(func.count(KBPage.id)).where(KBPage.org_id == org_id))
        return int(result.scalar() or 0)

    async def list_org_users(self, *, org_id: uuid.UUID) -> list[tuple[uuid.UUID, str, str, str]]:
        """Получить пользователей организации.

        Args:
            org_id: ID организации.

        Returns:
            Список кортежей `(user_id, email, first_name, last_name)`.
        """
        rows = (
            await self.session.execute(
                select(User.id, User.email, User.first_name, User.last_name)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.org_id == org_id)
            )
        ).all()
        return [
            (
                row.id,
                str(row.email or ""),
                str(row.first_name or ""),
                str(row.last_name or ""),
            )
            for row in rows
        ]

    async def resolve_org_user_ids_by_refs(self, *, org_id: uuid.UUID, refs: list[str]) -> list[uuid.UUID]:
        """Разрешить список строковых ссылок в user_id организации.

        Поддерживаются email/имя/фамилия/полное имя.

        Args:
            org_id: ID организации.
            refs: Строковые ссылки на пользователей.

        Returns:
            Список уникальных `user_id` в порядке первого совпадения.
        """
        clean_refs = [str(x or "").strip().lower() for x in refs if str(x or "").strip()]
        if not clean_refs:
            return []
        users = await self.list_org_users(org_id=org_id)
        result: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for ref in clean_refs:
            for user_id, email, first_name, last_name in users:
                full_name = f"{first_name} {last_name}".strip().lower()
                rev_full_name = f"{last_name} {first_name}".strip().lower()
                if ref in (
                    email.lower(),
                    full_name,
                    rev_full_name,
                    first_name.lower(),
                    last_name.lower(),
                ):
                    if user_id not in seen:
                        seen.add(user_id)
                        result.append(user_id)
                    break
        return result

    async def list_active_tables_with_columns(self, *, org_id: uuid.UUID) -> list[Table]:
        """Получить активные таблицы организации вместе с колонками.

        Args:
            org_id: ID организации.

        Returns:
            Список моделей Table с предзагруженными `columns`.
        """
        return (
            (
                await self.session.execute(
                    select(Table)
                    .where(Table.org_id == org_id, Table.is_archived.is_(False))
                    .options(selectinload(Table.columns))
                )
            )
            .scalars()
            .all()
        )

    async def lock_table(self, *, table_id: uuid.UUID) -> None:
        """Взять блокировку строки таблицы (`FOR UPDATE`).

        Args:
            table_id: ID таблицы.

        Returns:
            None.
        """
        await self.session.execute(select(Table.id).where(Table.id == table_id).with_for_update())

    async def get_max_record_position(self, *, table_id: uuid.UUID) -> int:
        """Получить максимальный `position` записи в таблице.

        Args:
            table_id: ID таблицы.

        Returns:
            Максимальный position или -1, если записей нет.
        """
        result = await self.session.execute(
            select(func.coalesce(func.max(Record.position), -1)).where(Record.table_id == table_id)
        )
        return int(result.scalar_one() or -1)

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

    async def get_session_for_user_by_chat_id(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        chat_id: str | None,
    ) -> AIChatSession | None:
        """Получить сессию по chat_id с проверкой принадлежности org/user.

        Args:
            org_id: ID организации.
            user_id: ID пользователя.
            chat_id: Строковый ID сессии из клиентского запроса.

        Returns:
            Найденная AIChatSession или None, если `chat_id` пустой/невалидный
            или сессия не принадлежит пользователю.
        """
        if not chat_id:
            return None
        try:
            session_id = uuid.UUID(chat_id)
        except Exception:
            return None
        return await self.get_session(org_id=org_id, user_id=user_id, session_id=session_id)

    async def get_session(
        self, *, org_id: uuid.UUID, user_id: uuid.UUID, session_id: uuid.UUID
    ) -> AIChatSession | None:
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

    async def list_session_messages_for_user(
        self,
        *,
        session_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 60,
    ) -> list[AIChatMessage]:
        """Получить сообщения сессии для конкретного пользователя.

        Args:
            session_id: ID сессии.
            org_id: ID организации.
            user_id: ID пользователя.
            limit: Максимальное количество сообщений.

        Returns:
            Список сообщений по возрастанию `created_at`.
        """
        return (
            (
                await self.session.execute(
                    select(AIChatMessage)
                    .where(
                        AIChatMessage.session_id == session_id,
                        AIChatMessage.org_id == org_id,
                        AIChatMessage.user_id == user_id,
                    )
                    .order_by(AIChatMessage.created_at.asc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    async def get_last_assistant_message_by_request_id(
        self,
        *,
        session_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        request_id: str,
    ) -> AIChatMessage | None:
        """Найти последнее сообщение ассистента по `request_id`.

        Args:
            session_id: ID сессии.
            org_id: ID организации.
            user_id: ID пользователя.
            request_id: Идентификатор идемпотентного запроса.

        Returns:
            Сообщение ассистента или None.
        """
        return (
            (
                await self.session.execute(
                    select(AIChatMessage)
                    .where(
                        AIChatMessage.session_id == session_id,
                        AIChatMessage.org_id == org_id,
                        AIChatMessage.user_id == user_id,
                        AIChatMessage.role == "assistant",
                        AIChatMessage.meta.is_not(None),
                        AIChatMessage.meta["request_id"].astext == request_id,
                    )
                    .order_by(AIChatMessage.created_at.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )

    async def get_runtime_settings(self) -> AIRuntimeSettings | None:
        """Получить глобальные runtime-настройки AI.

        Returns:
            Объект AIRuntimeSettings или None.
        """
        return (await self.session.execute(select(AIRuntimeSettings).limit(1))).scalars().first()

    async def get_runtime_secret(self) -> AIRuntimeSecret | None:
        """Получить секреты runtime-настроек AI."""
        return (await self.session.execute(select(AIRuntimeSecret).limit(1))).scalars().first()

    async def list_runtime_audits(self, *, limit: int = 20) -> list[AIRuntimeAudit]:
        """Получить последние аудиты изменения runtime-настроек AI."""
        safe_limit = max(1, min(int(limit), 100))
        return (
            (
                await self.session.execute(
                    select(AIRuntimeAudit).order_by(AIRuntimeAudit.created_at.desc()).limit(safe_limit)
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
            (
                await self.session.execute(
                    select(KBPage)
                    .where(KBPage.org_id == org_id, KBPage.is_published.is_(True))
                    .order_by(KBPage.position.asc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    async def get_kb_page_for_org(self, *, org_id: uuid.UUID, page_id: uuid.UUID) -> KBPage | None:
        """Получить страницу базы знаний по ID в рамках организации.

        Args:
            org_id: ID организации.
            page_id: ID страницы KB.

        Returns:
            Объект KBPage или None.
        """
        return (
            (await self.session.execute(select(KBPage).where(KBPage.org_id == org_id, KBPage.id == page_id).limit(1)))
            .scalars()
            .first()
        )

    async def list_tables_with_columns(self, *, org_id: uuid.UUID, limit: int = 200) -> list[Table]:
        """Получить таблицы организации вместе с колонками.

        Args:
            org_id: ID организации.
            limit: Лимит количества таблиц.

        Returns:
            Список моделей Table с предзагруженными columns.
        """
        return (
            (
                await self.session.execute(
                    select(Table)
                    .where(Table.org_id == org_id, Table.is_archived.is_(False))
                    .options(selectinload(Table.columns))
                    .order_by(Table.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )

    async def list_schedule_events(self, *, org_id: uuid.UUID, limit: int = 100) -> list[Event]:
        """Получить события расписания организации.

        Args:
            org_id: ID организации.
            limit: Лимит количества событий.

        Returns:
            Список моделей Event.
        """
        return (
            (
                await self.session.execute(
                    select(Event).where(Event.org_id == org_id).order_by(Event.start_at.desc()).limit(limit)
                )
            )
            .scalars()
            .all()
        )

    async def resolve_org_user_ids(self, *, org_id: uuid.UUID, refs: list[str]) -> tuple[list[uuid.UUID], list[str]]:
        """Resolve org user ids by UUID/email/full-name/first-name/last-name."""
        normalized = [str(x).strip() for x in refs if str(x).strip()]
        if not normalized:
            return [], []

        resolved: list[uuid.UUID] = []
        unresolved: list[str] = []
        lowered = [x.lower() for x in normalized]

        # 1) UUID refs.
        uuid_refs: list[uuid.UUID] = []
        for raw in normalized:
            try:
                uuid_refs.append(uuid.UUID(raw))
            except Exception:
                continue
        if uuid_refs:
            rows = (
                (
                    await self.session.execute(
                        select(Membership.user_id).where(Membership.org_id == org_id, Membership.user_id.in_(uuid_refs))
                    )
                )
                .scalars()
                .all()
            )
            for uid in rows:
                if uid not in resolved:
                    resolved.append(uid)

        # 2) Email / name refs.
        members = (
            await self.session.execute(
                select(User.id, User.email, User.first_name, User.last_name)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.org_id == org_id)
            )
        ).all()
        by_exact_email: dict[str, uuid.UUID] = {}
        by_exact_name: dict[str, uuid.UUID] = {}
        by_first_name: dict[str, uuid.UUID] = {}
        by_last_name: dict[str, uuid.UUID] = {}
        for row in members:
            uid = row.id
            email = str(row.email or "").strip().lower()
            first = str(row.first_name or "").strip().lower()
            last = str(row.last_name or "").strip().lower()
            full = f"{first} {last}".strip()
            if email and email not in by_exact_email:
                by_exact_email[email] = uid
            if full and full not in by_exact_name:
                by_exact_name[full] = uid
            if first and first not in by_first_name:
                by_first_name[first] = uid
            if last and last not in by_last_name:
                by_last_name[last] = uid

        for raw in lowered:
            uid = by_exact_email.get(raw) or by_exact_name.get(raw) or by_first_name.get(raw) or by_last_name.get(raw)
            if uid:
                if uid not in resolved:
                    resolved.append(uid)
            else:
                # Mark unresolved only for non-uuid refs.
                try:
                    uuid.UUID(raw)
                except Exception:
                    unresolved.append(raw)

        return resolved, unresolved
