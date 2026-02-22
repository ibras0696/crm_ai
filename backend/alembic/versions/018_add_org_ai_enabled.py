"""Add organization-level AI kill switch flag.

Revision ID: 018
Revises: 017
Create Date: 2026-02-22

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("ai_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("organizations", "ai_enabled")
