from __future__ import annotations

import json
import logging
import secrets
from datetime import UTC, datetime
from hashlib import sha256
from typing import TYPE_CHECKING

from redis.exceptions import RedisError

from src.common.enums import AuditAction, InviteStatus, PlanTier, SubscriptionStatus, UserRole
from src.common.exceptions import (
    AppError,
    BadRequestError,
    ConflictError,
    NotFoundError,
    RateLimitError,
    ValidationError,
)
from src.config import settings
from src.infrastructure.redis_client import redis_client
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
from src.modules.notifications.public_api import queue_email_notification
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.org.repository import (
    InviteRepository,
    MembershipRepository,
    OrganizationRepository,
    SubscriptionRepository,
)

if TYPE_CHECKING:
    from src.modules.auth.schemas import RegisterRequest, TokenResponse


logger = logging.getLogger(__name__)


class AuthRegistrationService:
    """Registration use-cases: invite-based and new organization."""

    @staticmethod
    def _registration_confirm_cache_key(token: str) -> str:
        return f"auth:register:confirm:{sha256(token.encode('utf-8')).hexdigest()}"

    @staticmethod
    def _registration_rpm_key(*, scope: str, fingerprint: str, minute_bucket: int) -> str:
        return f"auth:register:rpm:{scope}:{fingerprint}:{minute_bucket}"

    async def _check_registration_rpm_limits(self, *, email: str, ip_address: str | None) -> None:
        redis = await redis_client.get()
        minute_bucket = int(datetime.now(UTC).timestamp() // 60)

        email_fingerprint = sha256(email.strip().lower().encode("utf-8")).hexdigest()
        email_key = self._registration_rpm_key(
            scope="email",
            fingerprint=email_fingerprint,
            minute_bucket=minute_bucket,
        )
        ip_raw = (ip_address or "unknown").strip()
        ip_fingerprint = sha256(ip_raw.encode("utf-8")).hexdigest()
        ip_key = self._registration_rpm_key(scope="ip", fingerprint=ip_fingerprint, minute_bucket=minute_bucket)

        try:
            await self._consume_rpm(
                redis=redis,
                key=email_key,
                limit=int(settings.AUTH_REGISTRATION_REQUEST_RPM_PER_EMAIL),
            )
            await self._consume_rpm(redis=redis, key=ip_key, limit=int(settings.AUTH_REGISTRATION_REQUEST_RPM_PER_IP))
        except RedisError:
            logger.exception("Failed to enforce registration rate limit")

    async def _consume_rpm(self, *, redis, key: str, limit: int) -> None:
        if limit <= 0:
            return
        current = int(await redis.incr(key))
        if current == 1:
            await redis.expire(key, 120)
        if current > int(limit):
            raise RateLimitError("Слишком много попыток регистрации. Подождите минуту и попробуйте снова.")

    async def _consume_registration_confirm_payload(self, *, cache_key: str) -> str | None:
        redis = await redis_client.get()
        try:
            return await redis.getdel(cache_key)
        except (AttributeError, TypeError):
            payload = await redis.get(cache_key)
            if payload:
                await redis.delete(cache_key)
            return payload

    async def request_registration_confirmation(self, data: RegisterRequest, ip_address: str | None = None) -> None:
        if getattr(data, "invite_token", None):
            raise ValidationError("Для приглашения используйте отдельную ссылку-приглашение", field="invite_token")

        async with UnitOfWork() as uow:
            user_repo = UserRepository(uow.session)
            existing = await user_repo.get_by_email(data.email)
            if existing:
                raise ConflictError("User with this email already exists", field="email")

        await self._check_registration_rpm_limits(email=str(data.email), ip_address=ip_address)

        token = secrets.token_urlsafe(max(32, int(settings.AUTH_REGISTRATION_CONFIRM_TOKEN_BYTES)))
        cache_key = self._registration_confirm_cache_key(token)
        payload = json.dumps(
            {
                "email": str(data.email),
                "hashed_password": hash_password(data.password),
                "first_name": data.first_name,
                "last_name": data.last_name,
                "org_name": data.org_name,
            }
        )

        redis = await redis_client.get()
        try:
            await redis.setex(cache_key, int(settings.AUTH_REGISTRATION_CONFIRM_TOKEN_TTL_SECONDS), payload)
        except RedisError as exc:
            logger.exception("Failed to persist registration confirm token")
            raise AppError(
                code="REGISTRATION_CONFIRM_TOKEN_STORE_FAILED",
                message="Не удалось создать ссылку подтверждения. Попробуйте позже.",
                status_code=503,
            ) from exc

        confirm_url = f"{settings.FRONTEND_URL.rstrip('/')}/register?confirm_token={token}"
        subject = "Подтвердите регистрацию в CRM Platform"
        body = (
            "Вы запросили создание аккаунта в CRM Platform.\n\n"
            "Чтобы завершить регистрацию, перейдите по ссылке:\n"
            f"{confirm_url}\n\n"
            "Ссылка одноразовая и действует 30 минут.\n"
            "Если это были не вы, просто проигнорируйте это письмо.\n"
        )

        enqueue_result = queue_email_notification(
            to_email=str(data.email),
            subject=subject,
            body=body,
            kind="registration_confirm",
        )
        if not enqueue_result.queued:
            try:
                await redis.delete(cache_key)
            except RedisError:
                logger.exception("Failed to cleanup registration token after enqueue failure")
            raise AppError(
                code="REGISTRATION_CONFIRM_EMAIL_FAILED",
                message="Не удалось отправить письмо подтверждения. Попробуйте позже.",
                status_code=503,
            )

    async def confirm_registration(
        self,
        *,
        token: str,
        ip_address: str | None = None,
    ) -> tuple[User, Organization, TokenResponse]:
        cache_key = self._registration_confirm_cache_key(token)
        try:
            payload_raw = await self._consume_registration_confirm_payload(cache_key=cache_key)
        except RedisError as exc:
            logger.exception("Failed to consume registration confirm token")
            raise AppError(
                code="REGISTRATION_CONFIRM_TOKEN_READ_FAILED",
                message="Не удалось подтвердить регистрацию. Попробуйте позже.",
                status_code=503,
            ) from exc

        if not payload_raw:
            raise BadRequestError("Неверный токен подтверждения или срок его действия истек")

        try:
            payload = json.loads(payload_raw)
            email = str(payload["email"]).strip()
            hashed_password = str(payload["hashed_password"])
            first_name = str(payload["first_name"])
            last_name = str(payload["last_name"])
            org_name = str(payload["org_name"])
        except (TypeError, ValueError, KeyError) as exc:
            logger.exception("Failed to parse registration token payload")
            raise BadRequestError("Поврежденные данные подтверждения регистрации") from exc

        async with UnitOfWork() as uow:
            user_repo = UserRepository(uow.session)
            org_repo = OrganizationRepository(uow.session)
            member_repo = MembershipRepository(uow.session)
            token_repo = RefreshTokenRepository(uow.session)
            sub_repo = SubscriptionRepository(uow.session)
            audit_repo = AuditRepository(uow.session)

            existing = await user_repo.get_by_email(email)
            if existing:
                raise ConflictError("User with this email already exists", field="email")

            user, org, token_response = await self._register_new_org_with_password_hash(
                email=email,
                hashed_password=hashed_password,
                first_name=first_name,
                last_name=last_name,
                org_name=org_name,
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
        return await self._register_new_org_with_password_hash(
            email=str(data.email),
            hashed_password=hash_password(data.password),
            first_name=data.first_name,
            last_name=data.last_name,
            org_name=data.org_name,
            ip_address=ip_address,
            user_repo=user_repo,
            org_repo=org_repo,
            member_repo=member_repo,
            token_repo=token_repo,
            sub_repo=sub_repo,
            audit_repo=audit_repo,
        )

    async def _register_new_org_with_password_hash(
        self,
        *,
        email: str,
        hashed_password: str,
        first_name: str,
        last_name: str,
        org_name: str,
        ip_address: str | None,
        user_repo: UserRepository,
        org_repo: OrganizationRepository,
        member_repo: MembershipRepository,
        token_repo: RefreshTokenRepository,
        sub_repo: SubscriptionRepository,
        audit_repo: AuditRepository,
    ) -> tuple[User, Organization, TokenResponse]:
        user = User(
            email=email,
            hashed_password=hashed_password,
            first_name=first_name,
            last_name=last_name,
        )
        user = await user_repo.create(user)

        base_slug = slugify_org_name(org_name)
        slug = base_slug
        attempt = 0
        while await org_repo.get_by_slug(slug):
            attempt += 1
            slug = f"{base_slug}-{attempt}"

        org = Organization(name=org_name, slug=slug, plan=PlanTier.FREE)
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
