from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from src.common.enums import AuditAction, InviteStatus, PlanTier, SubscriptionStatus, UserRole
from src.common.exceptions import AppError, ConflictError, NotFoundError, ValidationError
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
from src.modules.auth.services.utils import build_token_response, slugify_org_name
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.org.repository import (
    InviteRepository,
    MembershipRepository,
    OrganizationRepository,
    SubscriptionRepository,
)

if TYPE_CHECKING:
    from src.modules.auth.schemas import RegisterRequest, TokenResponse


class AuthRegistrationService:
    """Registration use-cases: invite-based and new organization."""

    async def register(
        self,
        data: RegisterRequest,
        ip_address: str | None = None,
    ) -> tuple[User, Organization, TokenResponse]:
        async with UnitOfWork() as uow:
            user_repo = UserRepository(uow.session)
            org_repo = OrganizationRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            token_repo = RefreshTokenRepository(uow.session)
            sub_repo = SubscriptionRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            existing = await user_repo.get_by_email(data.email)
            if existing:
                raise ConflictError("User with this email already exists", field="email")

            if getattr(data, "invite_token", None):
                user, org, token_response = await self._register_by_invite(
                    data=data,
                    ip_address=ip_address,
                    user_repo=user_repo,
                    org_repo=org_repo,
                    member_repo=member_repo,
                    token_repo=token_repo,
                    audit_repo=audit_repo,
                    sub_repo=sub_repo,
                    invite_repo=InviteRepository(uow.session),
                )
                await uow.commit()
                return user, org, token_response

            user, org, token_response = await self._register_new_org(
                data=data,
                ip_address=ip_address,
                user_repo=user_repo,
                org_repo=org_repo,
                member_repo=member_repo,
                token_repo=token_repo,
                sub_repo=sub_repo,
                audit_repo=audit_repo,
            )
            await uow.commit()
            return user, org, token_response

    async def _register_by_invite(
        self,
        *,
        data: RegisterRequest,
        ip_address: str | None,
        user_repo: UserRepository,
        org_repo: OrganizationRepository,
        member_repo: MembershipRepository,
        token_repo: RefreshTokenRepository,
        audit_repo: AuditRepository,
        sub_repo: SubscriptionRepository,
        invite_repo: InviteRepository,
    ) -> tuple[User, Organization, TokenResponse]:
        invite = await invite_repo.get_by_token(data.invite_token)  # type: ignore[arg-type]
        if not invite:
            raise NotFoundError("Invite")
        if invite.status != InviteStatus.PENDING:
            raise ValidationError("Invite is not active")
        if invite.expires_at and invite.expires_at < datetime.now(UTC):
            raise ValidationError("Invite expired")
        if invite.email.lower() != str(data.email).lower():
            raise ValidationError("Invite email does not match registration email", field="email")

        org = await org_repo.get_by_id(invite.org_id)
        if not org:
            raise NotFoundError("Organization")

        user = User(
            email=data.email,
            hashed_password=hash_password(data.password),
            first_name=data.first_name,
            last_name=data.last_name,
        )
        user = await user_repo.create(user)
        await self._enforce_member_limit(member_repo=member_repo, sub_repo=sub_repo, org_id=org.id)

        membership = Membership(user_id=user.id, org_id=org.id, role=invite.role)
        await member_repo.create(membership)
        await invite_repo.update_status(invite.id, InviteStatus.ACCEPTED)

        raw_refresh, refresh_hash = create_refresh_token()
        await token_repo.create(
            RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
        )

        access_token = create_access_token(user.id, org.id, invite.role.value)

        await audit_repo.log(
            org_id=org.id,
            actor_id=user.id,
            action=AuditAction.INVITE_ACCEPTED,
            entity_type="invite",
            entity_id=str(invite.id),
            ip_address=ip_address,
        )

        return user, org, build_token_response(access_token=access_token, refresh_token=raw_refresh)

    async def _enforce_member_limit(
        self,
        *,
        member_repo: MembershipRepository,
        sub_repo: SubscriptionRepository,
        org_id,
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

    async def _register_new_org(
        self,
        *,
        data: RegisterRequest,
        ip_address: str | None,
        user_repo: UserRepository,
        org_repo: OrganizationRepository,
        member_repo: MembershipRepository,
        token_repo: RefreshTokenRepository,
        sub_repo: SubscriptionRepository,
        audit_repo: AuditRepository,
    ) -> tuple[User, Organization, TokenResponse]:
        user = User(
            email=data.email,
            hashed_password=hash_password(data.password),
            first_name=data.first_name,
            last_name=data.last_name,
        )
        user = await user_repo.create(user)

        base_slug = slugify_org_name(data.org_name)
        slug = base_slug
        attempt = 0
        while await org_repo.get_by_slug(slug):
            attempt += 1
            slug = f"{base_slug}-{attempt}"

        org = Organization(name=data.org_name, slug=slug, plan=PlanTier.FREE)
        org = await org_repo.create(org)

        await member_repo.create(Membership(user_id=user.id, org_id=org.id, role=UserRole.OWNER))
        await sub_repo.create(
            Subscription(
                org_id=org.id,
                plan=PlanTier.FREE,
                status=SubscriptionStatus.ACTIVE,
            )
        )

        raw_refresh, refresh_hash = create_refresh_token()
        await token_repo.create(
            RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
        )

        access_token = create_access_token(user.id, org.id, UserRole.OWNER.value)

        await audit_repo.log(
            org_id=org.id,
            actor_id=user.id,
            action=AuditAction.CREATE,
            entity_type="organization",
            entity_id=str(org.id),
            meta={"org_name": org.name},
            ip_address=ip_address,
        )

        return user, org, build_token_response(access_token=access_token, refresh_token=raw_refresh)
