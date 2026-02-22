from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select

from src.config import settings
from src.common.enums import PlanTier, SubscriptionStatus
from src.modules.ai.models import AIUsageLog
from src.modules.billing.models import Plan
from src.modules.org.models import Organization, Subscription

logger = logging.getLogger(__name__)


def _utc_day_start(dt: datetime) -> datetime:
    """Вернуть начало дня (00:00) в UTC для указанной даты-времени.

    Args:
        dt: Дата-время (любая TZ).

    Returns:
        Дата-время начала дня в UTC.
    """
    dt = dt.astimezone(timezone.utc)
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)


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
            await session.execute(
                select(Subscription.plan).where(
                    Subscription.org_id == org_id,
                    Subscription.status == SubscriptionStatus.ACTIVE,
                ).order_by(Subscription.updated_at.desc())
            )
        ).scalars().first()
        tier = _as_plan_tier(sub_plan)
        if tier is not None:
            return tier
    except Exception as exc:
        logger.exception("ai_resolve_plan_subscription_failed", exc_info=exc)

    # 2) Org.plan (legacy).
    try:
        plan_row = (await session.execute(select(Organization.plan).where(Organization.id == org_id))).scalar_one_or_none()
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
            await session.execute(
                select(Organization.ai_enabled).where(Organization.id == org_id)
            )
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
            await session.execute(select(Plan).where(Plan.name == plan.value, Plan.is_active.is_(True)))
        ).scalars().first()
    except Exception as exc:
        logger.exception("ai_limits_plan_db_lookup_failed", exc_info=exc)

    limits = resolve_plan_limits(plan, plan_db)
    daily_limit = int(limits["daily_tokens"])
    rpm_limit = int(limits["rpm_per_user"])

    # RPM per user
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=60)

    # Важно: текущая реализация лимитов — soft-limit.
    # При высокой параллельности возможны небольшие "проскоки", т.к. check и запись
    # usage выполняются в разных транзакциях.
    if rpm_limit > 0:
        reqs_last_min = (
            await session.execute(
                select(func.count(AIUsageLog.id)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.user_id == user_id,
                    AIUsageLog.created_at >= window_start,
                )
            )
        ).scalar_one()
        if int(reqs_last_min) >= rpm_limit:
            return False, {
                "code": "AI_RATE_LIMIT",
                "message": f"Слишком много запросов к AI (лимит {rpm_limit}/мин). Подождите минуту и попробуйте снова.",
            }

    # Tokens/day per org
    if daily_limit > 0:
        day_start = _utc_day_start(now)
        used_today = (
            await session.execute(
                select(func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.created_at >= day_start,
                )
            )
        ).scalar_one()
        projected = int(used_today or 0) + int(max(0, estimated_request_tokens))
        if projected > daily_limit:
            return False, {
                "code": "AI_DAILY_LIMIT",
                "message": f"Достигнут дневной лимит токенов ({int(used_today or 0)}/{daily_limit}).",
            }

    return True, None
