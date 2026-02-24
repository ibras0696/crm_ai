from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import PlanTier, SubscriptionStatus
from src.config import settings
from src.modules.billing.models import Plan, TokenBalance, TokenLedger, TokenPackage, TokenPurchase, TokenUsageIdempotency
from src.modules.org.models import Organization, Subscription


DEFAULT_TOKEN_PACKAGE_CATALOG: dict[str, int] = {
    "pack_50k": 50_000,
    "pack_100k": 100_000,
    "pack_500k": 500_000,
}


def cycle_key(dt: datetime | None = None) -> str:
    now = (dt or datetime.now(UTC)).astimezone(UTC)
    return f"{now.year:04d}-{now.month:02d}"


@dataclass(slots=True)
class TokenSpendResult:
    spent_total: int
    spent_addon: int
    spent_plan: int
    addon_remaining: int
    plan_remaining: int
    idempotent_replay: bool


async def _monthly_plan_quota(session: AsyncSession, *, org_id: uuid.UUID) -> int:
    sub_plan = (
        await session.execute(
            select(Subscription.plan).where(
                Subscription.org_id == org_id,
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        )
    ).scalars().first()
    try:
        plan_tier = PlanTier(str(sub_plan.value if hasattr(sub_plan, "value") else sub_plan)) if sub_plan else None
    except Exception:
        plan_tier = None
    if plan_tier is None:
        org_plan = (await session.execute(select(Organization.plan).where(Organization.id == org_id))).scalar_one_or_none()
        try:
            plan_tier = PlanTier(str(org_plan.value if hasattr(org_plan, "value") else org_plan)) if org_plan else PlanTier.FREE
        except Exception:
            plan_tier = PlanTier.FREE

    plan_db = (
        await session.execute(
            select(Plan).where(
                Plan.name == plan_tier.value,
                Plan.is_active.is_(True),
            )
        )
    ).scalars().first()
    default_by_plan = {
        PlanTier.FREE: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        PlanTier.TEAM: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        PlanTier.BUSINESS: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
    }
    quota = int(default_by_plan.get(plan_tier) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0))
    if plan_db and int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
        quota = int(plan_db.ai_tokens_per_day)
    # Храним ежемесячную квоту в legacy поле `daily_tokens`.
    return max(0, quota)


async def _recalculate_addon_remaining(session: AsyncSession, *, org_id: uuid.UUID, now_utc: datetime) -> int:
    total = (
        await session.execute(
            select(func.coalesce(func.sum(TokenPurchase.tokens_remaining), 0)).where(
                TokenPurchase.org_id == org_id,
                TokenPurchase.is_active.is_(True),
                TokenPurchase.tokens_remaining > 0,
                or_(
                    TokenPurchase.expires_at.is_(None),
                    and_(TokenPurchase.expires_at.is_not(None), TokenPurchase.expires_at > now_utc),
                ),
            )
        )
    ).scalar_one()
    return int(total or 0)


async def _deactivate_expired_purchases(session: AsyncSession, *, org_id: uuid.UUID, now_utc: datetime) -> None:
    rows = (
        await session.execute(
            select(TokenPurchase).where(
                TokenPurchase.org_id == org_id,
                TokenPurchase.is_active.is_(True),
                TokenPurchase.expires_at.is_not(None),
                TokenPurchase.expires_at <= now_utc,
            )
        )
    ).scalars().all()
    for p in rows:
        p.is_active = False
        p.tokens_remaining = 0


async def ensure_token_balances_bulk(
    session: AsyncSession,
    *,
    org_ids: list[uuid.UUID],
    lock: bool = False,
) -> dict[uuid.UUID, TokenBalance]:
    """Обновить балансы токенов для набора организаций батчем (без N+1)."""
    unique_org_ids = list(dict.fromkeys(org_ids))
    if not unique_org_ids:
        return {}

    now_utc = datetime.now(UTC)
    key = cycle_key(now_utc)

    balance_stmt = select(TokenBalance).where(TokenBalance.org_id.in_(unique_org_ids))
    if lock:
        balance_stmt = balance_stmt.with_for_update()
    existing_balances = (await session.execute(balance_stmt)).scalars().all()
    balances_by_org: dict[uuid.UUID, TokenBalance] = {b.org_id: b for b in existing_balances}

    active_sub_rows = (
        await session.execute(
            select(Subscription.org_id, Subscription.plan).where(
                Subscription.org_id.in_(unique_org_ids),
                Subscription.status == SubscriptionStatus.ACTIVE,
            )
        )
    ).all()
    active_sub_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id, sub_plan in active_sub_rows:
        try:
            active_sub_plan_by_org[org_id] = PlanTier(str(sub_plan.value if hasattr(sub_plan, "value") else sub_plan))
        except Exception:
            continue

    org_plan_rows = (
        await session.execute(select(Organization.id, Organization.plan).where(Organization.id.in_(unique_org_ids)))
    ).all()
    org_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id, org_plan in org_plan_rows:
        try:
            org_plan_by_org[org_id] = PlanTier(str(org_plan.value if hasattr(org_plan, "value") else org_plan))
        except Exception:
            org_plan_by_org[org_id] = PlanTier.FREE

    effective_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id in unique_org_ids:
        effective_plan_by_org[org_id] = active_sub_plan_by_org.get(org_id) or org_plan_by_org.get(org_id) or PlanTier.FREE

    active_plans = (
        await session.execute(select(Plan).where(Plan.is_active.is_(True), Plan.name.in_([p.value for p in PlanTier])))
    ).scalars().all()
    plan_db_by_name = {str(p.name).lower(): p for p in active_plans}
    default_by_plan = {
        PlanTier.FREE: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        PlanTier.TEAM: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        PlanTier.BUSINESS: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
    }

    quota_by_org: dict[uuid.UUID, int] = {}
    for org_id, plan_tier in effective_plan_by_org.items():
        quota = int(default_by_plan.get(plan_tier) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0))
        plan_db = plan_db_by_name.get(plan_tier.value)
        if plan_db and int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
            quota = int(plan_db.ai_tokens_per_day)
        quota_by_org[org_id] = max(0, quota)

    expired_rows = (
        await session.execute(
            select(TokenPurchase).where(
                TokenPurchase.org_id.in_(unique_org_ids),
                TokenPurchase.is_active.is_(True),
                TokenPurchase.expires_at.is_not(None),
                TokenPurchase.expires_at <= now_utc,
            )
        )
    ).scalars().all()
    for purchase in expired_rows:
        purchase.is_active = False
        purchase.tokens_remaining = 0

    addon_sum_rows = (
        await session.execute(
            select(TokenPurchase.org_id, func.coalesce(func.sum(TokenPurchase.tokens_remaining), 0).label("addon_tokens"))
            .where(
                TokenPurchase.org_id.in_(unique_org_ids),
                TokenPurchase.is_active.is_(True),
                TokenPurchase.tokens_remaining > 0,
                or_(
                    TokenPurchase.expires_at.is_(None),
                    and_(TokenPurchase.expires_at.is_not(None), TokenPurchase.expires_at > now_utc),
                ),
            )
            .group_by(TokenPurchase.org_id)
        )
    ).all()
    addon_remaining_by_org: dict[uuid.UUID, int] = defaultdict(int)
    for org_id, addon_tokens in addon_sum_rows:
        addon_remaining_by_org[org_id] = int(addon_tokens or 0)

    for org_id in unique_org_ids:
        quota = quota_by_org.get(org_id, 0)
        addon_remaining = addon_remaining_by_org.get(org_id, 0)
        balance = balances_by_org.get(org_id)

        if balance is None:
            balance = TokenBalance(
                org_id=org_id,
                plan_cycle_key=key,
                plan_tokens_monthly_quota=quota,
                plan_tokens_remaining=quota,
                addon_tokens_remaining=addon_remaining,
            )
            session.add(balance)
            balances_by_org[org_id] = balance
            if quota > 0:
                session.add(
                    TokenLedger(
                        org_id=org_id,
                        user_id=None,
                        operation="plan_cycle_seed",
                        delta_tokens=quota,
                        plan_delta_tokens=quota,
                        addon_delta_tokens=None,
                        request_id=None,
                        balance_plan_after=quota,
                        balance_addon_after=addon_remaining,
                        meta={"cycle": key},
                    )
                )
            continue

        if balance.plan_cycle_key != key:
            expired_plan_tokens = int(balance.plan_tokens_remaining or 0)
            balance.plan_cycle_key = key
            balance.plan_tokens_monthly_quota = quota
            balance.plan_tokens_remaining = quota
            balance.addon_tokens_remaining = addon_remaining
            if quota > 0:
                session.add(
                    TokenLedger(
                        org_id=org_id,
                        user_id=None,
                        operation="plan_cycle_reset",
                        delta_tokens=quota,
                        plan_delta_tokens=quota,
                        addon_delta_tokens=None,
                        request_id=None,
                        balance_plan_after=quota,
                        balance_addon_after=addon_remaining,
                        meta={"cycle": key, "expired_plan_tokens": expired_plan_tokens},
                    )
                )
        else:
            balance.addon_tokens_remaining = addon_remaining

    await session.flush()
    return balances_by_org


async def ensure_token_balance(session: AsyncSession, *, org_id: uuid.UUID, lock: bool = False) -> TokenBalance:
    """Создать/обновить баланс организации с учетом текущего месяца (UTC)."""
    balances = await ensure_token_balances_bulk(session, org_ids=[org_id], lock=lock)
    return balances[org_id]


async def get_token_balance_view(session: AsyncSession, *, org_id: uuid.UUID) -> dict:
    balance = await ensure_token_balance(session, org_id=org_id, lock=False)
    return {
        "org_id": str(org_id),
        "cycle_key": balance.plan_cycle_key,
        "plan_tokens_monthly_quota": int(balance.plan_tokens_monthly_quota or 0),
        "plan_tokens_remaining": int(balance.plan_tokens_remaining or 0),
        "addon_tokens_remaining": int(balance.addon_tokens_remaining or 0),
        "total_tokens_remaining": int(balance.plan_tokens_remaining or 0) + int(balance.addon_tokens_remaining or 0),
    }


async def purchase_addon_tokens(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    package_code: str,
    months_valid: int = 12,
    payment_id: str | None = None,
) -> dict:
    package = (
        await session.execute(
            select(TokenPackage).where(TokenPackage.code == package_code, TokenPackage.is_active.is_(True))
        )
    ).scalars().first()
    if package is None:
        # backward-compatible fallback
        if package_code not in DEFAULT_TOKEN_PACKAGE_CATALOG:
            raise ValueError("UNKNOWN_PACKAGE")
        amount = int(DEFAULT_TOKEN_PACKAGE_CATALOG[package_code])
    else:
        amount = int(package.tokens or 0)
    if amount <= 0:
        raise ValueError("INVALID_PACKAGE")

    balance = await ensure_token_balance(session, org_id=org_id, lock=True)
    now_utc = datetime.now(UTC)
    expires_at = now_utc + timedelta(days=max(1, months_valid) * 30) if months_valid > 0 else None

    purchase = TokenPurchase(
        org_id=org_id,
        package_code=package_code,
        tokens_total=amount,
        tokens_remaining=amount,
        payment_id=payment_id,
        expires_at=expires_at,
        is_active=True,
        meta={"months_valid": months_valid},
    )
    session.add(purchase)
    balance.addon_tokens_remaining = int(balance.addon_tokens_remaining or 0) + amount

    session.add(
        TokenLedger(
            org_id=org_id,
            user_id=user_id,
            operation="addon_purchase",
            delta_tokens=amount,
            plan_delta_tokens=None,
            addon_delta_tokens=amount,
            request_id=None,
            balance_plan_after=int(balance.plan_tokens_remaining or 0),
            balance_addon_after=int(balance.addon_tokens_remaining or 0),
            meta={"package_code": package_code, "purchase_tokens": amount, "expires_at": expires_at.isoformat() if expires_at else None},
        )
    )
    await session.flush()
    return {
        "package_code": package_code,
        "package_price_rub_cents": int(getattr(package, "price_rub_cents", 0) or 0),
        "tokens_added": amount,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "plan_tokens_remaining": int(balance.plan_tokens_remaining or 0),
        "addon_tokens_remaining": int(balance.addon_tokens_remaining or 0),
        "total_tokens_remaining": int(balance.plan_tokens_remaining or 0) + int(balance.addon_tokens_remaining or 0),
    }


async def spend_tokens(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    tokens: int,
    request_id: str | None,
    meta: dict | None = None,
) -> TokenSpendResult:
    to_spend = int(tokens or 0)
    if to_spend <= 0:
        balance = await ensure_token_balance(session, org_id=org_id, lock=True)
        return TokenSpendResult(
            spent_total=0,
            spent_addon=0,
            spent_plan=0,
            addon_remaining=int(balance.addon_tokens_remaining or 0),
            plan_remaining=int(balance.plan_tokens_remaining or 0),
            idempotent_replay=False,
        )

    if request_id:
        existing = (
            await session.execute(
                select(TokenUsageIdempotency).where(
                    TokenUsageIdempotency.org_id == org_id,
                    TokenUsageIdempotency.request_id == request_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            balance = await ensure_token_balance(session, org_id=org_id, lock=False)
            return TokenSpendResult(
                spent_total=int(existing.spent_total or 0),
                spent_addon=int(existing.spent_addon or 0),
                spent_plan=int(existing.spent_plan or 0),
                addon_remaining=int(balance.addon_tokens_remaining or 0),
                plan_remaining=int(balance.plan_tokens_remaining or 0),
                idempotent_replay=True,
            )

    balance = await ensure_token_balance(session, org_id=org_id, lock=True)
    available_addon = int(balance.addon_tokens_remaining or 0)
    available_plan = int(balance.plan_tokens_remaining or 0)
    available_total = available_addon + available_plan
    if to_spend > available_total:
        raise ValueError("INSUFFICIENT_TOKENS")

    remain = to_spend
    spent_addon = 0
    spent_plan = 0

    if remain > 0 and available_addon > 0:
        now_utc = datetime.now(UTC)
        purchases = (
            await session.execute(
                select(TokenPurchase)
                .where(
                    TokenPurchase.org_id == org_id,
                    TokenPurchase.is_active.is_(True),
                    TokenPurchase.tokens_remaining > 0,
                    or_(
                        TokenPurchase.expires_at.is_(None),
                        and_(TokenPurchase.expires_at.is_not(None), TokenPurchase.expires_at > now_utc),
                    ),
                )
                .order_by(TokenPurchase.expires_at.asc().nulls_last(), TokenPurchase.created_at.asc())
                .with_for_update()
            )
        ).scalars().all()

        for purchase in purchases:
            if remain <= 0:
                break
            can_take = min(int(purchase.tokens_remaining or 0), remain)
            if can_take <= 0:
                continue
            purchase.tokens_remaining = int(purchase.tokens_remaining or 0) - can_take
            if purchase.tokens_remaining <= 0:
                purchase.is_active = False
            remain -= can_take
            spent_addon += can_take

        balance.addon_tokens_remaining = int(balance.addon_tokens_remaining or 0) - spent_addon

    if remain > 0:
        spent_plan = remain
        balance.plan_tokens_remaining = int(balance.plan_tokens_remaining or 0) - spent_plan
        remain = 0

    session.add(
        TokenLedger(
            org_id=org_id,
            user_id=user_id,
            operation="ai_usage_spend",
            delta_tokens=-to_spend,
            plan_delta_tokens=-spent_plan if spent_plan > 0 else None,
            addon_delta_tokens=-spent_addon if spent_addon > 0 else None,
            request_id=request_id,
            balance_plan_after=int(balance.plan_tokens_remaining or 0),
            balance_addon_after=int(balance.addon_tokens_remaining or 0),
            meta=meta or {},
        )
    )

    if request_id:
        session.add(
            TokenUsageIdempotency(
                org_id=org_id,
                user_id=user_id,
                request_id=request_id,
                spent_total=to_spend,
                spent_addon=spent_addon,
                spent_plan=spent_plan,
                meta=meta or {},
            )
        )
    await session.flush()

    return TokenSpendResult(
        spent_total=to_spend,
        spent_addon=spent_addon,
        spent_plan=spent_plan,
        addon_remaining=int(balance.addon_tokens_remaining or 0),
        plan_remaining=int(balance.plan_tokens_remaining or 0),
        idempotent_replay=False,
    )
