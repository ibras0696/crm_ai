from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.modules.ai.models import AIOrgLimit, AIUsageLog, AIUserLimit
from src.modules.billing.models import Plan
from src.modules.billing.token_wallet import get_token_balance_view
from src.modules.org.models import Organization, Subscription

logger = logging.getLogger(__name__)


def _as_plan_tier(value: Any) -> PlanTier | None:
    """Безопасно преобразовать произвольное значение в PlanTier.

    Args:
        value: Значение enum/строки/объекта с `.value`.

    Returns:
        PlanTier или None, если преобразование невозможно.
    """
    if value is None:
        return None
    if isinstance(value, PlanTier):
        return value
    raw = value.value if hasattr(value, "value") else value
    try:
        return PlanTier(str(raw))
    except Exception:
        return None


def resolve_plan_limits(plan: PlanTier, plan_db: Plan | None = None) -> dict[str, int]:
    """Рассчитать итоговые лимиты для плана (settings -> optional DB override).

    Источник правды:
    1. Таблица `plans` (если есть активная запись и значения > 0).
    2. Иначе fallback на `settings`.

    Значение `0` трактуется как "без ограничения" (unlimited).

    Args:
        plan: Эффективный тариф организации.
        plan_db: Запись плана из БД (опционально).

    Returns:
        Словарь с лимитами:
        - daily_tokens
        - rpm_per_user
        - max_tokens_per_request
    """
    daily_limit_by_plan = {
        PlanTier.FREE: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        PlanTier.TEAM: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        PlanTier.BUSINESS: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
    }
    rpm_limit_by_plan = {
        PlanTier.FREE: int(getattr(settings, "AI_RPM_PER_USER_FREE", 0) or 0),
        PlanTier.TEAM: int(getattr(settings, "AI_RPM_PER_USER_TEAM", 0) or 0),
        PlanTier.BUSINESS: int(getattr(settings, "AI_RPM_PER_USER_BUSINESS", 0) or 0),
    }

    limits = {
        "daily_tokens": int(daily_limit_by_plan.get(plan) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0)),
        "rpm_per_user": int(rpm_limit_by_plan.get(plan) or int(settings.AI_RPM_PER_USER or 0)),
        "max_tokens_per_request": int(settings.AI_MAX_TOKENS_PER_REQUEST or 0),
    }

    if plan_db:
        if int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
            limits["daily_tokens"] = int(plan_db.ai_tokens_per_day)
        if int(getattr(plan_db, "ai_rpm_per_user", 0) or 0) > 0:
            limits["rpm_per_user"] = int(plan_db.ai_rpm_per_user)
        if int(getattr(plan_db, "ai_max_tokens_per_request", 0) or 0) > 0:
            limits["max_tokens_per_request"] = int(plan_db.ai_max_tokens_per_request)

    return limits


async def resolve_org_plan(session, *, org_id) -> PlanTier:
    """Определить эффективный тариф организации.

    Источник правды:
    1. Активная подписка (если есть).
    2. `Organization.plan` (legacy/fallback).

    Args:
        session: Async SQLAlchemy session.
        org_id: ID организации.

    Returns:
        План (PlanTier) который должен применяться к лимитам.
    """
    # 1) Active subscription.
    try:
        sub_plan = (
            (
                await session.execute(
                    select(Subscription.plan)
                    .where(
                        Subscription.org_id == org_id,
                        Subscription.status == SubscriptionStatus.ACTIVE,
                    )
                    .order_by(Subscription.updated_at.desc())
                )
            )
            .scalars()
            .first()
        )
        tier = _as_plan_tier(sub_plan)
        if tier is not None:
            return tier
    except Exception as exc:
        logger.exception("ai_resolve_plan_subscription_failed", exc_info=exc)

    # 2) Org.plan (legacy).
    try:
        plan_row = (
            await session.execute(select(Organization.plan).where(Organization.id == org_id))
        ).scalar_one_or_none()
        tier = _as_plan_tier(plan_row)
        if tier is not None:
            return tier
    except Exception as exc:
        logger.exception("ai_resolve_plan_org_failed", exc_info=exc)

    return PlanTier.FREE


async def is_org_ai_enabled(session, *, org_id) -> bool:
    """Проверить org-level флаг доступности AI.

    Args:
        session: Async SQLAlchemy session.
        org_id: ID организации.

    Returns:
        True, если AI включен для организации, иначе False.
    """
    try:
        ai_enabled = (
            await session.execute(select(Organization.ai_enabled).where(Organization.id == org_id))
        ).scalar_one_or_none()
        # Для старых данных/временных миграционных состояний по умолчанию считаем включенным.
        if ai_enabled is None:
            return True
        return bool(ai_enabled)
    except Exception as exc:
        logger.exception("ai_org_enabled_lookup_failed", exc_info=exc)
        # Fail-open для чтения статуса: если lookup недоступен, не блокируем трафик.
        return True


async def check_ai_limits(session, *, org_id, user_id, estimated_request_tokens: int) -> tuple[bool, dict | None]:
    """Проверить лимиты использования AI (cost control).

    Ограничения:
    - RPM на пользователя (запросов/мин).
    - Токены/день на организацию.

    Args:
        session: Async SQLAlchemy session.
        org_id: ID организации.
        user_id: ID пользователя.
        estimated_request_tokens: Оценка количества токенов, которое может потребоваться
            на этот запрос (prompt + completion), чтобы предсказать лимит заранее.

    Returns:
        (ok, error):
        - ok=True если запрос разрешен.
        - ok=False если лимит превышен; error содержит структуру ApiResponse.error.
    """
    plan: PlanTier = await resolve_org_plan(session, org_id=org_id)

    plan_db = None
    try:
        plan_db = (
            (await session.execute(select(Plan).where(Plan.name == plan.value, Plan.is_active.is_(True))))
            .scalars()
            .first()
        )
    except Exception as exc:
        logger.exception("ai_limits_plan_db_lookup_failed", exc_info=exc)

    limits = resolve_plan_limits(plan, plan_db)
    daily_limit = int(limits["daily_tokens"])
    rpm_limit = int(limits["rpm_per_user"])

    org_custom = (
        (await session.execute(select(AIOrgLimit).where(AIOrgLimit.org_id == org_id).limit(1))).scalars().first()
    )
    user_custom = (
        (
            await session.execute(
                select(AIUserLimit).where(AIUserLimit.org_id == org_id, AIUserLimit.user_id == user_id).limit(1)
            )
        )
        .scalars()
        .first()
    )

    org_daily_override = int(org_custom.daily_tokens_limit if org_custom else 0)
    org_monthly_override = int(org_custom.monthly_tokens_limit if org_custom else 0)
    user_daily_override = int(user_custom.daily_tokens_limit if user_custom else 0)
    user_rpm_override = int(user_custom.rpm_limit if user_custom else 0)

    effective_rpm_limit = user_rpm_override if user_rpm_override > 0 else rpm_limit

    # RPM per user
    now = datetime.now(UTC)
    window_start = now - timedelta(seconds=60)
    day_start = datetime(now.year, now.month, now.day, tzinfo=UTC)
    month_start = datetime(now.year, now.month, 1, tzinfo=UTC)

    # Важно: текущая реализация лимитов — soft-limit.
    # При высокой параллельности возможны небольшие "проскоки", т.к. check и запись
    # usage выполняются в разных транзакциях.
    if effective_rpm_limit > 0:
        reqs_last_min = (
            await session.execute(
                select(func.count(AIUsageLog.id)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.user_id == user_id,
                    AIUsageLog.created_at >= window_start,
                )
            )
        ).scalar_one()
        if int(reqs_last_min) >= effective_rpm_limit:
            return False, {
                "code": "AI_USER_RATE_LIMIT",
                "message": f"Превышен лимит запросов сотрудника к AI ({effective_rpm_limit}/мин). Подождите минуту.",
            }

    projected = int(max(0, estimated_request_tokens))

    if org_daily_override > 0:
        org_today_tokens = (
            await session.execute(
                select(func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.created_at >= day_start,
                )
            )
        ).scalar_one()
        remaining_org_daily = int(org_daily_override - int(org_today_tokens or 0))
        if projected > max(0, remaining_org_daily):
            return False, {
                "code": "AI_ORG_DAILY_LIMIT_EXCEEDED",
                "message": "Превышен дневной лимит AI для организации.",
                "details": {
                    "limit": org_daily_override,
                    "used": int(org_today_tokens or 0),
                    "remaining": max(0, remaining_org_daily),
                    "required_tokens": projected,
                },
            }

    if org_monthly_override > 0:
        org_month_tokens = (
            await session.execute(
                select(func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.created_at >= month_start,
                )
            )
        ).scalar_one()
        remaining_org_monthly = int(org_monthly_override - int(org_month_tokens or 0))
        if projected > max(0, remaining_org_monthly):
            return False, {
                "code": "AI_ORG_MONTHLY_LIMIT_EXCEEDED",
                "message": "Превышен месячный лимит AI для организации.",
                "details": {
                    "limit": org_monthly_override,
                    "used": int(org_month_tokens or 0),
                    "remaining": max(0, remaining_org_monthly),
                    "required_tokens": projected,
                },
            }

    if user_daily_override > 0:
        user_today_tokens = (
            await session.execute(
                select(func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.user_id == user_id,
                    AIUsageLog.created_at >= day_start,
                )
            )
        ).scalar_one()
        remaining_user_daily = int(user_daily_override - int(user_today_tokens or 0))
        if projected > max(0, remaining_user_daily):
            return False, {
                "code": "AI_USER_DAILY_LIMIT_EXCEEDED",
                "message": "Превышен персональный дневной лимит AI для сотрудника.",
                "details": {
                    "limit": user_daily_override,
                    "used": int(user_today_tokens or 0),
                    "remaining": max(0, remaining_user_daily),
                    "required_tokens": projected,
                },
            }

    # Monthly tokens per org (plan wallet + purchased addon wallet).
    # Название daily_limit сохранено для обратной совместимости с текущими структурами plan/settings.
    if daily_limit > 0:
        wallet = await get_token_balance_view(session, org_id=org_id)
        available = int(wallet["total_tokens_remaining"])
        if projected > available:
            return False, {
                "code": "AI_TOKEN_LIMIT_EXCEEDED",
                "message": "Лимит токенов исчерпан.",
                "details": {
                    "required_tokens": projected,
                    "remaining_total": available,
                    "remaining_addon": int(wallet["addon_tokens_remaining"]),
                    "remaining_plan": int(wallet["plan_tokens_remaining"]),
                    "cycle_key": wallet["cycle_key"],
                },
            }

    return True, None
