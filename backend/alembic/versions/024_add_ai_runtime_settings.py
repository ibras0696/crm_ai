"""add ai runtime settings

Revision ID: 024
Revises: 023
Create Date: 2026-02-25 02:20:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_runtime_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("model", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("system_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.3"),
        sa.Column("max_tokens_per_request", sa.Integer(), nullable=False, server_default="2000"),
        sa.Column("strict_actions", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.CheckConstraint("temperature >= 0 AND temperature <= 2", name="ck_ai_runtime_settings_temperature_range"),
        sa.CheckConstraint("max_tokens_per_request >= 64", name="ck_ai_runtime_settings_max_tokens_min"),
    )


def downgrade() -> None:
    op.drop_table("ai_runtime_settings")
