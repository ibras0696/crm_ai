"""Add AI limits to plans.

Revision ID: f1a2b3c4d5e6
Revises: c2a4e8f1b7d9
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "c2a4e8f1b7d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("plans") as b:
        b.add_column(sa.Column("ai_max_tokens_per_request", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("ai_tokens_per_day", sa.Integer(), nullable=False, server_default="0"))
        b.add_column(sa.Column("ai_rpm_per_user", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("plans") as b:
        b.drop_column("ai_rpm_per_user")
        b.drop_column("ai_tokens_per_day")
        b.drop_column("ai_max_tokens_per_request")

