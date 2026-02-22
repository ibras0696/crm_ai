from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

from src.config import settings
from src.infrastructure.bootstrap_lock import advisory_lock
from src.infrastructure.database import async_session_factory
from src.modules.billing.seed import upsert_default_plans


BOOTSTRAP_LOCK_KEY = 914_270_001  # stable int for pg_advisory_lock


def _alembic_config() -> Config:
    # In docker image/workdir it's /app/alembic.ini
    # In local runs, cwd might differ, so resolve relative to this file.
    backend_root = Path(__file__).resolve().parents[2]  # backend/src/cli/bootstrap.py -> backend/
    ini_path = backend_root / "alembic.ini"
    cfg = Config(str(ini_path))
    # Alembic env.py reads DATABASE_URL_SYNC from env, so just ensure it's set.
    return cfg


def _database_url_sync() -> str:
    if settings.DATABASE_URL_SYNC:
        return settings.DATABASE_URL_SYNC
    # Fallback: derive sync URL from async URL (best-effort)
    return settings.DATABASE_URL.replace("+asyncpg", "")


async def _run_seed() -> None:
    async with async_session_factory() as session:
        await upsert_default_plans(session)
        await session.commit()


def _run_migrations() -> None:
    cfg = _alembic_config()
    command.upgrade(cfg, "head")


async def main() -> None:
    db_sync = _database_url_sync()
    async with advisory_lock(db_sync, BOOTSTRAP_LOCK_KEY):
        # Run migrations (sync, fast, protected by advisory lock).
        await asyncio.to_thread(_run_migrations)
        # Seed (async).
        await _run_seed()


if __name__ == "__main__":
    asyncio.run(main())

