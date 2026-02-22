"""Add AI limits to plans.

Revision ID: 012
Revises: 011
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012"
down_revision: Union[str, None] = "011"
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

