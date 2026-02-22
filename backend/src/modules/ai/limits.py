from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from src.config import settings
from src.common.enums import PlanTier, SubscriptionStatus
from src.modules.ai.models import AIUsageLog
from src.modules.billing.models import Plan
from src.modules.org.models import Organization, Subscription


def _utc_day_start(dt: datetime) -> datetime:
    dt = dt.astimezone(timezone.utc)
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)


async def resolve_org_plan(session, *, org_id) -> PlanTier:
    """
    Resolve effective org plan.

    Source of truth:
    - Active subscription (if present)
    - Fallback to Organization.plan
    """
    # 1) Active subscription.
    try:
        sub_plan = (
            await session.execute(
                select(Subscription.plan).where(
                    Subscription.org_id == org_id,
                    Subscription.status == SubscriptionStatus.ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if sub_plan is not None:
            if isinstance(sub_plan, PlanTier):
                return sub_plan
            sub_val = sub_plan.value if hasattr(sub_plan, "value") else sub_plan
            return PlanTier(str(sub_val))
    except Exception:
        pass

    # 2) Org.plan (legacy).
    try:
        plan_row = (await session.execute(select(Organization.plan).where(Organization.id == org_id))).scalar_one_or_none()
        if plan_row is not None:
            if isinstance(plan_row, PlanTier):
                return plan_row
            plan_value = plan_row.value if hasattr(plan_row, "value") else plan_row
            return PlanTier(str(plan_value))
    except Exception:
        pass

    return PlanTier.FREE


async def check_ai_limits(session, *, org_id, user_id, estimated_request_tokens: int) -> tuple[bool, dict | None]:
    """
    Enforce basic AI cost controls:
    - RPM per user (AI_RPM_PER_USER)
    - tokens/day per org (AI_MAX_TOKENS_PER_DAY_PER_ORG)
    """
    plan: PlanTier = await resolve_org_plan(session, org_id=org_id)

    # Limits source of truth: plans table (fallback to settings).
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
    daily_limit = daily_limit_by_plan.get(plan) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0)
    rpm_limit = rpm_limit_by_plan.get(plan) or int(settings.AI_RPM_PER_USER or 0)

    try:
        plan_db = (
            await session.execute(select(Plan).where(Plan.name == plan.value, Plan.is_active.is_(True)))
        ).scalars().first()
        if plan_db:
            if int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
                daily_limit = int(plan_db.ai_tokens_per_day)
            if int(getattr(plan_db, "ai_rpm_per_user", 0) or 0) > 0:
                rpm_limit = int(plan_db.ai_rpm_per_user)
    except Exception:
        pass

    # RPM per user
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=60)

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
