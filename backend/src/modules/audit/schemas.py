from __future__ import annotations

import uuid  # noqa: TC003
from datetime import datetime  # noqa: TC003

from pydantic import BaseModel


class AuditLogItem(BaseModel):
    """Элемент журнала аудита для API-ответа."""

    id: uuid.UUID
    org_id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    entity_type: str
    entity_id: str | None
    meta: dict | None
    ip_address: str | None
    correlation_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
