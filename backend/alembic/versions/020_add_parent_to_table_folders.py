"""add parent_id to table_folders for nested folders

Revision ID: 020
Revises: 019
Create Date: 2026-02-24 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("table_folders", sa.Column("parent_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_table_folders_parent_id",
        "table_folders",
        "table_folders",
        ["parent_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_table_folders_parent_id", "table_folders", ["parent_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_table_folders_parent_id", table_name="table_folders")
    op.drop_constraint("fk_table_folders_parent_id", "table_folders", type_="foreignkey")
    op.drop_column("table_folders", "parent_id")
