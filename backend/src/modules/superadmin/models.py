from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel

# SQLAlchemy resolves annotation names at runtime for declarative models.
_RUNTIME_TYPES = (uuid.UUID, datetime)


class SuperadminRuntimeSettings(BaseDBModel):
    """Runtime-профиль супер-админа с fallback на env."""

    __tablename__ = "superadmin_runtime_settings"

    email: Mapped[str] = mapped_column(String(320), nullable=False, default="")


class SuperadminRuntimeSecret(BaseDBModel):
    """Секреты/хэши супер-админа, управляемые из runtime."""

    __tablename__ = "superadmin_runtime_secrets"

    password_hash: Mapped[str] = mapped_column(Text, nullable=False, default="")


class SuperadminRuntimeAudit(BaseDBModel):
    """Аудит изменений runtime-профиля супер-админа."""

    __tablename__ = "superadmin_runtime_audits"

    actor: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    changed_fields: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class SuperadminOrgDeletionJob(BaseDBModel):
    """Фоновая задача полного удаления организации."""

    __tablename__ = "superadmin_org_deletion_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','completed','failed')",
            name="ck_superadmin_org_deletion_jobs_status",
        ),
        CheckConstraint("progress_total >= 0", name="ck_superadmin_org_deletion_jobs_progress_total_non_negative"),
        CheckConstraint(
            "progress_processed >= 0",
            name="ck_superadmin_org_deletion_jobs_progress_processed_non_negative",
        ),
        CheckConstraint(
            "storage_objects_deleted >= 0",
            name="ck_superadmin_org_deletion_jobs_storage_deleted_non_negative",
        ),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    org_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    requested_by: Mapped[str] = mapped_column(String(320), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="queued", server_default=text("'queued'"))
    task_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    progress_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    progress_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    storage_objects_deleted: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
