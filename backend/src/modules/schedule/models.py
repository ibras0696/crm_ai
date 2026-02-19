import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Boolean, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Event(BaseDBModel):
    __tablename__ = "events"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    recurrence: Mapped[str | None] = mapped_column(String(20), nullable=True)  # daily|weekly|monthly|yearly
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
