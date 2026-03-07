"""add token packages table

Revision ID: 023
Revises: 022
Create Date: 2026-02-24 19:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "token_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("tokens", sa.Integer(), nullable=False),
        sa.Column("price_rub_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.UniqueConstraint("code", name="uq_token_packages_code"),
        sa.CheckConstraint("tokens > 0", name="ck_token_packages_tokens_positive"),
        sa.CheckConstraint("price_rub_cents >= 0", name="ck_token_packages_price_non_negative"),
    )
    op.create_index("ix_token_packages_code", "token_packages", ["code"])

    op.execute(
        """
        INSERT INTO token_packages (code, display_name, tokens, price_rub_cents, is_active, sort_order)
        VALUES
          ('pack_50k', 'Пакет 50k', 50000, 99000, true, 10),
          ('pack_100k', 'Пакет 100k', 100000, 179000, true, 20),
          ('pack_500k', 'Пакет 500k', 500000, 799000, true, 30)
        ON CONFLICT (code) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_token_packages_code", table_name="token_packages")
    op.drop_table("token_packages")
