import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.common.enums import InviteStatus, UserRole
from src.modules.billing.models import Plan
from src.modules.org.models import Invite, Membership, Organization, Subscription


class OrganizationRepository:
    """Repository for organization entities."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, org_id: uuid.UUID) -> Organization | None:
        return await self.session.get(Organization, org_id)

    async def get_by_slug(self, slug: str) -> Organization | None:
        stmt = select(Organization).where(Organization.slug == slug)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, org: Organization) -> Organization:
        self.session.add(org)
        await self.session.flush()
        return org

    async def delete(self, org: Organization) -> None:
        await self.session.delete(org)
        await self.session.flush()


class MembershipRepository:
    """Repository for membership entities."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_membership(self, user_id: uuid.UUID, org_id: uuid.UUID) -> Membership | None:
        stmt = select(Membership).where(
            Membership.user_id == user_id,
            Membership.org_id == org_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_id_for_org(self, membership_id: uuid.UUID, org_id: uuid.UUID) -> Membership | None:
        stmt = select(Membership).where(Membership.id == membership_id, Membership.org_id == org_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_memberships(self, user_id: uuid.UUID) -> list[Membership]:
        stmt = select(Membership).options(selectinload(Membership.organization)).where(Membership.user_id == user_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_org_members(self, org_id: uuid.UUID) -> list[Membership]:
        stmt = select(Membership).options(selectinload(Membership.user)).where(Membership.org_id == org_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_org_owners(self, org_id: uuid.UUID) -> int:
        stmt = select(func.count(Membership.id)).where(
            Membership.org_id == org_id,
            Membership.role == UserRole.OWNER,
        )
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def count_org_members(self, org_id: uuid.UUID) -> int:
        stmt = select(func.count(Membership.id)).where(Membership.org_id == org_id)
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)

    async def create(self, membership: Membership) -> Membership:
        self.session.add(membership)
        await self.session.flush()
        return membership

    async def update_role(self, membership_id: uuid.UUID, role: UserRole) -> None:
        stmt = update(Membership).where(Membership.id == membership_id).values(role=role)
        await self.session.execute(stmt)

    async def delete(self, membership: Membership) -> None:
        await self.session.delete(membership)
        await self.session.flush()


class InviteRepository:
    """Repository for invite entities."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_token(self, token: str) -> Invite | None:
        stmt = select(Invite).where(
            Invite.token == token,
            Invite.status == InviteStatus.PENDING,
            Invite.expires_at > datetime.now(UTC),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_pending_by_email_and_org(self, email: str, org_id: uuid.UUID) -> Invite | None:
        stmt = select(Invite).where(
            Invite.email == email,
            Invite.org_id == org_id,
            Invite.status == InviteStatus.PENDING,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_pending_by_id(self, invite_id: uuid.UUID, org_id: uuid.UUID) -> Invite | None:
        stmt = select(Invite).where(
            Invite.id == invite_id,
            Invite.org_id == org_id,
            Invite.status == InviteStatus.PENDING,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, invite: Invite) -> Invite:
        self.session.add(invite)
        await self.session.flush()
        return invite

    async def update_status(self, invite_id: uuid.UUID, status: InviteStatus) -> None:
        stmt = update(Invite).where(Invite.id == invite_id).values(status=status)
        await self.session.execute(stmt)

    async def bump_expiry(self, invite_id: uuid.UUID, *, expires_at: datetime) -> None:
        stmt = update(Invite).where(Invite.id == invite_id).values(expires_at=expires_at)
        await self.session.execute(stmt)


class SubscriptionRepository:
    """Repository for subscription entities."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_org(self, org_id: uuid.UUID) -> Subscription | None:
        stmt = select(Subscription).where(Subscription.org_id == org_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def create(self, sub: Subscription) -> Subscription:
        self.session.add(sub)
        await self.session.flush()
        return sub

    async def get_effective_plan(self, org_id: uuid.UUID) -> Plan | None:
        sub = await self.get_by_org(org_id)
        plan_name = None
        if sub is not None:
            status = str(getattr(sub.status, "value", sub.status))
            if status in {"active", "past_due"}:
                plan_name = str(getattr(sub.plan, "value", sub.plan))

        if not plan_name:
            org_plan = (
                await self.session.execute(select(Organization.plan).where(Organization.id == org_id).limit(1))
            ).scalar_one_or_none()
            plan_name = str(getattr(org_plan, "value", org_plan or "free"))

        return (
            await self.session.execute(select(Plan).where(Plan.name == plan_name.lower(), Plan.is_active.is_(True)))
        ).scalar_one_or_none()
