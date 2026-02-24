"""Add security-focused audit actions.

Revision ID: 019
Revises: 018
Create Date: 2026-02-24
"""

from typing import Sequence, Union

from alembic import op

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL enum values are append-only.
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'login_failed'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'access_denied'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'token_anomaly'")


def downgrade() -> None:
    # Enum value removal is not supported safely without type recreation.
    pass
