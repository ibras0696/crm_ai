"""Add file preview metadata.

Revision ID: 0012_file_preview_metadata
Revises: e49a586752b4
Create Date: 2026-06-29 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0012_file_preview_metadata"
down_revision: str | None = "e49a586752b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("files", sa.Column("preview_s3_key", sa.String(length=1000), nullable=True))
    op.add_column("files", sa.Column("preview_s3_bucket", sa.String(length=255), nullable=True))
    op.add_column("files", sa.Column("preview_content_type", sa.String(length=255), nullable=True))
    op.add_column("files", sa.Column("preview_size", sa.BigInteger(), nullable=True))
    op.add_column("files", sa.Column("preview_status", sa.String(length=32), nullable=True))
    op.add_column("files", sa.Column("preview_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_index(op.f("ix_files_preview_status"), "files", ["preview_status"], unique=False)
    op.create_unique_constraint("uq_files_preview_s3_key", "files", ["preview_s3_key"])


def downgrade() -> None:
    op.drop_constraint("uq_files_preview_s3_key", "files", type_="unique")
    op.drop_index(op.f("ix_files_preview_status"), table_name="files")
    op.drop_column("files", "preview_meta")
    op.drop_column("files", "preview_status")
    op.drop_column("files", "preview_size")
    op.drop_column("files", "preview_content_type")
    op.drop_column("files", "preview_s3_bucket")
    op.drop_column("files", "preview_s3_key")
