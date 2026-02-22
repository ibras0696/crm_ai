"""Add targeted indexes for access rule matching paths.

Revision ID: 017
Revises: 016
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_access_rules_match_user",
        "access_rules",
        ["org_id", "resource_type", "resource_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_access_rules_match_role",
        "access_rules",
        ["org_id", "resource_type", "resource_id", "role"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_access_rules_match_role", table_name="access_rules")
    op.drop_index("ix_access_rules_match_user", table_name="access_rules")

