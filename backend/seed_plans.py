"""Seed default plans if they don't exist."""
import asyncio
from src.infrastructure.database import async_session_factory
from src.modules.billing.models import Plan
from sqlalchemy import select


async def seed():
    async with async_session_factory() as session:
        existing = (await session.execute(select(Plan))).scalars().first()
        if existing:
            print("[seed] Plans already exist, skipping")
            return
        session.add(Plan(
            name='free', display_name='Бесплатный',
            price_monthly=0, price_yearly=0,
            max_members=10, max_tables=10, max_records=10000, max_storage_mb=500,
            has_ai=False, features={'search': True, 'filter': True, 'export_csv': True},
            is_active=True,
        ))
        session.add(Plan(
            name='team', display_name='Команда',
            price_monthly=149000, price_yearly=1190000,
            max_members=999999, max_tables=999999, max_records=999999999, max_storage_mb=999999,
            has_ai=True, features={'search': True, 'filter': True, 'export_csv': True, 'ai': True},
            is_active=True,
        ))
        await session.commit()
        print("[seed] Plans seeded OK")


if __name__ == "__main__":
    asyncio.run(seed())
