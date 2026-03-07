import uuid

from src.common.enums import UserRole
from src.modules.auth.models import User
from src.modules.org.models import Invite, Membership, Organization
from src.modules.org.services import OrgAILimitsService, OrgInviteService, OrgMembersService, OrgProfileService
from src.modules.org.schemas import OrgUpdateRequest


class OrgService:
    """Facade for organization module use-cases."""

    def __init__(
        self,
        *,
        profile_service: OrgProfileService | None = None,
        invite_service: OrgInviteService | None = None,
        members_service: OrgMembersService | None = None,
        ai_limits_service: OrgAILimitsService | None = None,
    ):
        self._profile = profile_service or OrgProfileService()
        self._invite = invite_service or OrgInviteService()
        self._members = members_service or OrgMembersService()
        self._ai_limits = ai_limits_service or OrgAILimitsService()

    async def get_org(self, org_id: uuid.UUID) -> Organization:
        return await self._profile.get_org(org_id)

    async def get_members(self, org_id: uuid.UUID) -> list[Membership]:
        return await self._profile.get_members(org_id)

    async def create_invite(
        self,
        org_id: uuid.UUID,
        email: str,
        role: UserRole,
        invited_by: uuid.UUID,
        ip_address: str | None = None,
    ) -> Invite:
        return await self._invite.create_invite(
            org_id=org_id,
            email=email,
            role=role,
            invited_by=invited_by,
            ip_address=ip_address,
        )

    async def resend_invite(
        self,
        *,
        org_id: uuid.UUID,
        invite_id: uuid.UUID,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> Invite:
        return await self._invite.resend_invite(
            org_id=org_id,
            invite_id=invite_id,
            actor_id=actor_id,
            ip_address=ip_address,
        )

    async def accept_invite(
        self,
        token: str,
        password: str,
        first_name: str,
        last_name: str,
        ip_address: str | None = None,
    ) -> tuple[User, dict]:
        return await self._invite.accept_invite(
            token=token,
            password=password,
            first_name=first_name,
            last_name=last_name,
            ip_address=ip_address,
        )

    async def update_member_role(
        self,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        new_role: UserRole,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        await self._members.update_member_role(
            org_id=org_id,
            membership_id=membership_id,
            new_role=new_role,
            actor_id=actor_id,
            ip_address=ip_address,
        )

    async def remove_member(
        self,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        await self._members.remove_member(
            org_id=org_id,
            membership_id=membership_id,
            actor_id=actor_id,
            ip_address=ip_address,
        )

    async def switch_org(self, user_id: uuid.UUID, org_id: uuid.UUID) -> dict:
        return await self._profile.switch_org(user_id, org_id)

    async def get_user_orgs(self, user_id: uuid.UUID) -> list[dict]:
        return await self._profile.get_user_orgs(user_id)

    async def delete_org(self, org_id: uuid.UUID) -> None:
        await self._profile.delete_org(org_id)

    async def update_org(self, org_id: uuid.UUID, body: OrgUpdateRequest) -> Organization:
        return await self._profile.update_org(org_id, body)

    async def get_ai_limits(self, *, org_id: uuid.UUID) -> dict:
        return await self._ai_limits.get_limits(org_id=org_id)

    async def update_ai_org_limits(
        self,
        *,
        org_id: uuid.UUID,
        actor_id: uuid.UUID,
        daily_tokens_limit: int,
        monthly_tokens_limit: int,
        ip_address: str | None = None,
    ) -> dict:
        return await self._ai_limits.update_org_limits(
            org_id=org_id,
            actor_id=actor_id,
            daily_tokens_limit=daily_tokens_limit,
            monthly_tokens_limit=monthly_tokens_limit,
            ip_address=ip_address,
        )

    async def update_ai_user_limits(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        actor_id: uuid.UUID,
        daily_tokens_limit: int,
        rpm_limit: int,
        ip_address: str | None = None,
    ) -> dict:
        return await self._ai_limits.upsert_user_limit(
            org_id=org_id,
            user_id=user_id,
            actor_id=actor_id,
            daily_tokens_limit=daily_tokens_limit,
            rpm_limit=rpm_limit,
            ip_address=ip_address,
        )
