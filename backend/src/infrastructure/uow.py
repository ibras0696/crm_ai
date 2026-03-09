from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession


class UnitOfWork:
    """Unit of Work pattern - single commit/rollback point per business operation."""

    def __init__(self, session_factory=None):
        # Important for tests: do not capture async_session_factory at import time.
        # Tests can patch src.infrastructure.database.async_session_factory and
        # UnitOfWork will pick it up here.
        if session_factory is None:
            from src.infrastructure.database import async_session_factory as _factory

            session_factory = _factory
        self._session_factory = session_factory
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> UnitOfWork:
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
