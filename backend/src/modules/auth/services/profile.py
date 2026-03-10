from __future__ import annotations

from typing import TYPE_CHECKING

from src.infrastructure.uow import UnitOfWork
from src.modules.auth.repository import UserRepository

if TYPE_CHECKING:
    import uuid

    from src.modules.auth.models import User
    from src.modules.auth.schemas import UpdateMeRequest


class AuthProfileService:
    """Profile read use-cases."""

    async def get_user(self, user_id: uuid.UUID) -> User | None:
        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            return await repo.get_by_id(user_id)

    async def update_user(self, user_id: uuid.UUID, body: UpdateMeRequest) -> User | None:
        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            user = await repo.get_by_id(user_id)
            if not user:
                return None

            updates = body.model_dump(exclude_unset=True)
            if "first_name" in updates and updates["first_name"] is not None:
                user.first_name = str(updates["first_name"]).strip()
            if "last_name" in updates and updates["last_name"] is not None:
                user.last_name = str(updates["last_name"]).strip()
            if "timezone" in updates and updates["timezone"] is not None:
                user.timezone = str(updates["timezone"]).strip()

            await repo.update(user)
            await uow.commit()
            return user
