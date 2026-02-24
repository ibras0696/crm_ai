from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy import create_engine

from src.config import settings
from src.infrastructure.bootstrap_lock import advisory_lock
from src.infrastructure.database import async_session_factory
from src.modules.billing.seed import upsert_default_plans, upsert_default_token_packages


BOOTSTRAP_LOCK_KEY = 914_270_001  # stable int for pg_advisory_lock


def _alembic_config() -> Config:
    # In docker image/workdir it's /app/alembic.ini
    # In local runs, cwd might differ, so resolve relative to this file.
    backend_root = Path(__file__).resolve().parents[2]  # backend/src/cli/bootstrap.py -> backend/
    ini_path = backend_root / "alembic.ini"
    cfg = Config(str(ini_path))
    # Ensure Alembic points to the right DB even if alembic.ini has dev defaults.
    cfg.set_main_option("sqlalchemy.url", _database_url_sync())
    return cfg


def _database_url_sync() -> str:
    if settings.DATABASE_URL_SYNC:
        return settings.DATABASE_URL_SYNC
    # Fallback: derive sync URL from async URL (best-effort)
    return settings.DATABASE_URL.replace("+asyncpg", "")


async def _run_seed() -> None:
    async with async_session_factory() as session:
        await upsert_default_plans(session)
        await upsert_default_token_packages(session)
        await session.commit()


def _run_migrations() -> None:
    cfg = _alembic_config()
    # Self-heal dev DBs that accidentally have alembic_version stamped but no tables.
    # This situation can happen if volumes were reused between different env configs.
    url = cfg.get_main_option("sqlalchemy.url")
    if url:
        try:
            eng = create_engine(url, pool_pre_ping=True)
            with eng.connect() as conn:
                # Count any user tables except alembic_version.
                n = conn.execute(
                    text(
                        """
                        select count(*)::int
                        from information_schema.tables
                        where table_schema = 'public'
                          and table_type = 'BASE TABLE'
                          and table_name <> 'alembic_version'
                        """
                    )
                ).scalar_one()
                if int(n or 0) == 0:
                    # Reset stamp to base, then upgrade to head.
                    command.stamp(cfg, "base")
        except Exception:
            # Don't block migrations on probe issues.
            pass

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
