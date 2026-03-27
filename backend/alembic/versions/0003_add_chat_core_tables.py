"""add chat core tables and extend access rules resource types

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.Column("chat_type", sa.String(length=20), server_default=sa.text("'group'"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("chat_type IN ('direct', 'group', 'channel')", name="ck_chats_chat_type_valid"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("id", "org_id", name="uq_chats_id_org"),
    )
    op.create_index(op.f("ix_chats_created_at"), "chats", ["created_at"], unique=False)
    op.create_index(op.f("ix_chats_deleted_at"), "chats", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_chats_org_id"), "chats", ["org_id"], unique=False)
    op.create_index(op.f("ix_chats_created_by"), "chats", ["created_by"], unique=False)

    op.create_table(
        "chat_members",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("chat_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), server_default=sa.text("'member'"), nullable=False),
        sa.Column("last_read_seq_no", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('owner', 'admin', 'member', 'readonly')", name="ck_chat_members_role_valid"),
        sa.CheckConstraint("last_read_seq_no >= 0", name="ck_chat_members_last_read_seq_no_non_negative"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "user_id", name="uq_chat_members_chat_user"),
    )
    op.create_index(op.f("ix_chat_members_created_at"), "chat_members", ["created_at"], unique=False)
    op.create_index(op.f("ix_chat_members_deleted_at"), "chat_members", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_chat_members_org_id"), "chat_members", ["org_id"], unique=False)
    op.create_index(op.f("ix_chat_members_chat_id"), "chat_members", ["chat_id"], unique=False)
    op.create_index(op.f("ix_chat_members_user_id"), "chat_members", ["user_id"], unique=False)

    op.create_table(
        "chat_messages",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("chat_id", sa.UUID(), nullable=False),
        sa.Column("sender_id", sa.UUID(), nullable=False),
        sa.Column("seq_no", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("body_type", sa.String(length=40), server_default=sa.text("'text_markdown'"), nullable=False),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("seq_no > 0", name="ck_chat_messages_seq_no_positive"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "seq_no", name="uq_chat_messages_chat_seq"),
    )
    op.create_index(op.f("ix_chat_messages_created_at"), "chat_messages", ["created_at"], unique=False)
    op.create_index(op.f("ix_chat_messages_deleted_at"), "chat_messages", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_chat_messages_org_id"), "chat_messages", ["org_id"], unique=False)
    op.create_index(op.f("ix_chat_messages_chat_id"), "chat_messages", ["chat_id"], unique=False)
    op.create_index(op.f("ix_chat_messages_sender_id"), "chat_messages", ["sender_id"], unique=False)

    op.drop_constraint("ck_access_rules_resource_type_valid", "access_rules", type_="check")
    op.create_check_constraint(
        "ck_access_rules_resource_type_valid",
        "access_rules",
        "resource_type IN ('table', 'knowledge', 'ai', 'schedule', 'reports', 'files', 'chat')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_access_rules_resource_type_valid", "access_rules", type_="check")
    op.create_check_constraint(
        "ck_access_rules_resource_type_valid",
        "access_rules",
        "resource_type IN ('table', 'knowledge', 'ai', 'schedule', 'reports', 'files')",
    )

    op.drop_index(op.f("ix_chat_messages_sender_id"), table_name="chat_messages")
    op.drop_index(op.f("ix_chat_messages_chat_id"), table_name="chat_messages")
    op.drop_index(op.f("ix_chat_messages_org_id"), table_name="chat_messages")
    op.drop_index(op.f("ix_chat_messages_deleted_at"), table_name="chat_messages")
    op.drop_index(op.f("ix_chat_messages_created_at"), table_name="chat_messages")
    op.drop_table("chat_messages")

    op.drop_index(op.f("ix_chat_members_user_id"), table_name="chat_members")
    op.drop_index(op.f("ix_chat_members_chat_id"), table_name="chat_members")
    op.drop_index(op.f("ix_chat_members_org_id"), table_name="chat_members")
    op.drop_index(op.f("ix_chat_members_deleted_at"), table_name="chat_members")
    op.drop_index(op.f("ix_chat_members_created_at"), table_name="chat_members")
    op.drop_table("chat_members")

    op.drop_index(op.f("ix_chats_created_by"), table_name="chats")
    op.drop_index(op.f("ix_chats_org_id"), table_name="chats")
    op.drop_index(op.f("ix_chats_deleted_at"), table_name="chats")
    op.drop_index(op.f("ix_chats_created_at"), table_name="chats")
    op.drop_table("chats")
