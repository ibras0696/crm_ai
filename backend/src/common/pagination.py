"""Pagination utilities and schemas."""

from typing import Generic, TypeVar

from pydantic import BaseModel, Field, field_validator

T = TypeVar("T")


class PaginationParams(BaseModel):
    """Pagination parameters with limits."""

    skip: int = Field(0, ge=0, description="Number of items to skip")
    limit: int = Field(100, ge=1, le=1000, description="Max items to return")

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, v: int) -> int:
        """Enforce hard limit of 1000."""
        return min(v, 1000)


class PaginatedResponse(BaseModel, Generic[T]):  # noqa: UP046
    """Paginated response with metadata."""

    items: list[T]
    total: int
    skip: int
    limit: int
    has_more: bool

    @classmethod
    def create(cls, items: list[T], total: int, skip: int, limit: int):
        """Create paginated response."""
        return cls(items=items, total=total, skip=skip, limit=limit, has_more=(skip + len(items)) < total)


class CursorPaginationParams(BaseModel):
    """Cursor-based pagination for large datasets."""

    cursor: str | None = Field(None, description="Cursor for next page")
    limit: int = Field(100, ge=1, le=1000, description="Max items to return")

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, v: int) -> int:
        return min(v, 1000)


class CursorPaginatedResponse(BaseModel, Generic[T]):  # noqa: UP046
    """Cursor-based paginated response."""

    items: list[T]
    next_cursor: str | None
    has_more: bool
