from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


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
