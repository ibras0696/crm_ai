"""Seed default plans (idempotent)."""

import asyncio

from src.infrastructure.database import async_session_factory
from src.modules.billing.seed import upsert_default_plans


async def seed() -> None:
    async with async_session_factory() as session:
        await upsert_default_plans(session)
        await session.commit()
        print("[seed] Plans seeded OK")


if __name__ == "__main__":
    asyncio.run(seed())

