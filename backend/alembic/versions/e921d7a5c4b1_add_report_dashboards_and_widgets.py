"""add_report_dashboards_and_widgets

Revision ID: e921d7a5c4b1
Revises: b31f4d2e9c10
Create Date: 2026-02-19 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e921d7a5c4b1"
down_revision: Union[str, None] = "b31f4d2e9c10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_dashboards",
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_report_dashboards_org_id", "report_dashboards", ["org_id"], unique=False)

    op.create_table(
        "report_widgets",
        sa.Column("dashboard_id", sa.UUID(), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), server_default=sa.text("'Новый виджет'"), nullable=False),
        sa.Column("widget_type", sa.String(length=50), server_default=sa.text("'metric'"), nullable=False),
        sa.Column("table_id", sa.UUID(), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["dashboard_id"], ["report_dashboards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["table_id"], ["tables.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_report_widgets_dashboard_id", "report_widgets", ["dashboard_id"], unique=False)
    op.create_index("ix_report_widgets_org_id", "report_widgets", ["org_id"], unique=False)
    op.create_index("ix_report_widgets_table_id", "report_widgets", ["table_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_report_widgets_table_id", table_name="report_widgets")
    op.drop_index("ix_report_widgets_org_id", table_name="report_widgets")
    op.drop_index("ix_report_widgets_dashboard_id", table_name="report_widgets")
    op.drop_table("report_widgets")

    op.drop_index("ix_report_dashboards_org_id", table_name="report_dashboards")
    op.drop_table("report_dashboards")
