"""Pydantic schemas for AI module."""

from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    system_prompt: str | None = None
    include_context: bool = True
    chat_id: str | None = None
    context_options: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: dict | None = None
    chat_id: str | None = None
    context_estimate: dict | None = None
    action_result: dict | None = None


class ChatSessionOut(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    token_count: int | None
    created_at: datetime
    meta: dict | None = None


class CreateChatRequest(BaseModel):
    title: str | None = None


class ContextEstimateRequest(BaseModel):
    include_context: bool = True
    context_options: dict | None = None
    system_prompt: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)
    user_message: str | None = None
    include_action_instructions: bool = True
