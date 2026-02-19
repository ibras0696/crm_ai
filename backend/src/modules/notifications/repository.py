import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notifications.models import Notification


class NotificationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, notif: Notification) -> Notification:
        self.session.add(notif)
        await self.session.flush()
        return notif

    async def list_by_user(self, user_id: uuid.UUID, org_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_id == user_id, Notification.org_id == org_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_unread(self, user_id: uuid.UUID, org_id: uuid.UUID) -> int:
        from sqlalchemy import func
        stmt = select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id,
            Notification.org_id == org_id,
            Notification.is_read == False,
        )
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def mark_read(self, notif_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = (
            update(Notification)
            .where(Notification.id == notif_id, Notification.user_id == user_id)
            .values(is_read=True)
        )
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def mark_all_read(self, user_id: uuid.UUID, org_id: uuid.UUID) -> int:
        stmt = (
            update(Notification)
            .where(Notification.user_id == user_id, Notification.org_id == org_id, Notification.is_read == False)
            .values(is_read=True)
        )
        result = await self.session.execute(stmt)
        return result.rowcount
