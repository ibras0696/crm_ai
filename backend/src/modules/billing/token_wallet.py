from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import PlanTier
from src.config import settings
from src.modules.billing.models import TokenBalance, TokenLedger, TokenPurchase, TokenUsageIdempotency
from src.modules.billing.token_wallet_repository import TokenWalletRepository


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
    repo = TokenWalletRepository(session)
    sub_rows = await repo.get_active_subscription_plans_by_org_ids(org_ids=[org_id])
    sub_plan = sub_rows[0][1] if sub_rows else None
    try:
        plan_tier = PlanTier(str(sub_plan.value if hasattr(sub_plan, "value") else sub_plan)) if sub_plan else None
    except Exception:
        plan_tier = None
    if plan_tier is None:
        org_rows = await repo.get_org_plans_by_org_ids(org_ids=[org_id])
        org_plan = org_rows[0][1] if org_rows else None
        try:
            plan_tier = PlanTier(str(org_plan.value if hasattr(org_plan, "value") else org_plan)) if org_plan else PlanTier.FREE
        except Exception:
            plan_tier = PlanTier.FREE

    plan_db = (await repo.get_active_plans_for_tiers(plan_names=[plan_tier.value]))[0:1]
    plan_db = plan_db[0] if plan_db else None
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
    repo = TokenWalletRepository(session)
    rows = await repo.get_addon_sum_by_org_ids(org_ids=[org_id], now_utc=now_utc)
    if not rows:
        return 0
    return int(rows[0][1] or 0)


async def _deactivate_expired_purchases(session: AsyncSession, *, org_id: uuid.UUID, now_utc: datetime) -> None:
    repo = TokenWalletRepository(session)
    rows = await repo.get_expired_purchases(org_ids=[org_id], now_utc=now_utc)
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

    repo = TokenWalletRepository(session)
    now_utc = datetime.now(UTC)
    key = cycle_key(now_utc)

    existing_balances = await repo.get_balances_by_org_ids(org_ids=unique_org_ids, lock=lock)
    balances_by_org: dict[uuid.UUID, TokenBalance] = {b.org_id: b for b in existing_balances}

    active_sub_rows = await repo.get_active_subscription_plans_by_org_ids(org_ids=unique_org_ids)
    active_sub_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id, sub_plan in active_sub_rows:
        try:
            active_sub_plan_by_org[org_id] = PlanTier(str(sub_plan.value if hasattr(sub_plan, "value") else sub_plan))
        except Exception:
            continue

    org_plan_rows = await repo.get_org_plans_by_org_ids(org_ids=unique_org_ids)
    org_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id, org_plan in org_plan_rows:
        try:
            org_plan_by_org[org_id] = PlanTier(str(org_plan.value if hasattr(org_plan, "value") else org_plan))
        except Exception:
            org_plan_by_org[org_id] = PlanTier.FREE

    effective_plan_by_org: dict[uuid.UUID, PlanTier] = {}
    for org_id in unique_org_ids:
        effective_plan_by_org[org_id] = active_sub_plan_by_org.get(org_id) or org_plan_by_org.get(org_id) or PlanTier.FREE

    active_plans = await repo.get_active_plans_for_tiers(plan_names=[p.value for p in PlanTier])
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

    expired_rows = await repo.get_expired_purchases(org_ids=unique_org_ids, now_utc=now_utc)
    for purchase in expired_rows:
        purchase.is_active = False
        purchase.tokens_remaining = 0

    addon_sum_rows = await repo.get_addon_sum_by_org_ids(org_ids=unique_org_ids, now_utc=now_utc)
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
            repo.add_balance(balance)
            balances_by_org[org_id] = balance
            if quota > 0:
                repo.add_ledger(
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
                repo.add_ledger(
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
            current_quota = int(balance.plan_tokens_monthly_quota or 0)
            current_remaining = int(balance.plan_tokens_remaining or 0)
            if current_quota != quota:
                spent_in_cycle = max(0, current_quota - current_remaining)
                new_remaining = max(0, quota - spent_in_cycle)
                balance.plan_tokens_monthly_quota = quota
                balance.plan_tokens_remaining = min(quota, new_remaining)

                delta = int(balance.plan_tokens_remaining or 0) - current_remaining
                if delta != 0:
                    repo.add_ledger(
                        TokenLedger(
                            org_id=org_id,
                            user_id=None,
                            operation="plan_quota_update",
                            delta_tokens=delta,
                            plan_delta_tokens=delta,
                            addon_delta_tokens=None,
                            request_id=None,
                            balance_plan_after=int(balance.plan_tokens_remaining or 0),
                            balance_addon_after=addon_remaining,
                            meta={
                                "cycle": key,
                                "old_quota": current_quota,
                                "new_quota": quota,
                                "spent_in_cycle": spent_in_cycle,
                            },
                        )
                    )

    await repo.flush()
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
    user_id: uuid.UUID | None,
    package_code: str,
    months_valid: int = 12,
    payment_id: str | None = None,
    purchase_meta: dict | None = None,
) -> dict:
    repo = TokenWalletRepository(session)
    package = await repo.get_active_token_package(package_code=package_code)
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
        meta={"months_valid": months_valid, **(purchase_meta or {})},
    )
    repo.add_purchase(purchase)
    balance.addon_tokens_remaining = int(balance.addon_tokens_remaining or 0) + amount

    repo.add_ledger(
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
    await repo.flush()
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
        repo = TokenWalletRepository(session)
        existing = await repo.get_idempotency(org_id=org_id, request_id=request_id)
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
        repo = TokenWalletRepository(session)
        purchases = await repo.get_spendable_purchases_for_update(org_id=org_id, now_utc=now_utc)

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

    repo = TokenWalletRepository(session)
    repo.add_ledger(
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
        repo.add_idempotency(
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
    await repo.flush()

    return TokenSpendResult(
        spent_total=to_spend,
        spent_addon=spent_addon,
        spent_plan=spent_plan,
        addon_remaining=int(balance.addon_tokens_remaining or 0),
        plan_remaining=int(balance.plan_tokens_remaining or 0),
        idempotent_replay=False,
    )
