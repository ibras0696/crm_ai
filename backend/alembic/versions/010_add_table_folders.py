"""add_table_folders

Revision ID: 010
Revises: 009
Create Date: 2026-02-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'table_folders',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('org_id', UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index('ix_table_folders_org_id', 'table_folders', ['org_id'], unique=False)

    op.add_column('tables', sa.Column('folder_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_tables_folder_id',
        'tables', 'table_folders',
        ['folder_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_tables_folder_id', 'tables', ['folder_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_tables_folder_id', table_name='tables')
    op.drop_constraint('fk_tables_folder_id', 'tables', type_='foreignkey')
    op.drop_column('tables', 'folder_id')
    op.drop_index('ix_table_folders_org_id', table_name='table_folders')
    op.drop_table('table_folders')
