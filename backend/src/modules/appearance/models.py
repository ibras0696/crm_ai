import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class UserAppearance(BaseDBModel):
    __tablename__ = "user_appearances"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="dark", server_default=text("'dark'"))
    accent: Mapped[str] = mapped_column(String(32), nullable=False, default="teal", server_default=text("'teal'"))
    custom_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    primary_h: Mapped[float] = mapped_column(Float, nullable=False, default=174.0, server_default=text("174.0"))
    primary_s: Mapped[float] = mapped_column(Float, nullable=False, default=80.0, server_default=text("80.0"))
    primary_l: Mapped[float] = mapped_column(Float, nullable=False, default=39.0, server_default=text("39.0"))
    radius: Mapped[float] = mapped_column(Float, nullable=False, default=0.5, server_default=text("0.5"))
