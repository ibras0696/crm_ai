"""Add HTML content metadata to knowledge pages.

Revision ID: 0015_add_kb_html_content
Revises: 0014_calls_recording_fields
Create Date: 2026-06-30 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_add_kb_html_content"
down_revision: str | None = "0014_calls_recording_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("kb_pages", sa.Column("sanitized_content", sa.Text(), nullable=True))
    op.add_column(
        "kb_pages",
        sa.Column("content_type", sa.String(length=32), server_default="text", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("kb_pages", "content_type")
    op.drop_column("kb_pages", "sanitized_content")
