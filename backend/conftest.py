import os
import uuid
from collections.abc import AsyncGenerator
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings
from src.infrastructure.database import Base, get_async_session
import src.modules.superadmin.models  # noqa: F401

# Tests should not be rate-limited.
# Important: set flags before importing `src.main`, because middleware is wired at import time.
settings.ENABLE_RATE_LIMIT = False

from src.main import app  # noqa: E402


def _with_db(url: str, db_name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{db_name}", parts.query, parts.fragment))


# Always use a separate test database to avoid destroying dev/prod data.
_default_test_db = f"{getattr(settings, 'POSTGRES_DB', 'crm_db')}_test"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL") or _with_db(settings.DATABASE_URL, _default_test_db)
TEST_DATABASE_URL_SYNC = os.getenv("TEST_DATABASE_URL_SYNC") or _with_db(settings.DATABASE_URL_SYNC, _default_test_db)


@pytest_asyncio.fixture
async def test_engine():
    # Ensure test database exists (idempotent).
    admin_url = _with_db(TEST_DATABASE_URL_SYNC, "postgres")
    eng = create_sync_engine(admin_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    with eng.connect() as conn:
        exists = conn.execute(text("select 1 from pg_database where datname = :name"), {"name": _default_test_db}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{_default_test_db}"'))
    eng.dispose()

    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(test_engine) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client for API tests."""
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_async_session] = _override_session

    # Patch UnitOfWork/session_factory to use the same test engine.
    import src.infrastructure.database as db

    orig_engine = db.engine
    orig_factory = db.async_session_factory
    db.engine = test_engine
    db.async_session_factory = session_factory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    db.engine = orig_engine
    db.async_session_factory = orig_factory


@pytest.fixture
def random_email() -> str:
    return f"test-{uuid.uuid4().hex[:8]}@example.com"
