from __future__ import annotations

import uuid

from src.infrastructure.uow import UnitOfWork
from src.modules.auth.models import User
from src.modules.auth.repository import UserRepository


class AuthProfileService:
    """Profile read use-cases."""

    async def get_user(self, user_id: uuid.UUID) -> User | None:
        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            return await repo.get_by_id(user_id)

