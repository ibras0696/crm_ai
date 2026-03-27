import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


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
    body: str = Field(min_length=1)
    body_type: str = Field(default="text_markdown", max_length=40)
    meta: dict | None = None


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
    body: str
    body_type: str
    meta: dict | None
    created_at: datetime


class ReadCursorOut(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID
    last_read_seq_no: int

