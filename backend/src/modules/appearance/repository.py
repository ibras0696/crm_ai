import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import UserAppearance


class AppearanceRepository:
    async def get(self, session: AsyncSession, user_id: uuid.UUID) -> UserAppearance | None:
        result = await session.execute(
            select(UserAppearance).where(UserAppearance.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def upsert(self, session: AsyncSession, user_id: uuid.UUID, data: dict) -> UserAppearance:
        row = await self.get(session, user_id)
        if row is None:
            row = UserAppearance(user_id=user_id)
            session.add(row)
        for key, value in data.items():
            setattr(row, key, value)
        await session.flush()
        return row
