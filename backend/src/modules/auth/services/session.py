from __future__ import annotations

from src.common.enums import AuditAction
from src.common.exceptions import UnauthorizedError
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.auth.models import RefreshToken, User
from src.modules.auth.repository import RefreshTokenRepository, UserRepository
from src.modules.auth.schemas import TokenResponse
from src.modules.auth.security import (
    create_access_token,
    create_refresh_token,
    hash_token,
    refresh_token_expires_at,
    verify_password,
)
from src.modules.auth.services.utils import build_token_response
from src.modules.org.repository import MembershipRepository


class AuthSessionService:
    """Session lifecycle use-cases: login, refresh, logout."""

    async def login(
        self,
        email: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, TokenResponse]:
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
            await token_repo.create(
                RefreshToken(
                    user_id=user.id,
                    token_hash=refresh_hash,
                    expires_at=refresh_token_expires_at(),
                    ip_address=ip_address,
                    user_agent=user_agent,
                )
            )

            access_token = create_access_token(user.id, org_id, role)

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
            return user, build_token_response(access_token=access_token, refresh_token=raw_refresh)

    async def refresh(self, raw_refresh: str, ip_address: str | None = None) -> TokenResponse:
        async with UnitOfWork() as uow:
            token_repo = RefreshTokenRepository(uow.session)
            member_repo = MembershipRepository(uow.session)

            token_hash_value = hash_token(raw_refresh)
            refresh_token = await token_repo.get_by_hash(token_hash_value)
            if not refresh_token:
                raise UnauthorizedError("Invalid or expired refresh token")

            await token_repo.revoke(refresh_token.id)

            memberships = await member_repo.get_user_memberships(refresh_token.user_id)
            org_id = memberships[0].org_id if memberships else None
            role = memberships[0].role.value if memberships else None

            new_raw_refresh, new_hash = create_refresh_token()
            await token_repo.create(
                RefreshToken(
                    user_id=refresh_token.user_id,
                    token_hash=new_hash,
                    expires_at=refresh_token_expires_at(),
                    ip_address=ip_address,
                )
            )

            access_token = create_access_token(refresh_token.user_id, org_id, role)

            await uow.commit()
            return build_token_response(access_token=access_token, refresh_token=new_raw_refresh)

    async def logout(self, raw_refresh: str) -> None:
        async with UnitOfWork() as uow:
            token_repo = RefreshTokenRepository(uow.session)
            token_hash_value = hash_token(raw_refresh)
            refresh_token = await token_repo.get_by_hash(token_hash_value)
            if refresh_token:
                await token_repo.revoke(refresh_token.id)
            await uow.commit()

