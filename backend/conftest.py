import os
import asyncio
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import settings
from src.infrastructure.database import get_async_session
import src.modules.superadmin.models  # noqa: F401

# Tests should not be rate-limited.
# Important: set flags before importing `src.main`, because middleware is wired at import time.
settings.ENABLE_RATE_LIMIT = False

from src.main import app  # noqa: E402


def _with_db(url: str, db_name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{db_name}", parts.query, parts.fragment))


# Use a dedicated database per test session to avoid cross-run enum/schema conflicts.
_default_test_db = f"{getattr(settings, 'POSTGRES_DB', 'crm_db')}_test_{uuid.uuid4().hex[:8]}"
TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL") or _with_db(settings.DATABASE_URL, _default_test_db)
TEST_DATABASE_URL_SYNC = os.getenv("TEST_DATABASE_URL_SYNC") or _with_db(settings.DATABASE_URL_SYNC, _default_test_db)
os.environ.setdefault("TEST_DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("TEST_DATABASE_URL_SYNC", TEST_DATABASE_URL_SYNC)


def _run_alembic_upgrade(db_url_sync: str) -> None:
    backend_dir = Path(__file__).resolve().parent
    alembic_ini = backend_dir / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url_sync)

    prev_sync = os.environ.get("DATABASE_URL_SYNC")
    os.environ["DATABASE_URL_SYNC"] = db_url_sync
    try:
        command.upgrade(alembic_cfg, "head")
    finally:
        if prev_sync is None:
            os.environ.pop("DATABASE_URL_SYNC", None)
        else:
            os.environ["DATABASE_URL_SYNC"] = prev_sync


async def _truncate_public_tables(engine) -> None:
    async with engine.begin() as conn:
        rows = await conn.execute(
            text(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = 'public'
                  AND tablename <> 'alembic_version'
                ORDER BY tablename
                """
            )
        )
        table_names = [f'"public"."{name}"' for (name,) in rows]
        if table_names:
            await conn.execute(text(f"TRUNCATE TABLE {', '.join(table_names)} RESTART IDENTITY CASCADE"))


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    admin_url = _with_db(TEST_DATABASE_URL_SYNC, "postgres")
    eng = create_sync_engine(admin_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    with eng.connect() as conn:
        conn.execute(
            text(
                """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = :name
                  AND pid <> pg_backend_pid()
                """
            ),
            {"name": _default_test_db},
        )
        conn.execute(text(f'DROP DATABASE IF EXISTS "{_default_test_db}"'))
        conn.execute(text(f'CREATE DATABASE "{_default_test_db}"'))
    eng.dispose()

    _run_alembic_upgrade(TEST_DATABASE_URL_SYNC)

    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    try:
        yield loop
    finally:
        loop.close()


@pytest_asyncio.fixture(autouse=True)
async def reset_db(test_engine):
    await _truncate_public_tables(test_engine)
    yield
    await _truncate_public_tables(test_engine)


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
