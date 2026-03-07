"""add org and user ai limits

Revision ID: 026
Revises: 025
Create Date: 2026-02-27 01:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_org_limits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("daily_tokens_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("monthly_tokens_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", name="uq_ai_org_limits_org_id"),
        sa.CheckConstraint("daily_tokens_limit >= 0", name="ck_ai_org_limits_daily_non_negative"),
        sa.CheckConstraint("monthly_tokens_limit >= 0", name="ck_ai_org_limits_monthly_non_negative"),
    )
    op.create_index("ix_ai_org_limits_org_id", "ai_org_limits", ["org_id"])

    op.create_table(
        "ai_user_limits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("daily_tokens_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rpm_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("org_id", "user_id", name="uq_ai_user_limits_org_user"),
        sa.CheckConstraint("daily_tokens_limit >= 0", name="ck_ai_user_limits_daily_non_negative"),
        sa.CheckConstraint("rpm_limit >= 0", name="ck_ai_user_limits_rpm_non_negative"),
    )
    op.create_index("ix_ai_user_limits_org_id", "ai_user_limits", ["org_id"])
    op.create_index("ix_ai_user_limits_user_id", "ai_user_limits", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_ai_user_limits_user_id", table_name="ai_user_limits")
    op.drop_index("ix_ai_user_limits_org_id", table_name="ai_user_limits")
    op.drop_table("ai_user_limits")
    op.drop_index("ix_ai_org_limits_org_id", table_name="ai_org_limits")
    op.drop_table("ai_org_limits")
