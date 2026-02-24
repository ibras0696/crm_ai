"""add ai token wallets and ledger tables

Revision ID: 022
Revises: 021
Create Date: 2026-02-24 18:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "token_balances",
        *_base_columns(),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_cycle_key", sa.String(length=7), nullable=False),
        sa.Column("plan_tokens_monthly_quota", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("plan_tokens_remaining", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("addon_tokens_remaining", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("org_id", name="uq_token_balances_org_id"),
        sa.CheckConstraint("plan_tokens_remaining >= 0", name="ck_token_balances_plan_non_negative"),
        sa.CheckConstraint("plan_tokens_monthly_quota >= 0", name="ck_token_balances_plan_quota_non_negative"),
        sa.CheckConstraint("addon_tokens_remaining >= 0", name="ck_token_balances_addon_non_negative"),
    )
    op.create_index("ix_token_balances_org_id", "token_balances", ["org_id"])

    op.create_table(
        "token_purchases",
        *_base_columns(),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("package_code", sa.String(length=64), nullable=False),
        sa.Column("tokens_total", sa.Integer(), nullable=False),
        sa.Column("tokens_remaining", sa.Integer(), nullable=False),
        sa.Column("payment_id", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint("tokens_total > 0", name="ck_token_purchases_tokens_total_positive"),
        sa.CheckConstraint("tokens_remaining >= 0", name="ck_token_purchases_tokens_remaining_non_negative"),
        sa.CheckConstraint("tokens_remaining <= tokens_total", name="ck_token_purchases_tokens_remaining_le_total"),
    )
    op.create_index("ix_token_purchases_org_id", "token_purchases", ["org_id"])
    op.create_index("ix_token_purchases_payment_id", "token_purchases", ["payment_id"])
    op.create_index("ix_token_purchases_expires_at", "token_purchases", ["expires_at"])

    op.create_table(
        "token_ledger",
        *_base_columns(),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("delta_tokens", sa.Integer(), nullable=False),
        sa.Column("plan_delta_tokens", sa.Integer(), nullable=True),
        sa.Column("addon_delta_tokens", sa.Integer(), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("balance_plan_after", sa.Integer(), nullable=True),
        sa.Column("balance_addon_after", sa.Integer(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.CheckConstraint("delta_tokens != 0", name="ck_token_ledger_delta_non_zero"),
        sa.CheckConstraint("plan_delta_tokens IS NULL OR plan_delta_tokens != 0", name="ck_token_ledger_plan_delta_non_zero"),
        sa.CheckConstraint("addon_delta_tokens IS NULL OR addon_delta_tokens != 0", name="ck_token_ledger_addon_delta_non_zero"),
    )
    op.create_index("ix_token_ledger_org_id", "token_ledger", ["org_id"])
    op.create_index("ix_token_ledger_user_id", "token_ledger", ["user_id"])
    op.create_index("ix_token_ledger_operation", "token_ledger", ["operation"])
    op.create_index("ix_token_ledger_request_id", "token_ledger", ["request_id"])

    op.create_table(
        "token_usage_idempotency",
        *_base_columns(),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("request_id", sa.String(length=128), nullable=False),
        sa.Column("spent_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("spent_addon", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("spent_plan", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.UniqueConstraint("org_id", "request_id", name="uq_token_usage_idem_org_request"),
        sa.CheckConstraint("spent_total >= 0", name="ck_token_usage_idem_spent_non_negative"),
        sa.CheckConstraint("spent_addon >= 0", name="ck_token_usage_idem_spent_addon_non_negative"),
        sa.CheckConstraint("spent_plan >= 0", name="ck_token_usage_idem_spent_plan_non_negative"),
    )
    op.create_index("ix_token_usage_idempotency_org_id", "token_usage_idempotency", ["org_id"])
    op.create_index("ix_token_usage_idempotency_user_id", "token_usage_idempotency", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_token_usage_idempotency_user_id", table_name="token_usage_idempotency")
    op.drop_index("ix_token_usage_idempotency_org_id", table_name="token_usage_idempotency")
    op.drop_table("token_usage_idempotency")

    op.drop_index("ix_token_ledger_request_id", table_name="token_ledger")
    op.drop_index("ix_token_ledger_operation", table_name="token_ledger")
    op.drop_index("ix_token_ledger_user_id", table_name="token_ledger")
    op.drop_index("ix_token_ledger_org_id", table_name="token_ledger")
    op.drop_table("token_ledger")

    op.drop_index("ix_token_purchases_expires_at", table_name="token_purchases")
    op.drop_index("ix_token_purchases_payment_id", table_name="token_purchases")
    op.drop_index("ix_token_purchases_org_id", table_name="token_purchases")
    op.drop_table("token_purchases")

    op.drop_index("ix_token_balances_org_id", table_name="token_balances")
    op.drop_table("token_balances")
