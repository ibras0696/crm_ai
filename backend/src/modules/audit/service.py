from __future__ import annotations

import uuid

from src.modules.audit.models import AuditLog
from src.modules.audit.repository import AuditRepository


class AuditService:
    """Сервис чтения аудита (без SQL в роутере)."""

    def __init__(self, repo: AuditRepository):
        self.repo = repo

    async def list_logs(
        self,
        *,
        org_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> list[AuditLog]:
        """Получить страницу журнала аудита организации."""
        safe_limit = max(1, min(limit, 200))
        safe_offset = max(0, offset)
        return await self.repo.list_by_org(org_id=org_id, limit=safe_limit, offset=safe_offset)

