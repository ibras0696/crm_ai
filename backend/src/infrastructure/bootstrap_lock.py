from __future__ import annotations

import contextlib

import asyncpg


def _normalize_asyncpg_dsn(dsn: str) -> str:
    # Accept SQLAlchemy-style URLs like `postgresql+psycopg2://...`
    # and convert them to asyncpg-compatible DSN.
    if dsn.startswith("postgresql+"):
        return "postgresql://" + dsn.split("://", 1)[1]
    if dsn.startswith("postgres+"):
        return "postgres://" + dsn.split("://", 1)[1]
    return dsn


@contextlib.asynccontextmanager
async def advisory_lock(database_url_sync: str, lock_key: int):
    conn = await asyncpg.connect(_normalize_asyncpg_dsn(database_url_sync))
    try:
        await conn.execute("SELECT pg_advisory_lock($1)", lock_key)
        try:
            yield
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", lock_key)
    finally:
        await conn.close()
