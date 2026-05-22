"""add users avatar_url

Revision ID: 0009_add_users_avatar_url
Revises: 0008_add_table_views_is_default
Create Date: 2026-05-22 14:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0009_add_users_avatar_url"
down_revision = "0008_add_table_views_is_default"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")

