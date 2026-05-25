import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

CHAT_MESSAGE_MAX_CHARS = 500


class CreateChatRequest(BaseModel):
    chat_type: Literal["direct", "group", "channel"] = "group"
    title: str | None = Field(default=None, max_length=255)
    member_ids: list[uuid.UUID] | None = None


class UpdateChatRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class AddChatMemberRequest(BaseModel):
    user_id: uuid.UUID
    role: Literal["owner", "admin", "member", "readonly"] = "member"


class SendChatMessageRequest(BaseModel):
    body: str = Field(default="", max_length=CHAT_MESSAGE_MAX_CHARS)
    body_type: str = Field(default="text_markdown", max_length=40)
    client_message_id: str | None = Field(default=None, min_length=1, max_length=64)
    meta: dict | None = None


class ChatAttachmentInitRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=500)
    size_bytes: int = Field(gt=0)
    content_type: str = Field(min_length=1, max_length=255)


class ChatAttachmentInitOut(BaseModel):
    file_id: uuid.UUID
    upload_url: str
    upload_headers: dict[str, str]
    expires_in: int


class ChatAttachmentFinishRequest(BaseModel):
    file_id: uuid.UUID
    size_bytes: int = Field(gt=0)


class ChatAttachmentOut(BaseModel):
    file_id: uuid.UUID
    filename: str
    original_name: str
    content_type: str
    size: int
    status: str


class ChatAttachmentDownloadOut(BaseModel):
    url: str
    expires_in: int


class UpdateReadCursorRequest(BaseModel):
    last_read_seq_no: int = Field(ge=0)


class ChatOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    created_by: uuid.UUID
    chat_type: str
    title: str | None
    member_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class ChatMemberOut(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    role: str
    last_read_seq_no: int
    created_at: datetime


class ChatMessageOut(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    sender_id: uuid.UUID
    seq_no: int
    client_message_id: str | None = None
    body: str
    body_type: str
    meta: dict | None
    created_at: datetime


class ReadCursorOut(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID
    last_read_seq_no: int


class ChatClientConfigOut(BaseModel):
    realtime_enabled: bool
    realtime_rollout_percent: int = Field(ge=0, le=100)
    telemetry_enabled: bool


class ChatTelemetryRequest(BaseModel):
    event: Literal["ws_reconnect", "message_lag", "attachment_fetch"]
    value: float | None = Field(default=None, ge=0)
    meta: dict | None = None
