"""extend_events_recurrence_text

Revision ID: 011
Revises: 010
Create Date: 2026-02-22 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "events",
        "recurrence",
        existing_type=sa.String(length=20),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "events",
        "recurrence",
        existing_type=sa.Text(),
        type_=sa.String(length=20),
        existing_nullable=True,
    )

