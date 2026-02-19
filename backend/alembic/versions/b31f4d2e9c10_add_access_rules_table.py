"""add_access_rules_table

Revision ID: b31f4d2e9c10
Revises: a7e9b1c2d3f4
Create Date: 2026-02-19 14:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b31f4d2e9c10"
down_revision: Union[str, None] = "a7e9b1c2d3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "access_rules",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("resource_type", sa.String(length=50), nullable=False),
        sa.Column("resource_id", sa.UUID(), nullable=True),
        sa.Column("role", sa.String(length=50), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("can_read", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("can_write", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("can_delete", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_access_rules_org_id", "access_rules", ["org_id"], unique=False)
    op.create_index("ix_access_rules_resource_type", "access_rules", ["resource_type"], unique=False)
    op.create_index("ix_access_rules_resource_id", "access_rules", ["resource_id"], unique=False)
    op.create_index("ix_access_rules_user_id", "access_rules", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_access_rules_user_id", table_name="access_rules")
    op.drop_index("ix_access_rules_resource_id", table_name="access_rules")
    op.drop_index("ix_access_rules_resource_type", table_name="access_rules")
    op.drop_index("ix_access_rules_org_id", table_name="access_rules")
    op.drop_table("access_rules")
