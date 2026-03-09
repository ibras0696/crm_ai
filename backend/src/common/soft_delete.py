"""Soft delete mixin for models."""

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column


class SoftDeleteMixin:
    """Mixin for soft delete functionality."""

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    @property
    def is_deleted(self) -> bool:
        """Check if entity is soft deleted."""
        return self.deleted_at is not None

    def soft_delete(self):
        """Mark entity as deleted."""
        self.deleted_at = datetime.now(UTC)

    def restore(self):
        """Restore soft deleted entity."""
        self.deleted_at = None
