"""add_ai_chat_history_tables

Revision ID: 009
Revises: 008
Create Date: 2026-02-19 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_chat_sessions",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=sa.text("'Новый чат'")),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_chat_sessions_org_id", "ai_chat_sessions", ["org_id"], unique=False)
    op.create_index("ix_ai_chat_sessions_user_id", "ai_chat_sessions", ["user_id"], unique=False)

    op.create_table(
        "ai_chat_messages",
        sa.Column("session_id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["ai_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_chat_messages_session_id", "ai_chat_messages", ["session_id"], unique=False)
    op.create_index("ix_ai_chat_messages_org_id", "ai_chat_messages", ["org_id"], unique=False)
    op.create_index("ix_ai_chat_messages_user_id", "ai_chat_messages", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_ai_chat_messages_user_id", table_name="ai_chat_messages")
    op.drop_index("ix_ai_chat_messages_org_id", table_name="ai_chat_messages")
    op.drop_index("ix_ai_chat_messages_session_id", table_name="ai_chat_messages")
    op.drop_table("ai_chat_messages")

    op.drop_index("ix_ai_chat_sessions_user_id", table_name="ai_chat_sessions")
    op.drop_index("ix_ai_chat_sessions_org_id", table_name="ai_chat_sessions")
    op.drop_table("ai_chat_sessions")
