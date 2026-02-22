"""Add composite indexes for AI usage limits queries.

Revision ID: 013
Revises: 012
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_ai_usage_logs_org_user_created_at",
        "ai_usage_logs",
        ["org_id", "user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_ai_usage_logs_org_created_at",
        "ai_usage_logs",
        ["org_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_logs_org_created_at", table_name="ai_usage_logs")
    op.drop_index("ix_ai_usage_logs_org_user_created_at", table_name="ai_usage_logs")
