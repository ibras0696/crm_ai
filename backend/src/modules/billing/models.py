import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Integer, Boolean, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Plan(BaseDBModel):
    __tablename__ = "plans"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    price_monthly: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # cents
    price_yearly: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_members: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    max_tables: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    max_records: Mapped[int] = mapped_column(Integer, nullable=False, default=1000)
    max_storage_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    has_ai: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # AI limits (source of truth for org limits; can be edited in admin panel).
    ai_max_tokens_per_request: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_tokens_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ai_rpm_per_user: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    features: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
