import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Event(BaseDBModel):
    __tablename__ = "events"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Can be a simple keyword (daily/weekly/...) or an RRULE string (e.g. "RRULE:FREQ=WEEKLY;BYDAY=TU").
    recurrence: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    @property
    def participant_ids(self) -> list[uuid.UUID]:
        raw = (self.meta or {}).get("participant_ids") or []
        result: list[uuid.UUID] = []
        for value in raw:
            try:
                result.append(uuid.UUID(str(value)))
            except Exception:
                continue
        return result

    @property
    def reminder_offsets_minutes(self) -> list[int]:
        raw = (self.meta or {}).get("reminder_offsets_minutes") or []
        result: list[int] = []
        for value in raw:
            try:
                result.append(int(value))
            except Exception:
                continue
        return result

    @property
    def reminder_sent_offsets_minutes(self) -> list[int]:
        raw = (self.meta or {}).get("reminder_sent_offsets_minutes") or []
        result: list[int] = []
        for value in raw:
            try:
                result.append(int(value))
            except Exception:
                continue
        return result

    def set_meta_fields(
        self,
        *,
        participant_ids: list[uuid.UUID] | None = None,
        reminder_offsets_minutes: list[int] | None = None,
        reminder_sent_offsets_minutes: list[int] | None = None,
    ) -> None:
        next_meta: dict[str, Any] = dict(self.meta or {})
        if participant_ids is not None:
            next_meta["participant_ids"] = [str(x) for x in participant_ids]
        if reminder_offsets_minutes is not None:
            next_meta["reminder_offsets_minutes"] = reminder_offsets_minutes
        if reminder_sent_offsets_minutes is not None:
            next_meta["reminder_sent_offsets_minutes"] = reminder_sent_offsets_minutes
        self.meta = next_meta
