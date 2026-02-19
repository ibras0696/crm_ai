"""Access control models — per-resource permissions for org members."""
import uuid

from sqlalchemy import ForeignKey, String, Boolean, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class AccessRule(BaseDBModel):
    """Row-level permission: who can access what resource."""
    __tablename__ = "access_rules"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    # Target resource
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # table, knowledge, ai, schedule, reports
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)  # null = all of that type
    # Who
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)  # null = specific user
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    # Permissions
    can_read: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_write: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
