from __future__ import annotations

import asyncio

from src.cli.bootstrap import BOOTSTRAP_LOCK_KEY, _database_url_sync, _run_migrations, _wait_for_db_ready
from src.infrastructure.bootstrap_lock import advisory_lock


async def main() -> None:
    db_sync = _database_url_sync()
    await asyncio.to_thread(_wait_for_db_ready, db_sync)
    async with advisory_lock(db_sync, BOOTSTRAP_LOCK_KEY):
        await asyncio.to_thread(_run_migrations)


if __name__ == "__main__":
    asyncio.run(main())
