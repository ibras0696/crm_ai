"""Database models for access control rules."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class AccessRule(BaseDBModel):
    """Per-resource ACL rule within an organization."""

    __tablename__ = "access_rules"
    __table_args__ = (
        # Exactly one subject type must be set: either role or user_id.
        CheckConstraint("(role IS NULL) <> (user_id IS NULL)", name="ck_access_rules_role_xor_user"),
        # Keep resource types normalized and bounded to supported list.
        CheckConstraint(
            "resource_type IN ('table', 'knowledge', 'ai', 'schedule', 'reports', 'files')",
            name="ck_access_rules_resource_type_valid",
        ),
        # Role is optional, but if present must be one of known org roles.
        CheckConstraint(
            "role IS NULL OR role IN ('owner', 'admin', 'manager', 'employee', 'readonly')",
            name="ck_access_rules_role_valid",
        ),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # null = rule applies to all resources of this type
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    # Subject (XOR):
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Permissions:
    can_read: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_write: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    can_delete: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))

