from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.billing.models import Plan


DEFAULT_PLANS: list[dict] = [
    {
        "name": "free",
        "display_name": "Бесплатный",
        "price_monthly": 0,
        "price_yearly": 0,
        "max_members": 10,
        "max_tables": 10,
        "max_records": 10000,
        "max_storage_mb": 500,
        # AI доступен, но с лимитами (лимиты настраиваются в config).
        "has_ai": True,
        "features": {"search": True, "filter": True, "export_csv": True, "ai": True},
        "is_active": True,
    },
    {
        "name": "team",
        "display_name": "Команда",
        "price_monthly": 149000,
        "price_yearly": 1190000,
        "max_members": 50,
        "max_tables": 100,
        "max_records": 200000,
        "max_storage_mb": 10240,
        "has_ai": True,
        "features": {"search": True, "filter": True, "export_csv": True, "ai": True},
        "is_active": True,
    },
    {
        "name": "business",
        "display_name": "Бизнес",
        "price_monthly": 499000,
        "price_yearly": 3990000,
        "max_members": 200,
        "max_tables": 500,
        "max_records": 2000000,
        "max_storage_mb": 102400,
        "has_ai": True,
        "features": {"search": True, "filter": True, "export_csv": True, "ai": True, "priority_support": True},
        "is_active": True,
    },
]


async def upsert_default_plans(session: AsyncSession) -> None:
    for data in DEFAULT_PLANS:
        name = data["name"]
        plan = (
            await session.execute(select(Plan).where(Plan.name == name))
        ).scalars().first()

        if plan is None:
            session.add(Plan(**data))
            continue

        # Update fields (idempotent seed)
        for k, v in data.items():
            setattr(plan, k, v)
