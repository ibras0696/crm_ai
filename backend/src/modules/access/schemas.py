from __future__ import annotations

import uuid  # noqa: TC003
from datetime import datetime  # noqa: TC003

from pydantic import BaseModel


class AccessRuleOut(BaseModel):
    """Схема правила доступа для ответа API."""

    id: uuid.UUID
    resource_type: str
    resource_id: uuid.UUID | None
    role: str | None
    user_id: uuid.UUID | None
    can_read: bool
    can_write: bool
    can_delete: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateAccessRuleRequest(BaseModel):
    """Создание правила доступа (для OWNER/ADMIN)."""

    resource_type: str
    resource_id: uuid.UUID | None = None
    role: str | None = None
    user_id: uuid.UUID | None = None
    can_read: bool = True
    can_write: bool = True
    can_delete: bool = False

    model_config = {"extra": "forbid"}


class UpdateAccessRuleRequest(BaseModel):
    """Частичное обновление прав."""

    can_read: bool | None = None
    can_write: bool | None = None
    can_delete: bool | None = None

    model_config = {"extra": "forbid"}
