"""harden billing payment idempotency

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    duplicate = conn.execute(
        sa.text(
            """
            SELECT payment_id
            FROM token_purchases
            WHERE payment_id IS NOT NULL
            GROUP BY payment_id
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "Cannot add uq_token_purchases_payment_id: duplicate payment_id exists in token_purchases"
        )

    op.create_unique_constraint(
        "uq_token_purchases_payment_id",
        "token_purchases",
        ["payment_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_token_purchases_payment_id", "token_purchases", type_="unique")
