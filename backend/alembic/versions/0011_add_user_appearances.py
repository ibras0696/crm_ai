"""Add user appearance preferences.

Revision ID: e49a586752b4
Revises: 0010_chat_delivery_harden
Create Date: 2026-06-26 22:45:08.470297

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e49a586752b4"
down_revision: str | None = "0010_chat_delivery_harden"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_appearances",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("mode", sa.String(length=16), server_default=sa.text("'dark'"), nullable=False),
        sa.Column("accent", sa.String(length=32), server_default=sa.text("'teal'"), nullable=False),
        sa.Column("custom_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("primary_h", sa.Float(), server_default=sa.text("174.0"), nullable=False),
        sa.Column("primary_s", sa.Float(), server_default=sa.text("80.0"), nullable=False),
        sa.Column("primary_l", sa.Float(), server_default=sa.text("39.0"), nullable=False),
        sa.Column("radius", sa.Float(), server_default=sa.text("0.5"), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_appearances_created_at"), "user_appearances", ["created_at"], unique=False)
    op.create_index(op.f("ix_user_appearances_deleted_at"), "user_appearances", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_user_appearances_user_id"), "user_appearances", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_user_appearances_user_id"), table_name="user_appearances")
    op.drop_index(op.f("ix_user_appearances_deleted_at"), table_name="user_appearances")
    op.drop_index(op.f("ix_user_appearances_created_at"), table_name="user_appearances")
    op.drop_table("user_appearances")
