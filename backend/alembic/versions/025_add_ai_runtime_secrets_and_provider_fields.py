"""add ai runtime provider fields and secret storage

Revision ID: 025
Revises: 024
Create Date: 2026-02-27 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "025"
down_revision = "024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_runtime_settings",
        sa.Column("ai_base_url", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_runtime_settings",
        sa.Column("ai_provider_mode", sa.String(length=40), nullable=False, server_default="openai_compatible"),
    )
    op.create_check_constraint(
        "ck_ai_runtime_settings_provider_mode",
        "ai_runtime_settings",
        "ai_provider_mode IN ('openai_compatible', 'timeweb_native')",
    )

    op.create_table(
        "ai_runtime_secrets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("bearer_token_encrypted", sa.Text(), nullable=False, server_default=""),
    )

    op.create_table(
        "ai_runtime_audits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("actor", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("changed_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("ai_runtime_audits")
    op.drop_table("ai_runtime_secrets")
    op.drop_constraint("ck_ai_runtime_settings_provider_mode", "ai_runtime_settings", type_="check")
    op.drop_column("ai_runtime_settings", "ai_provider_mode")
    op.drop_column("ai_runtime_settings", "ai_base_url")
