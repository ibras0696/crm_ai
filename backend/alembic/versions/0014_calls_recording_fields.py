"""Add recording fields to call_rooms.

Revision ID: 0014_calls_recording_fields
Revises: 0013_calls_module
Create Date: 2026-06-29 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_calls_recording_fields"
down_revision: str | None = "0013_calls_module"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("call_rooms", sa.Column("egress_id", sa.String(255), nullable=True))
    op.add_column("call_rooms", sa.Column("recording_file_key", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("call_rooms", "recording_file_key")
    op.drop_column("call_rooms", "egress_id")
