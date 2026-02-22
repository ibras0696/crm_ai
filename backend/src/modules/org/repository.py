import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.common.enums import InviteStatus, UserRole
from src.modules.org.models import Invite, Membership, Organization, Subscription


class OrganizationRepository:
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


class MembershipRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_membership(self, user_id: uuid.UUID, org_id: uuid.UUID) -> Membership | None:
        stmt = select(Membership).where(
            Membership.user_id == user_id,
            Membership.org_id == org_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_user_memberships(self, user_id: uuid.UUID) -> list[Membership]:
        stmt = (
            select(Membership)
            .options(selectinload(Membership.organization))
            .where(Membership.user_id == user_id)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_org_members(self, org_id: uuid.UUID) -> list[Membership]:
        stmt = (
            select(Membership)
            .options(selectinload(Membership.user))
            .where(Membership.org_id == org_id)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, membership: Membership) -> Membership:
        self.session.add(membership)
        await self.session.flush()
        return membership

    async def update_role(self, membership_id: uuid.UUID, role: UserRole) -> None:
        stmt = update(Membership).where(Membership.id == membership_id).values(role=role)
        await self.session.execute(stmt)

    async def delete(self, membership_id: uuid.UUID) -> None:
        m = await self.session.get(Membership, membership_id)
        if m:
            await self.session.delete(m)
            await self.session.flush()


class InviteRepository:
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
