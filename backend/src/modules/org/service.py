import secrets
import uuid
from datetime import UTC, datetime, timedelta

from src.common.enums import AuditAction, InviteStatus, PlanTier, SubscriptionStatus, UserRole
from src.common.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationError
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.auth.models import User
from src.modules.auth.repository import RefreshTokenRepository, UserRepository
from src.modules.auth.security import create_access_token, create_refresh_token, hash_password, refresh_token_expires_at
from src.modules.auth.models import RefreshToken
from src.modules.org.models import Invite, Membership, Organization
from src.modules.org.repository import InviteRepository, MembershipRepository, OrganizationRepository


class OrgService:
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

    async def create_invite(
        self,
        org_id: uuid.UUID,
        email: str,
        role: UserRole,
        invited_by: uuid.UUID,
        ip_address: str | None = None,
    ) -> Invite:
        async with UnitOfWork() as uow:
            invite_repo = InviteRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            user_repo = UserRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            existing_user = await user_repo.get_by_email(email)
            if existing_user:
                existing_membership = await member_repo.get_membership(existing_user.id, org_id)
                if existing_membership:
                    raise ConflictError("User is already a member of this organization")

            existing_invite = await invite_repo.get_pending_by_email_and_org(email, org_id)
            if existing_invite:
                raise ConflictError("Pending invite already exists for this email")

            token = secrets.token_urlsafe(48)
            invite = Invite(
                org_id=org_id,
                email=email,
                role=role,
                token=token,
                invited_by=invited_by,
                expires_at=datetime.now(UTC) + timedelta(days=7),
            )
            invite = await invite_repo.create(invite)

            await audit_repo.log(
                org_id=org_id,
                actor_id=invited_by,
                action=AuditAction.INVITE_SENT,
                entity_type="invite",
                entity_id=str(invite.id),
                meta={"email": email, "role": role.value},
                ip_address=ip_address,
            )

            await uow.commit()
            return invite

    async def accept_invite(
        self,
        token: str,
        password: str,
        first_name: str,
        last_name: str,
        ip_address: str | None = None,
    ) -> tuple[User, dict]:
        async with UnitOfWork() as uow:
            invite_repo = InviteRepository(uow.session)
            user_repo = UserRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            token_repo = RefreshTokenRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            invite = await invite_repo.get_by_token(token)
            if not invite:
                raise NotFoundError("Invite")

            user = await user_repo.get_by_email(invite.email)
            if not user:
                user = User(
                    email=invite.email,
                    hashed_password=hash_password(password),
                    first_name=first_name,
                    last_name=last_name,
                )
                user = await user_repo.create(user)
            else:
                existing_membership = await member_repo.get_membership(user.id, invite.org_id)
                if existing_membership:
                    raise ConflictError("User is already a member of this organization")

            membership = Membership(user_id=user.id, org_id=invite.org_id, role=invite.role)
            await member_repo.create(membership)

            await invite_repo.update_status(invite.id, InviteStatus.ACCEPTED)

            raw_refresh, refresh_hash = create_refresh_token()
            rt = RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
            await token_repo.create(rt)

            access = create_access_token(user.id, invite.org_id, invite.role.value)

            await audit_repo.log(
                org_id=invite.org_id,
                actor_id=user.id,
                action=AuditAction.INVITE_ACCEPTED,
                entity_type="invite",
                entity_id=str(invite.id),
                ip_address=ip_address,
            )

            await uow.commit()

            from src.config import settings

            tokens = {
                "access_token": access,
                "refresh_token": raw_refresh,
                "token_type": "bearer",
                "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            }
            return user, tokens

    async def update_member_role(
        self,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        new_role: UserRole,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            membership = await uow.session.get(Membership, membership_id)
            if not membership or membership.org_id != org_id:
                raise NotFoundError("Membership")

            if membership.role == UserRole.OWNER and new_role != UserRole.OWNER:
                owners = await member_repo.get_org_members(org_id)
                owner_count = sum(1 for m in owners if m.role == UserRole.OWNER)
                if owner_count <= 1:
                    raise ValidationError("Cannot remove the last owner of an organization")

            old_role = membership.role
            await member_repo.update_role(membership_id, new_role)

            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.ROLE_CHANGED,
                entity_type="membership",
                entity_id=str(membership_id),
                meta={"old_role": old_role.value, "new_role": new_role.value, "user_id": str(membership.user_id)},
                ip_address=ip_address,
            )

            await uow.commit()

    async def remove_member(
        self,
        org_id: uuid.UUID,
        membership_id: uuid.UUID,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> None:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            membership = await uow.session.get(Membership, membership_id)
            if not membership or membership.org_id != org_id:
                raise NotFoundError("Membership")

            if membership.role == UserRole.OWNER:
                owners = await member_repo.get_org_members(org_id)
                owner_count = sum(1 for m in owners if m.role == UserRole.OWNER)
                if owner_count <= 1:
                    raise ValidationError("Cannot remove the last owner")

            await member_repo.delete(membership_id)

            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.DELETE,
                entity_type="membership",
                entity_id=str(membership_id),
                meta={"removed_user_id": str(membership.user_id)},
                ip_address=ip_address,
            )

            await uow.commit()

    async def switch_org(self, user_id: uuid.UUID, org_id: uuid.UUID) -> dict:
        async with UnitOfWork() as uow:
            member_repo = MembershipRepository(uow.session)
            membership = await member_repo.get_membership(user_id, org_id)
            if not membership:
                raise ForbiddenError("You are not a member of this organization")

            access = create_access_token(user_id, org_id, membership.role.value)

            from src.config import settings

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
            for m in memberships:
                result.append({
                    "org_id": m.org_id,
                    "org_name": m.organization.name,
                    "org_slug": m.organization.slug,
                    "role": m.role.value,
                })
            return result
