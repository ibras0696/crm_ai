import uuid

from src.common.exceptions import ForbiddenError, NotFoundError
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.security import create_access_token
from src.modules.org.models import Membership, Organization
from src.modules.org.repository import MembershipRepository, OrganizationRepository


class OrgProfileService:
    """Read/general organization use-cases."""

    async def get_org(self, org_id: uuid.UUID) -> Organization:
        async with UnitOfWork() as uow:
            repo = OrganizationRepository(uow.session)
            org = await repo.get_by_id(org_id)
            if not org:
                raise NotFoundError("Organization")
            return org

    async def get_members(self, org_id: uuid.UUID) -> list[Membership]:
        async with UnitOfWork() as uow:
            repo = MembershipRepository(uow.session)
            return await repo.get_org_members(org_id)

    async def switch_org(self, user_id: uuid.UUID, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            membership = await member_repo.get_membership(user_id, org_id)
            if not membership:
                raise ForbiddenError("You are not a member of this organization")

            access = create_access_token(user_id, org_id, membership.role.value)
            return {
                "access_token": access,
                "token_type": "bearer",
                "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            }

    async def get_user_orgs(self, user_id: uuid.UUID) -> list[dict]:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            memberships = await member_repo.get_user_memberships(user_id)
            result = []
            for membership in memberships:
                result.append(
                    {
                        "org_id": membership.org_id,
                        "org_name": membership.organization.name,
                        "org_slug": membership.organization.slug,
                        "role": membership.role.value,
                    }
                )
            return result

    async def delete_org(self, org_id: uuid.UUID) -> None:
        async with UnitOfWork() as uow:
            org_repo = OrganizationRepository(uow.session)
            org = await org_repo.get_by_id(org_id)
            if not org:
                raise NotFoundError("Organization")
            await org_repo.delete(org)
            await uow.commit()
