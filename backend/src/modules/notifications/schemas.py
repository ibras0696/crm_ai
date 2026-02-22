import uuid
from datetime import datetime

from pydantic import BaseModel


class NotificationItem(BaseModel):
    """Notification DTO for API responses."""

    id: uuid.UUID
    title: str
    body: str | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UnreadCount(BaseModel):
    """Unread notifications count DTO."""

    count: int
