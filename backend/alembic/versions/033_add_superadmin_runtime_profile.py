"""add superadmin runtime profile

Revision ID: 033
Revises: 032
Create Date: 2026-03-08 00:40:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "superadmin_runtime_settings",
        sa.Column("email", sa.String(length=320), nullable=False, server_default=sa.text("''")),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_superadmin_runtime_settings_created_at"), "superadmin_runtime_settings", ["created_at"], unique=False)
    op.create_index(op.f("ix_superadmin_runtime_settings_deleted_at"), "superadmin_runtime_settings", ["deleted_at"], unique=False)

    op.create_table(
        "superadmin_runtime_secrets",
        sa.Column("password_hash", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_superadmin_runtime_secrets_created_at"), "superadmin_runtime_secrets", ["created_at"], unique=False)
    op.create_index(op.f("ix_superadmin_runtime_secrets_deleted_at"), "superadmin_runtime_secrets", ["deleted_at"], unique=False)

    op.create_table(
        "superadmin_runtime_audits",
        sa.Column("actor", sa.String(length=255), nullable=False, server_default=sa.text("''")),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("changed_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_superadmin_runtime_audits_created_at"), "superadmin_runtime_audits", ["created_at"], unique=False)
    op.create_index(op.f("ix_superadmin_runtime_audits_deleted_at"), "superadmin_runtime_audits", ["deleted_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_superadmin_runtime_audits_deleted_at"), table_name="superadmin_runtime_audits")
    op.drop_index(op.f("ix_superadmin_runtime_audits_created_at"), table_name="superadmin_runtime_audits")
    op.drop_table("superadmin_runtime_audits")

    op.drop_index(op.f("ix_superadmin_runtime_secrets_deleted_at"), table_name="superadmin_runtime_secrets")
    op.drop_index(op.f("ix_superadmin_runtime_secrets_created_at"), table_name="superadmin_runtime_secrets")
    op.drop_table("superadmin_runtime_secrets")

    op.drop_index(op.f("ix_superadmin_runtime_settings_deleted_at"), table_name="superadmin_runtime_settings")
    op.drop_index(op.f("ix_superadmin_runtime_settings_created_at"), table_name="superadmin_runtime_settings")
    op.drop_table("superadmin_runtime_settings")
