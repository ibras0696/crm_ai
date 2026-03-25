from __future__ import annotations

import asyncio
import socket
import time
from pathlib import Path
from typing import TYPE_CHECKING

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, OperationalError

from src.config import settings
from src.infrastructure.bootstrap_lock import advisory_lock
from src.infrastructure.database import async_session_factory
from src.modules.billing.seed import upsert_default_plans, upsert_default_token_packages

if TYPE_CHECKING:
    from collections.abc import Callable

BOOTSTRAP_LOCK_KEY = 914_270_001  # stable int for pg_advisory_lock
DB_STARTUP_TIMEOUT_SECONDS = 90
DB_STARTUP_POLL_SECONDS = 2.0


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


def _extract_db_host_port(url: str) -> tuple[str | None, int]:
    parsed = make_url(url)
    host = parsed.host
    port = int(parsed.port or 5432)
    return host, port


def _probe_db_connection(url: str) -> None:
    parsed = make_url(url)
    engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
    if parsed.get_backend_name().startswith("postgresql"):
        engine_kwargs["connect_args"] = {"connect_timeout": 3}
    eng = create_engine(url, **engine_kwargs)
    try:
        with eng.connect() as conn:
            conn.execute(text("select 1"))
    finally:
        eng.dispose()


def _wait_for_db_ready(
    url: str,
    timeout_seconds: int = DB_STARTUP_TIMEOUT_SECONDS,
    interval_seconds: float = DB_STARTUP_POLL_SECONDS,
    *,
    dns_probe: Callable[[str, int], object] | None = None,
    db_probe: Callable[[str], None] | None = None,
    sleep_fn: Callable[[float], None] | None = None,
    now_fn: Callable[[], float] | None = None,
) -> None:
    dns_probe = dns_probe or (lambda host, port: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
    db_probe = db_probe or _probe_db_connection
    sleep_fn = sleep_fn or time.sleep
    now_fn = now_fn or time.monotonic

    host, port = _extract_db_host_port(url)
    deadline = now_fn() + timeout_seconds
    attempt = 0
    last_exc: Exception | None = None

    while now_fn() < deadline:
        attempt += 1
        try:
            if host:
                dns_probe(host, port)
            db_probe(url)
            print(f"[bootstrap] database reachable (attempt={attempt}, host={host or 'n/a'}, port={port})")
            return
        except (socket.gaierror, OSError, OperationalError, DBAPIError) as exc:
            last_exc = exc
            print(f"[bootstrap] waiting for database (attempt={attempt}): {type(exc).__name__}: {exc}")
            sleep_fn(interval_seconds)

    raise RuntimeError(
        f"database is not reachable after {timeout_seconds}s "
        f"(host={host or 'n/a'}, port={port})"
    ) from last_exc


async def _run_seed() -> None:
    async with async_session_factory() as session:
        await upsert_default_plans(session)
        await upsert_default_token_packages(session)
        await session.commit()


def _reset_alembic_version_to_head(*, url: str, head_revision: str) -> None:
    eng = create_engine(url, pool_pre_ping=True)
    try:
        with eng.begin() as conn:
            conn.execute(
                text(
                    """
                    create table if not exists alembic_version (
                        version_num varchar(32) not null
                    )
                    """
                )
            )
            conn.execute(text("delete from alembic_version"))
            conn.execute(text("insert into alembic_version(version_num) values (:rev)"), {"rev": head_revision})
    finally:
        eng.dispose()


def _clear_alembic_version(*, url: str) -> None:
    eng = create_engine(url, pool_pre_ping=True)
    try:
        with eng.begin() as conn:
            conn.execute(
                text(
                    """
                    create table if not exists alembic_version (
                        version_num varchar(32) not null
                    )
                    """
                )
            )
            conn.execute(text("delete from alembic_version"))
    finally:
        eng.dispose()


def _run_migrations() -> None:
    cfg = _alembic_config()
    # Self-heal dev DBs that accidentally have alembic_version stamped but no tables.
    # This situation can happen if volumes were reused between different env configs.
    url = cfg.get_main_option("sqlalchemy.url")
    user_tables = 0
    if url:
        try:
            eng = create_engine(url, pool_pre_ping=True)
            with eng.connect() as conn:
                # Count any user tables except alembic_version.
                user_tables = int(
                    conn.execute(
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
                    or 0
                )
                if user_tables == 0:
                    # Reset stamp to base, then upgrade to head.
                    command.stamp(cfg, "base")
        except Exception:
            # Don't block migrations on probe issues.
            pass

    try:
        command.upgrade(cfg, "head")
    except CommandError as exc:
        message = str(exc)
        if "Can't locate revision identified by" not in message:
            raise

        if not url:
            raise

        head_revision = ScriptDirectory.from_config(cfg).get_current_head()
        if not head_revision:
            raise

        # Recovered migration history (single 0001) + existing populated schema:
        # set current DB as head and continue bootstrap.
        if user_tables > 0:
            _reset_alembic_version_to_head(url=url, head_revision=head_revision)
            return

        _clear_alembic_version(url=url)
        command.upgrade(cfg, "head")


async def main() -> None:
    db_sync = _database_url_sync()
    await asyncio.to_thread(_wait_for_db_ready, db_sync)
    async with advisory_lock(db_sync, BOOTSTRAP_LOCK_KEY):
        # Run migrations (sync, fast, protected by advisory lock).
        await asyncio.to_thread(_run_migrations)
        # Seed (async).
        await _run_seed()


if __name__ == "__main__":
    asyncio.run(main())
