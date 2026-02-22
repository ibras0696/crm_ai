from __future__ import annotations

import uuid

from src.modules.auth.models import User
from src.modules.auth.schemas import RegisterRequest, TokenResponse
from src.modules.auth.services import AuthProfileService, AuthRegistrationService, AuthSessionService
from src.modules.org.models import Organization


class AuthService:
    """Auth facade to keep stable public API while using split internal services."""

    def __init__(
        self,
        *,
        registration_service: AuthRegistrationService | None = None,
        session_service: AuthSessionService | None = None,
        profile_service: AuthProfileService | None = None,
    ):
        self._registration = registration_service or AuthRegistrationService()
        self._session = session_service or AuthSessionService()
        self._profile = profile_service or AuthProfileService()

    async def register(self, data: RegisterRequest, ip_address: str | None = None) -> tuple[User, Organization, TokenResponse]:
        return await self._registration.register(data, ip_address=ip_address)

    async def login(
        self,
        email: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, TokenResponse]:
        return await self._session.login(email, password, ip_address=ip_address, user_agent=user_agent)

    async def refresh(self, raw_refresh: str, ip_address: str | None = None) -> TokenResponse:
        return await self._session.refresh(raw_refresh, ip_address=ip_address)

    async def logout(self, raw_refresh: str) -> None:
        await self._session.logout(raw_refresh)

    async def get_user(self, user_id: uuid.UUID) -> User | None:
        return await self._profile.get_user(user_id)
