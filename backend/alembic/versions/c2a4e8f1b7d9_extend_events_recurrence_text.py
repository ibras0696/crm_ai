"""extend_events_recurrence_text

Revision ID: c2a4e8f1b7d9
Revises: d1e2f3a4b5c6
Create Date: 2026-02-22 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c2a4e8f1b7d9"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
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

