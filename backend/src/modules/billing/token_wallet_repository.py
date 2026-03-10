from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import and_, func, or_, select

from src.common.enums import SubscriptionStatus
from src.modules.billing.models import (
    Plan,
    TokenBalance,
    TokenLedger,
    TokenPackage,
    TokenPurchase,
    TokenUsageIdempotency,
)
from src.modules.org.models import Organization, Subscription

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession


class TokenWalletRepository:
    """Persistence-слой для токен-кошелька (все SQL операции)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_balances_by_org_ids(
        self,
        *,
        org_ids: list[uuid.UUID],
        lock: bool = False,
    ) -> list[TokenBalance]:
        stmt = select(TokenBalance).where(TokenBalance.org_id.in_(org_ids))
        if lock:
            stmt = stmt.with_for_update()
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_active_subscription_plans_by_org_ids(
        self, *, org_ids: list[uuid.UUID]
    ) -> list[tuple[uuid.UUID, object]]:
        return (
            await self.session.execute(
                select(Subscription.org_id, Subscription.plan).where(
                    Subscription.org_id.in_(org_ids),
                    Subscription.status == SubscriptionStatus.ACTIVE,
                )
            )
        ).all()

    async def get_org_plans_by_org_ids(self, *, org_ids: list[uuid.UUID]) -> list[tuple[uuid.UUID, object]]:
        return (
            await self.session.execute(select(Organization.id, Organization.plan).where(Organization.id.in_(org_ids)))
        ).all()

    async def get_active_plans_for_tiers(self, *, plan_names: list[str]) -> list[Plan]:
        stmt = select(Plan).where(Plan.is_active.is_(True), Plan.name.in_(plan_names))
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_expired_purchases(self, *, org_ids: list[uuid.UUID], now_utc: datetime) -> list[TokenPurchase]:
        stmt = select(TokenPurchase).where(
            TokenPurchase.org_id.in_(org_ids),
            TokenPurchase.is_active.is_(True),
            TokenPurchase.expires_at.is_not(None),
            TokenPurchase.expires_at <= now_utc,
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_addon_sum_by_org_ids(
        self, *, org_ids: list[uuid.UUID], now_utc: datetime
    ) -> list[tuple[uuid.UUID, int]]:
        stmt = (
            select(
                TokenPurchase.org_id, func.coalesce(func.sum(TokenPurchase.tokens_remaining), 0).label("addon_tokens")
            )
            .where(
                TokenPurchase.org_id.in_(org_ids),
                TokenPurchase.is_active.is_(True),
                TokenPurchase.tokens_remaining > 0,
                or_(
                    TokenPurchase.expires_at.is_(None),
                    and_(TokenPurchase.expires_at.is_not(None), TokenPurchase.expires_at > now_utc),
                ),
            )
            .group_by(TokenPurchase.org_id)
        )
        return (await self.session.execute(stmt)).all()

    async def get_active_token_package(self, *, package_code: str) -> TokenPackage | None:
        stmt = select(TokenPackage).where(TokenPackage.code == package_code, TokenPackage.is_active.is_(True))
        return (await self.session.execute(stmt)).scalars().first()

    async def get_purchase_by_payment_id(self, *, payment_id: str) -> TokenPurchase | None:
        stmt = select(TokenPurchase).where(TokenPurchase.payment_id == payment_id).limit(1)
        return (await self.session.execute(stmt)).scalars().first()

    async def get_idempotency(self, *, org_id: uuid.UUID, request_id: str) -> TokenUsageIdempotency | None:
        stmt = select(TokenUsageIdempotency).where(
            TokenUsageIdempotency.org_id == org_id,
            TokenUsageIdempotency.request_id == request_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_spendable_purchases_for_update(self, *, org_id: uuid.UUID, now_utc: datetime) -> list[TokenPurchase]:
        stmt = (
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
        return list((await self.session.execute(stmt)).scalars().all())

    def add_balance(self, balance: TokenBalance) -> None:
        self.session.add(balance)

    def add_purchase(self, purchase: TokenPurchase) -> None:
        self.session.add(purchase)

    def add_ledger(self, ledger: TokenLedger) -> None:
        self.session.add(ledger)

    def add_idempotency(self, item: TokenUsageIdempotency) -> None:
        self.session.add(item)

    async def flush(self) -> None:
        await self.session.flush()
