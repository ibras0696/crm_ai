"""Add calls module (call_rooms, call_participants).

Revision ID: 0013_calls_module
Revises: 0012_file_preview_metadata
Create Date: 2026-06-29 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0013_calls_module"
down_revision: str | None = "0012_file_preview_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create enum types explicitly first
    call_room_status_enum = postgresql.ENUM("waiting", "active", "ended", name="call_room_status", create_type=False)
    call_role_enum = postgresql.ENUM("host", "cohost", "participant", name="call_role", create_type=False)
    call_room_status_enum.create(op.get_bind(), checkfirst=True)
    call_role_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "call_rooms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("host_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM("waiting", "active", "ended", name="call_room_status", create_type=False),
            nullable=False,
            server_default="waiting",
        ),
        sa.Column("max_participants", sa.Integer(), nullable=False, server_default="16"),
        sa.Column("recording_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_call_rooms_org_id", "call_rooms", ["org_id"])
    op.create_index("ix_call_rooms_slug", "call_rooms", ["slug"], unique=True)
    op.create_index("ix_call_rooms_created_at", "call_rooms", ["created_at"])

    op.create_table(
        "call_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "room_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("call_rooms.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM("host", "cohost", "participant", name="call_role", create_type=False),
            nullable=False,
            server_default="participant",
        ),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("video_on", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("audio_on", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_call_participants_room_id", "call_participants", ["room_id"])
    op.create_index("ix_call_participants_user_id", "call_participants", ["user_id"])
    op.create_index("ix_call_participants_org_id", "call_participants", ["org_id"])
    op.create_index("ix_call_participants_created_at", "call_participants", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_call_participants_created_at", table_name="call_participants")
    op.drop_index("ix_call_participants_org_id", table_name="call_participants")
    op.drop_index("ix_call_participants_user_id", table_name="call_participants")
    op.drop_index("ix_call_participants_room_id", table_name="call_participants")
    op.drop_table("call_participants")

    op.drop_index("ix_call_rooms_created_at", table_name="call_rooms")
    op.drop_index("ix_call_rooms_slug", table_name="call_rooms")
    op.drop_index("ix_call_rooms_org_id", table_name="call_rooms")
    op.drop_table("call_rooms")

    sa.Enum(name="call_role").drop(op.get_bind())
    sa.Enum(name="call_room_status").drop(op.get_bind())
