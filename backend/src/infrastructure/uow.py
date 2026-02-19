from sqlalchemy.ext.asyncio import AsyncSession

from src.infrastructure.database import async_session_factory


class UnitOfWork:
    """Unit of Work pattern — single commit/rollback point per business operation."""

    def __init__(self, session_factory=async_session_factory):
        self._session_factory = session_factory
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> "UnitOfWork":
        self.session = self._session_factory()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            await self.rollback()
        await self.session.close()

    async def commit(self):
        await self.session.commit()

    async def rollback(self):
        await self.session.rollback()
