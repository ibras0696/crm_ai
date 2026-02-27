"""add_docs_ai_generation_jobs

Revision ID: 030
Revises: 029
Create Date: 2026-02-27 15:10:00.000000

"""
# ruff: noqa: TC003

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "030"
down_revision: str | None = "029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "docs_ai_generation_jobs",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("file_id", sa.UUID(), nullable=True),
        sa.Column("file_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("template", sa.String(length=120), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("language", sa.String(length=16), nullable=True),
        sa.Column("provider_model", sa.String(length=120), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("task_id", sa.String(length=120), nullable=True),
        sa.Column("meta_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued','running','scanning','ready','blocked','failed')",
            name="ck_docs_ai_generation_jobs_status",
        ),
        sa.CheckConstraint("prompt_tokens >= 0", name="ck_docs_ai_generation_jobs_prompt_non_negative"),
        sa.CheckConstraint("completion_tokens >= 0", name="ck_docs_ai_generation_jobs_completion_non_negative"),
        sa.CheckConstraint("total_tokens >= 0", name="ck_docs_ai_generation_jobs_total_non_negative"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_docs_ai_generation_jobs_org_id"), "docs_ai_generation_jobs", ["org_id"], unique=False)
    op.create_index(op.f("ix_docs_ai_generation_jobs_user_id"), "docs_ai_generation_jobs", ["user_id"], unique=False)
    op.create_index(op.f("ix_docs_ai_generation_jobs_file_id"), "docs_ai_generation_jobs", ["file_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_docs_ai_generation_jobs_file_id"), table_name="docs_ai_generation_jobs")
    op.drop_index(op.f("ix_docs_ai_generation_jobs_user_id"), table_name="docs_ai_generation_jobs")
    op.drop_index(op.f("ix_docs_ai_generation_jobs_org_id"), table_name="docs_ai_generation_jobs")
    op.drop_table("docs_ai_generation_jobs")
