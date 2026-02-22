"""Add composite indexes for AI chat list and message pagination.

Revision ID: 014
Revises: 013
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_ai_chat_sessions_org_user_updated_at",
        "ai_chat_sessions",
        ["org_id", "user_id", "updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_ai_chat_messages_session_created_at",
        "ai_chat_messages",
        ["session_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_chat_messages_session_created_at", table_name="ai_chat_messages")
    op.drop_index("ix_ai_chat_sessions_org_user_updated_at", table_name="ai_chat_sessions")

