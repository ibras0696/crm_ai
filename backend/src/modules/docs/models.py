"""SQLAlchemy-модели модуля Docs (метаданные файлов, версий и usage)."""
# ruff: noqa: TC003

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Folder(BaseDBModel):
    """Папка документов организации (допускается глубина до 2 уровней)."""

    __tablename__ = "folders"

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
        index=True,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))


class FileVersion(BaseDBModel):
    """Версия файла: неизменяемая ссылка на конкретный объект в S3."""

    __tablename__ = "file_versions"

    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("files.id", name="fk_file_versions_file_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    s3_key: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    s3_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mime: Mapped[str] = mapped_column(String(255), nullable=False)
    meta_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


class OrgStorageUsage(BaseDBModel):
    """Агрегированное использование хранилища по организации."""

    __tablename__ = "org_storage_usage"
    __table_args__ = (
        CheckConstraint("used_bytes >= 0", name="ck_org_storage_usage_used_non_negative"),
        CheckConstraint("reserved_bytes >= 0", name="ck_org_storage_usage_reserved_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        unique=True,
    )
    used_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))
    reserved_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default=text("0"))


class DocsAIGenerationJob(BaseDBModel):
    """Очередь AI-генерации документов (асинхронный pipeline)."""

    __tablename__ = "docs_ai_generation_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','scanning','ready','blocked','failed')",
            name="ck_docs_ai_generation_jobs_status",
        ),
        CheckConstraint("prompt_tokens >= 0", name="ck_docs_ai_generation_jobs_prompt_non_negative"),
        CheckConstraint("completion_tokens >= 0", name="ck_docs_ai_generation_jobs_completion_non_negative"),
        CheckConstraint("total_tokens >= 0", name="ck_docs_ai_generation_jobs_total_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", server_default=text("'queued'"))
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    template: Mapped[str | None] = mapped_column(String(120), nullable=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    provider_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    meta_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
