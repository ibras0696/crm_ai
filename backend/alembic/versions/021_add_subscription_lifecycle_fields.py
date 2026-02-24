"""add lifecycle fields to subscriptions

Revision ID: 021
Revises: 020
Create Date: 2026-02-24 14:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subscriptions", sa.Column("grace_period_end", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscriptions", sa.Column("data_purge_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscriptions", sa.Column("pre_expiry_notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscriptions", sa.Column("post_expiry_notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscriptions", sa.Column("downgraded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("subscriptions", sa.Column("data_purged_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("subscriptions", "data_purged_at")
    op.drop_column("subscriptions", "downgraded_at")
    op.drop_column("subscriptions", "post_expiry_notified_at")
    op.drop_column("subscriptions", "pre_expiry_notified_at")
    op.drop_column("subscriptions", "data_purge_at")
    op.drop_column("subscriptions", "grace_period_end")
