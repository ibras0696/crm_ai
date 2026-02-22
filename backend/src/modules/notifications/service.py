import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notifications.models import Notification
from src.modules.notifications.repository import NotificationRepository


class NotificationsService:
    """Application service for notifications module."""

    def __init__(self, session: AsyncSession):
        self.repo = NotificationRepository(session)

    async def list_notifications(
        self,
        *,
        user_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Notification]:
        """List notifications for user in organization."""
        return await self.repo.list_by_user(user_id=user_id, org_id=org_id, limit=limit, offset=offset)

    async def unread_count(self, *, user_id: uuid.UUID, org_id: uuid.UUID) -> int:
        """Get unread notifications count."""
        return await self.repo.count_unread(user_id=user_id, org_id=org_id)

    async def mark_read(self, *, notif_id: uuid.UUID, user_id: uuid.UUID, org_id: uuid.UUID) -> bool:
        """Mark single notification as read."""
        return await self.repo.mark_read(notif_id=notif_id, user_id=user_id, org_id=org_id)

    async def mark_all_read(self, *, user_id: uuid.UUID, org_id: uuid.UUID) -> int:
        """Mark all user notifications as read."""
        return await self.repo.mark_all_read(user_id=user_id, org_id=org_id)
