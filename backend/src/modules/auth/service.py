import re
import uuid
from datetime import UTC, datetime

from src.common.enums import AuditAction, InviteStatus, PlanTier, SubscriptionStatus, UserRole
from src.common.exceptions import ConflictError, NotFoundError, UnauthorizedError, ValidationError
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.auth.models import RefreshToken, User
from src.modules.auth.repository import RefreshTokenRepository, UserRepository
from src.modules.auth.schemas import RegisterRequest, TokenResponse
from src.modules.auth.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    refresh_token_expires_at,
    verify_password,
)
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.org.repository import MembershipRepository, OrganizationRepository, SubscriptionRepository


def _slugify(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower().strip())
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "org"


class AuthService:
    async def register(self, data: RegisterRequest, ip_address: str | None = None) -> tuple[User, Organization, TokenResponse]:
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

            user = User(
                email=data.email,
                hashed_password=hash_password(data.password),
                first_name=data.first_name,
                last_name=data.last_name,
            )
            user = await user_repo.create(user)

            base_slug = _slugify(data.org_name)
            slug = base_slug
            attempt = 0
            while await org_repo.get_by_slug(slug):
                attempt += 1
                slug = f"{base_slug}-{attempt}"

            org = Organization(name=data.org_name, slug=slug, plan=PlanTier.FREE)
            org = await org_repo.create(org)

            membership = Membership(user_id=user.id, org_id=org.id, role=UserRole.OWNER)
            await member_repo.create(membership)

            subscription = Subscription(
                org_id=org.id,
                plan=PlanTier.FREE,
                status=SubscriptionStatus.ACTIVE,
            )
            await sub_repo.create(subscription)

            raw_refresh, refresh_hash = create_refresh_token()
            rt = RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
            await token_repo.create(rt)

            access = create_access_token(user.id, org.id, UserRole.OWNER.value)

            await audit_repo.log(
                org_id=org.id,
                actor_id=user.id,
                action=AuditAction.CREATE,
                entity_type="organization",
                entity_id=str(org.id),
                meta={"org_name": org.name},
                ip_address=ip_address,
            )

            await uow.commit()

            from src.config import settings

            token_resp = TokenResponse(
                access_token=access,
                refresh_token=raw_refresh,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            return user, org, token_resp

    async def login(self, email: str, password: str, ip_address: str | None = None, user_agent: str | None = None) -> tuple[User, TokenResponse]:
        async with UnitOfWork() as uow:
            user_repo = UserRepository(uow.session)
            token_repo = RefreshTokenRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            user = await user_repo.get_by_email(email)
            if not user or not verify_password(password, user.hashed_password):
                raise UnauthorizedError("Invalid email or password")

            if not user.is_active:
                raise UnauthorizedError("Account is deactivated")

            memberships = await member_repo.get_user_memberships(user.id)
            org_id = memberships[0].org_id if memberships else None
            role = memberships[0].role.value if memberships else None

            raw_refresh, refresh_hash = create_refresh_token()
            rt = RefreshToken(
                user_id=user.id,
                token_hash=refresh_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
                user_agent=user_agent,
            )
            await token_repo.create(rt)

            access = create_access_token(user.id, org_id, role)

            if org_id:
                await audit_repo.log(
                    org_id=org_id,
                    actor_id=user.id,
                    action=AuditAction.LOGIN,
                    entity_type="user",
                    entity_id=str(user.id),
                    ip_address=ip_address,
                )

            await uow.commit()

            from src.config import settings

            token_resp = TokenResponse(
                access_token=access,
                refresh_token=raw_refresh,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )
            return user, token_resp

    async def refresh(self, raw_refresh: str, ip_address: str | None = None) -> TokenResponse:
        async with UnitOfWork() as uow:
            token_repo = RefreshTokenRepository(uow.session)
            member_repo = MembershipRepository(uow.session)

            token_hash_val = hash_token(raw_refresh)
            rt = await token_repo.get_by_hash(token_hash_val)
            if not rt:
                raise UnauthorizedError("Invalid or expired refresh token")

            await token_repo.revoke(rt.id)

            memberships = await member_repo.get_user_memberships(rt.user_id)
            org_id = memberships[0].org_id if memberships else None
            role = memberships[0].role.value if memberships else None

            new_raw, new_hash = create_refresh_token()
            new_rt = RefreshToken(
                user_id=rt.user_id,
                token_hash=new_hash,
                expires_at=refresh_token_expires_at(),
                ip_address=ip_address,
            )
            await token_repo.create(new_rt)

            access = create_access_token(rt.user_id, org_id, role)

            await uow.commit()

            from src.config import settings

            return TokenResponse(
                access_token=access,
                refresh_token=new_raw,
                expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )

    async def logout(self, raw_refresh: str) -> None:
        async with UnitOfWork() as uow:
            token_repo = RefreshTokenRepository(uow.session)
            token_hash_val = hash_token(raw_refresh)
            rt = await token_repo.get_by_hash(token_hash_val)
            if rt:
                await token_repo.revoke(rt.id)
            await uow.commit()
