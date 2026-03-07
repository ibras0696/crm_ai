"""add_file_versions_meta_json

Revision ID: 029
Revises: 028
Create Date: 2026-02-27 07:05:00.000000

"""
# ruff: noqa: TC003

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "029"
down_revision: str | None = "028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("file_versions", sa.Column("meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("file_versions", "meta_json")

