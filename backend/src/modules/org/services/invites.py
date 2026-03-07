import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from src.common.enums import AuditAction, InviteStatus, UserRole
from src.common.exceptions import AppError, ConflictError, NotFoundError, ValidationError
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.auth.models import RefreshToken, User
from src.modules.auth.repository import RefreshTokenRepository, UserRepository
from src.modules.auth.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    refresh_token_expires_at,
)
from src.modules.notifications.tasks import send_invite_email
from src.modules.org.models import Invite, Membership, Organization
from src.modules.org.repository import (
    InviteRepository,
    MembershipRepository,
    OrganizationRepository,
    SubscriptionRepository,
)

logger = logging.getLogger(__name__)


class OrgInviteService:
    """Invite-related organization use-cases."""

    async def create_invite(
        self,
        *,
        org_id: uuid.UUID,
        email: str,
        role: UserRole,
        invited_by: uuid.UUID,
        ip_address: str | None = None,
    ) -> Invite:
        async with UnitOfWork() as uow:
            invite_repo = InviteRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            sub_repo = SubscriptionRepository(uow.session)
            user_repo = UserRepository(uow.session)
            org_repo = OrganizationRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            window_start = datetime.now(UTC) - timedelta(seconds=60)
            invites_last_min = await audit_repo.count_actions_since(
                org_id=org_id,
                actor_id=invited_by,
                action=AuditAction.INVITE_SENT,
                since=window_start,
            )
            if invites_last_min >= int(settings.INVITES_RPM_PER_ACTOR or 0):
                raise ValidationError("Too many invites. Please wait a minute and try again.")

            existing_user = await user_repo.get_by_email(email)
            if existing_user:
                existing_membership = await member_repo.get_membership(existing_user.id, org_id)
                if existing_membership:
                    raise ConflictError("User is already a member of this organization")

            existing_invite = await invite_repo.get_pending_by_email_and_org(email, org_id)
            if existing_invite:
                raise ConflictError("Pending invite already exists for this email")
            await self._enforce_member_limit(member_repo=member_repo, sub_repo=sub_repo, org_id=org_id)

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

            org = await org_repo.get_by_id(org_id)
            org_name = org.name if org else "CRM"
            await uow.commit()

            try:
                send_invite_email.delay(email, org_name, token, None)
            except Exception:
                logger.exception("Failed to enqueue invite email task")
            # UI uses this to show clear handling for unregistered users.
            invite.invitee_exists = existing_user is not None  # type: ignore[attr-defined]
            return invite

    async def resend_invite(
        self,
        *,
        org_id: uuid.UUID,
        invite_id: uuid.UUID,
        actor_id: uuid.UUID,
        ip_address: str | None = None,
    ) -> Invite:
        async with UnitOfWork() as uow:
            invite_repo = InviteRepository(uow.session)
            org_repo = OrganizationRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            invite = await invite_repo.get_pending_by_id(invite_id, org_id)
            if not invite:
                raise NotFoundError("Invite")

            new_expiry = datetime.now(UTC) + timedelta(days=7)
            await invite_repo.bump_expiry(invite.id, expires_at=new_expiry)

            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.INVITE_SENT,
                entity_type="invite_resend",
                entity_id=str(invite.id),
                meta={"email": invite.email, "role": invite.role.value},
                ip_address=ip_address,
            )

            org = await org_repo.get_by_id(org_id)
            org_name = org.name if org else "CRM"
            await uow.commit()

            try:
                send_invite_email.delay(invite.email, org_name, invite.token, None)
            except Exception:
                logger.exception("Failed to enqueue invite resend task")

            invite.expires_at = new_expiry
            return invite

    async def accept_invite(
        self,
        *,
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
            sub_repo = SubscriptionRepository(uow.session)
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
            await self._enforce_member_limit(member_repo=member_repo, sub_repo=sub_repo, org_id=invite.org_id)

            membership = Membership(user_id=user.id, org_id=invite.org_id, role=invite.role)
            await member_repo.create(membership)

            await invite_repo.update_status(invite.id, InviteStatus.ACCEPTED)

            raw_refresh, refresh_hash = create_refresh_token()
            refresh = RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
            await token_repo.create(refresh)

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

            tokens = {
                "access_token": access,
                "refresh_token": raw_refresh,
                "token_type": "bearer",
                "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            }
            return user, tokens

    async def _enforce_member_limit(
        self,
        *,
        member_repo: MembershipRepository,
        sub_repo: SubscriptionRepository,
        org_id: uuid.UUID,
    ) -> None:
        plan = await sub_repo.get_effective_plan(org_id)
        limit = int(getattr(plan, "max_members", 0) or 0)
        if limit <= 0:
            return
        current_members = await member_repo.count_org_members(org_id)
        if current_members >= limit:
            raise AppError(
                code="MEMBER_LIMIT_REACHED",
                message="Достигнут лимит тарифа по участникам.",
                status_code=422,
            )
