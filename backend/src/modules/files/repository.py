import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import SubscriptionStatus
from src.modules.billing.models import Plan
from src.modules.files.models import File
from src.modules.org.models import Organization, Subscription


class FileRepository:
    """Repository for files SQL operations only."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, file: File) -> File:
        """Create a new file row."""
        self.session.add(file)
        await self.session.flush()
        return file

    async def get_by_id(self, file_id: uuid.UUID) -> File | None:
        """Get file by identifier."""
        return await self.session.get(File, file_id)

    async def get_by_id_for_org(self, file_id: uuid.UUID, org_id: uuid.UUID) -> File | None:
        """Get file by identifier constrained by organization."""
        stmt = select(File).where(File.id == file_id, File.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_org(self, org_id: uuid.UUID, limit: int = 50, offset: int = 0) -> list[File]:
        """Get organization files with pagination."""
        stmt = (
            select(File)
            .where(File.org_id == org_id)
            .order_by(File.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, file: File) -> None:
        """Delete file row."""
        await self.session.delete(file)
        await self.session.flush()

    async def get_org_storage_bytes(self, org_id: uuid.UUID) -> int:
        """Get current total storage size for organization."""
        result = await self.session.execute(
            select(func.coalesce(func.sum(File.size), 0)).where(File.org_id == org_id)
        )
        return int(result.scalar_one() or 0)

    async def resolve_effective_plan(self, org_id: uuid.UUID) -> Plan | None:
        """Resolve effective organization plan (subscription first, fallback to org.plan)."""
        sub = (
            await self.session.execute(select(Subscription).where(Subscription.org_id == org_id).limit(1))
        ).scalar_one_or_none()
        plan_name = None
        if sub and sub.status in {SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE}:
            plan_name = str(getattr(sub.plan, "value", sub.plan))
        if not plan_name:
            org_plan = (
                await self.session.execute(select(Organization.plan).where(Organization.id == org_id).limit(1))
            ).scalar_one_or_none()
            plan_name = str(getattr(org_plan, "value", org_plan or "free"))
        return (
            await self.session.execute(
                select(Plan).where(Plan.name == plan_name.lower(), Plan.is_active.is_(True))
            )
        ).scalar_one_or_none()
