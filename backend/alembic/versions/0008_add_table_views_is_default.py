"""add is_default to table_views

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-25
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "table_views",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("table_views", "is_default")
