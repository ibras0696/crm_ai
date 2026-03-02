"""Pydantic-схемы модуля AI."""

from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """Сообщение для передачи истории чата в запросе."""

    role: str
    content: str


class ChatRequest(BaseModel):
    """Запрос к AI чату.

    Используется фронтом для отправки сообщения и (опционально) истории/контекста.
    """

    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    system_prompt: str | None = None
    ui_intent: str | None = None
    ui_intent_params: dict | None = None
    language: str | None = None
    include_context: bool = True
    chat_id: str | None = None
    request_id: str | None = None
    context_options: dict | None = None


class ChatResponse(BaseModel):
    """Ответ AI чата (текст + usage + опциональный результат действия)."""

    reply: str
    model: str
    usage: dict | None = None
    chat_id: str | None = None
    context_estimate: dict | None = None
    action_result: dict | None = None


class ChatSessionOut(BaseModel):
    """Сессия чата для списка истории (id/title/preview)."""

    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None = None


class ChatMessageOut(BaseModel):
    """Сообщение чата для UI истории."""

    id: str
    role: str
    content: str
    token_count: int | None
    created_at: datetime
    meta: dict | None = None


class CreateChatRequest(BaseModel):
    """Создание новой чат-сессии."""

    title: str | None = None


class ContextEstimateRequest(BaseModel):
    """Запрос на оценку контекста (примерная стоимость в токенах).

    Важно: это оценка/эвристика, т.к. токенизация зависит от провайдера/модели.
    """

    include_context: bool = True
    context_options: dict | None = None
    system_prompt: str | None = None
    history: list[ChatMessage] = Field(default_factory=list)
    user_message: str | None = None
    include_action_instructions: bool = True
