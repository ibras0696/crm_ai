import uuid

from sqlalchemy import ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.common.base_model import BaseDBModel


class ReportDashboard(BaseDBModel):
    __tablename__ = "report_dashboards"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    widgets: Mapped[list["ReportWidget"]] = relationship(
        "ReportWidget",
        back_populates="dashboard",
        cascade="all, delete-orphan",
        order_by="ReportWidget.position",
    )


class ReportWidget(BaseDBModel):
    __tablename__ = "report_widgets"

    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("report_dashboards.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(255), nullable=False, default="Новый виджет", server_default=text("'Новый виджет'")
    )
    widget_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="metric", server_default=text("'metric'")
    )
    table_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tables.id", ondelete="SET NULL"), nullable=True, index=True
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    dashboard: Mapped[ReportDashboard] = relationship("ReportDashboard", back_populates="widgets")
