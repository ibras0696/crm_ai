from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
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
        "ai_max_tokens_per_request": int(getattr(settings, "AI_MAX_TOKENS_PER_REQUEST", 0) or 0),
        "ai_tokens_per_day": int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        "ai_rpm_per_user": int(getattr(settings, "AI_RPM_PER_USER_FREE", 0) or 0),
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
        "ai_max_tokens_per_request": int(getattr(settings, "AI_MAX_TOKENS_PER_REQUEST", 0) or 0),
        "ai_tokens_per_day": int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        "ai_rpm_per_user": int(getattr(settings, "AI_RPM_PER_USER_TEAM", 0) or 0),
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
        "ai_max_tokens_per_request": int(getattr(settings, "AI_MAX_TOKENS_PER_REQUEST", 0) or 0),
        "ai_tokens_per_day": int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
        "ai_rpm_per_user": int(getattr(settings, "AI_RPM_PER_USER_BUSINESS", 0) or 0),
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
