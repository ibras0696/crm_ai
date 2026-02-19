"""add_position_to_table_records

Revision ID: a7e9b1c2d3f4
Revises: dac9a1aa1a4b
Create Date: 2026-02-19 11:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7e9b1c2d3f4'
down_revision: Union[str, None] = 'dac9a1aa1a4b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('table_records', sa.Column('position', sa.Integer(), nullable=True, server_default=sa.text('0')))

    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (PARTITION BY table_id ORDER BY created_at, id) - 1 AS pos
            FROM table_records
        )
        UPDATE table_records tr
        SET position = ranked.pos
        FROM ranked
        WHERE tr.id = ranked.id
        """
    )

    op.alter_column('table_records', 'position', nullable=False)
    op.create_index('ix_table_records_table_id_position', 'table_records', ['table_id', 'position'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_table_records_table_id_position', table_name='table_records')
    op.drop_column('table_records', 'position')
