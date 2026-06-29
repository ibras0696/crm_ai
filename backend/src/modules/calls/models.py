import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class CallRoomStatus(str, enum.Enum):
    waiting = "waiting"
    active = "active"
    ended = "ended"


class CallRole(str, enum.Enum):
    host = "host"
    cohost = "cohost"
    participant = "participant"


class CallRoom(BaseDBModel):
    __tablename__ = "call_rooms"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    host_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    chat_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    status: Mapped[CallRoomStatus] = mapped_column(
        Enum(CallRoomStatus, name="call_room_status"),
        nullable=False,
        default=CallRoomStatus.waiting,
    )
    max_participants: Mapped[int] = mapped_column(Integer, nullable=False, default=16)
    recording_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    egress_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recording_file_key: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CallParticipant(BaseDBModel):
    __tablename__ = "call_participants"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("call_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    role: Mapped[CallRole] = mapped_column(
        Enum(CallRole, name="call_role"),
        nullable=False,
        default=CallRole.participant,
    )
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    audio_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
