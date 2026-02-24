import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Integer, Boolean, text, CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Plan(BaseDBModel):
    __tablename__ = "plans"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    price_monthly: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # cents
    price_yearly: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_members: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    max_tables: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    max_records: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    max_storage_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    has_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # AI limits (source of truth for org limits; can be edited in admin panel).
    ai_max_tokens_per_request: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_tokens_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_rpm_per_user: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class TokenBalance(BaseDBModel):
    __tablename__ = "token_balances"
    __table_args__ = (
        UniqueConstraint("org_id", name="uq_token_balances_org_id"),
        CheckConstraint("plan_tokens_remaining >= 0", name="ck_token_balances_plan_non_negative"),
        CheckConstraint("plan_tokens_monthly_quota >= 0", name="ck_token_balances_plan_quota_non_negative"),
        CheckConstraint("addon_tokens_remaining >= 0", name="ck_token_balances_addon_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Формат: YYYY-MM (UTC). Нужен, чтобы monthly quota не переносился между месяцами.
    plan_cycle_key: Mapped[str] = mapped_column(String(7), nullable=False)
    plan_tokens_monthly_quota: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    plan_tokens_remaining: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    addon_tokens_remaining: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))


class TokenPurchase(BaseDBModel):
    __tablename__ = "token_purchases"
    __table_args__ = (
        CheckConstraint("tokens_total > 0", name="ck_token_purchases_tokens_total_positive"),
        CheckConstraint("tokens_remaining >= 0", name="ck_token_purchases_tokens_remaining_non_negative"),
        CheckConstraint("tokens_remaining <= tokens_total", name="ck_token_purchases_tokens_remaining_le_total"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    package_code: Mapped[str] = mapped_column(String(64), nullable=False)
    tokens_total: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_remaining: Mapped[int] = mapped_column(Integer, nullable=False)
    # Пока симуляция покупки, но оставляем поле под привязку к внешней оплате.
    payment_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class TokenPackage(BaseDBModel):
    __tablename__ = "token_packages"
    __table_args__ = (
        UniqueConstraint("code", name="uq_token_packages_code"),
        CheckConstraint("tokens > 0", name="ck_token_packages_tokens_positive"),
        CheckConstraint("price_rub_cents >= 0", name="ck_token_packages_price_non_negative"),
    )

    code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    price_rub_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default=text("100"))


class TokenLedger(BaseDBModel):
    __tablename__ = "token_ledger"
    __table_args__ = (
        CheckConstraint("delta_tokens != 0", name="ck_token_ledger_delta_non_zero"),
        CheckConstraint("plan_delta_tokens IS NULL OR plan_delta_tokens != 0", name="ck_token_ledger_plan_delta_non_zero"),
        CheckConstraint("addon_delta_tokens IS NULL OR addon_delta_tokens != 0", name="ck_token_ledger_addon_delta_non_zero"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    operation: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Суммарная дельта (положительная/отрицательная).
    delta_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    # Декомпозиция по "кошелькам".
    plan_delta_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    addon_delta_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    balance_plan_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    balance_addon_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class TokenUsageIdempotency(BaseDBModel):
    __tablename__ = "token_usage_idempotency"
    __table_args__ = (
        UniqueConstraint("org_id", "request_id", name="uq_token_usage_idem_org_request"),
        CheckConstraint("spent_total >= 0", name="ck_token_usage_idem_spent_non_negative"),
        CheckConstraint("spent_addon >= 0", name="ck_token_usage_idem_spent_addon_non_negative"),
        CheckConstraint("spent_plan >= 0", name="ck_token_usage_idem_spent_plan_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    spent_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    spent_addon: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    spent_plan: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
