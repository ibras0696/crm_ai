"""add chat upload sessions table

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-28 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chat_upload_sessions",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("chat_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("file_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'uploading'"), nullable=False),
        sa.Column("expected_size", sa.Integer(), nullable=False),
        sa.Column("expected_content_type", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('uploading', 'ready', 'aborted', 'expired')",
            name="ck_chat_upload_sessions_status_valid",
        ),
        sa.CheckConstraint("expected_size > 0", name="ck_chat_upload_sessions_expected_size_positive"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("file_id", name="uq_chat_upload_sessions_file_id"),
    )
    op.create_index(op.f("ix_chat_upload_sessions_created_at"), "chat_upload_sessions", ["created_at"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_deleted_at"), "chat_upload_sessions", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_org_id"), "chat_upload_sessions", ["org_id"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_chat_id"), "chat_upload_sessions", ["chat_id"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_user_id"), "chat_upload_sessions", ["user_id"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_file_id"), "chat_upload_sessions", ["file_id"], unique=False)
    op.create_index(op.f("ix_chat_upload_sessions_expires_at"), "chat_upload_sessions", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_chat_upload_sessions_expires_at"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_file_id"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_user_id"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_chat_id"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_org_id"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_deleted_at"), table_name="chat_upload_sessions")
    op.drop_index(op.f("ix_chat_upload_sessions_created_at"), table_name="chat_upload_sessions")
    op.drop_table("chat_upload_sessions")
