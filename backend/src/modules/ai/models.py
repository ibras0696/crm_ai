"""Модели БД для модуля AI."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class AIUsageLog(BaseDBModel):
    """Лог использования AI.

    Хранит агрегированные метрики по одному обращению к AI-провайдеру:
    - сколько токенов было потрачено
    - какая модель использовалась
    - краткое превью сообщения (для отладки/аналитики)
    """

    __tablename__ = "ai_usage_logs"
    __table_args__ = (
        CheckConstraint("prompt_tokens >= 0", name="ck_ai_usage_logs_prompt_tokens_non_negative"),
        CheckConstraint("completion_tokens >= 0", name="ck_ai_usage_logs_completion_tokens_non_negative"),
        CheckConstraint("total_tokens >= 0", name="ck_ai_usage_logs_total_tokens_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    message_preview: Mapped[str | None] = mapped_column(Text, nullable=True)


class AIChatSession(BaseDBModel):
    """Сессия чата AI для конкретного пользователя в рамках организации."""

    __tablename__ = "ai_chat_sessions"
    __table_args__ = (
        UniqueConstraint("id", "org_id", "user_id", name="uq_ai_chat_sessions_id_org_user"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Новый чат")


class AIChatMessage(BaseDBModel):
    """Сообщение внутри AI-сессии (user/assistant/system)."""

    __tablename__ = "ai_chat_messages"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'system', 'tool')", name="ck_ai_chat_messages_role_valid"),
        CheckConstraint("token_count IS NULL OR token_count >= 0", name="ck_ai_chat_messages_token_count_non_negative"),
        ForeignKeyConstraint(
            ["session_id", "org_id", "user_id"],
            ["ai_chat_sessions.id", "ai_chat_sessions.org_id", "ai_chat_sessions.user_id"],
            ondelete="CASCADE",
            name="fk_ai_chat_messages_session_org_user",
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class AIRuntimeSettings(BaseDBModel):
    """Глобальные runtime-настройки AI (управляются супер-админом)."""

    __tablename__ = "ai_runtime_settings"
    __table_args__ = (
        CheckConstraint("temperature >= 0 AND temperature <= 2", name="ck_ai_runtime_settings_temperature_range"),
        CheckConstraint("max_tokens_per_request >= 64", name="ck_ai_runtime_settings_max_tokens_min"),
    )

    model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    max_tokens_per_request: Mapped[int] = mapped_column(Integer, nullable=False, default=2000)
    strict_actions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
