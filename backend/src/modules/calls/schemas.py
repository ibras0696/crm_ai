import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from src.modules.calls.models import CallRole, CallRoomStatus


class CreateRoomRequest(BaseModel):
    title: str | None = None
    max_participants: int = 16


class RoomOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    title: str | None
    host_id: uuid.UUID
    chat_id: uuid.UUID | None
    status: CallRoomStatus
    max_participants: int
    recording_enabled: bool
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JoinRoomResponse(BaseModel):
    livekit_token: str
    livekit_url: str
    room: RoomOut


class InviteRequest(BaseModel):
    user_ids: list[uuid.UUID]


class ParticipantOut(BaseModel):
    id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: CallRole
    joined_at: datetime
    left_at: datetime | None
    duration_seconds: int | None
    video_on: bool
    audio_on: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CallHistoryOut(BaseModel):
    id: uuid.UUID
    slug: str
    title: str | None
    status: CallRoomStatus
    host_id: uuid.UUID
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: int | None  # computed: ended_at - started_at if both present
    participant_count: int  # number of participants in this room
    my_role: CallRole  # the role of the requesting user in this room
    my_duration_seconds: int | None  # this user's duration
    created_at: datetime

    model_config = {"from_attributes": False}


class InviteToCallRequest(BaseModel):
    user_ids: list[uuid.UUID]


class WebhookPayload(BaseModel):
    event: str
    room: dict[str, Any] | None = None
    participant: dict[str, Any] | None = None

    model_config = {"extra": "allow"}


class RecordingStatusOut(BaseModel):
    room_slug: str
    recording_enabled: bool
    egress_id: str | None
    recording_file_key: str | None
    presigned_url: str | None  # generated on demand for download


class MuteParticipantRequest(BaseModel):
    source: Literal["audio", "screenshare"] = "audio"
