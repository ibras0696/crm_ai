"""add users locale

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-19 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("locale", sa.String(length=8), nullable=False, server_default=sa.text("'ru'")),
    )


def downgrade() -> None:
    op.drop_column("users", "locale")
