"""Harden access_rules with constraints and lookup indexes.

Revision ID: 016
Revises: 015
Create Date: 2026-02-22

"""

from typing import Sequence, Union

from alembic import op


revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Normalize existing text values before strict checks.
    op.execute("UPDATE access_rules SET resource_type = lower(trim(resource_type))")
    op.execute("UPDATE access_rules SET role = CASE WHEN role IS NULL THEN NULL ELSE lower(trim(role)) END")

    # Exactly one subject must be set: role XOR user_id.
    op.create_check_constraint(
        "ck_access_rules_role_xor_user",
        "access_rules",
        "(role IS NULL) <> (user_id IS NULL)",
    )
    # Restrict supported resource types.
    op.create_check_constraint(
        "ck_access_rules_resource_type_valid",
        "access_rules",
        "resource_type IN ('table', 'knowledge', 'ai', 'schedule', 'reports', 'files')",
    )
    # Restrict role values for role-based rules.
    op.create_check_constraint(
        "ck_access_rules_role_valid",
        "access_rules",
        "role IS NULL OR role IN ('owner', 'admin', 'manager', 'employee', 'readonly')",
    )

    # Typical ACL lookup index used by access checks.
    op.create_index(
        "ix_access_rules_lookup_scope",
        "access_rules",
        ["org_id", "resource_type", "resource_id", "user_id", "role"],
        unique=False,
    )

    # Enforce uniqueness for (org, resource scope, subject), including NULL resource_id.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_access_rules_scope_subject
        ON access_rules (
          org_id,
          resource_type,
          COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(role, ''),
          COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_access_rules_scope_subject")
    op.drop_index("ix_access_rules_lookup_scope", table_name="access_rules")
    op.drop_constraint("ck_access_rules_role_valid", "access_rules", type_="check")
    op.drop_constraint("ck_access_rules_resource_type_valid", "access_rules", type_="check")
    op.drop_constraint("ck_access_rules_role_xor_user", "access_rules", type_="check")

