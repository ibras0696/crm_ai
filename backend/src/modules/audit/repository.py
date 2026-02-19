import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import AuditAction
from src.modules.audit.models import AuditLog


class AuditRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, log: AuditLog) -> AuditLog:
        self.session.add(log)
        await self.session.flush()
        return log

    async def log(
        self,
        org_id: uuid.UUID,
        actor_id: uuid.UUID | None,
        action: AuditAction,
        entity_type: str,
        entity_id: str | None = None,
        meta: dict | None = None,
        ip_address: str | None = None,
        correlation_id: str | None = None,
    ) -> AuditLog:
        entry = AuditLog(
            org_id=org_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            meta=meta,
            ip_address=ip_address,
            correlation_id=correlation_id,
        )
        return await self.create(entry)

    async def list_by_org(
        self,
        org_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AuditLog]:
        stmt = (
            select(AuditLog)
            .where(AuditLog.org_id == org_id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
