from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorDetail(BaseModel):
    code: str
    message: str
    field: str | None = None
    details: Any | None = None
    correlation_id: str | None = None


class ApiResponse(BaseModel, Generic[T]):
    ok: bool = True
    data: T | None = None
    error: ErrorDetail | None = None
    meta: dict[str, Any] | None = None


class PaginationMeta(BaseModel):
    total: int | None = None
    page: int | None = None
    per_page: int
    has_next: bool = False


class PaginatedResponse(BaseModel, Generic[T]):
    ok: bool = True
    data: list[T] = []
    meta: PaginationMeta | None = None
    error: ErrorDetail | None = None
