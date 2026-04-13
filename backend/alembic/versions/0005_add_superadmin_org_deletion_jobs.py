"""add superadmin org deletion jobs

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-13 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "superadmin_org_deletion_jobs",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("org_name", sa.String(length=255), nullable=False),
        sa.Column("requested_by", sa.String(length=320), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("task_id", sa.String(length=120), nullable=True),
        sa.Column("progress_total", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("progress_processed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("storage_objects_deleted", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued','running','completed','failed')",
            name="ck_superadmin_org_deletion_jobs_status",
        ),
        sa.CheckConstraint(
            "progress_total >= 0",
            name="ck_superadmin_org_deletion_jobs_progress_total_non_negative",
        ),
        sa.CheckConstraint(
            "progress_processed >= 0",
            name="ck_superadmin_org_deletion_jobs_progress_processed_non_negative",
        ),
        sa.CheckConstraint(
            "storage_objects_deleted >= 0",
            name="ck_superadmin_org_deletion_jobs_storage_deleted_non_negative",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_superadmin_org_deletion_jobs_created_at"),
        "superadmin_org_deletion_jobs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_superadmin_org_deletion_jobs_deleted_at"),
        "superadmin_org_deletion_jobs",
        ["deleted_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_superadmin_org_deletion_jobs_org_id"),
        "superadmin_org_deletion_jobs",
        ["org_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_superadmin_org_deletion_jobs_org_id"), table_name="superadmin_org_deletion_jobs")
    op.drop_index(op.f("ix_superadmin_org_deletion_jobs_deleted_at"), table_name="superadmin_org_deletion_jobs")
    op.drop_index(op.f("ix_superadmin_org_deletion_jobs_created_at"), table_name="superadmin_org_deletion_jobs")
    op.drop_table("superadmin_org_deletion_jobs")
