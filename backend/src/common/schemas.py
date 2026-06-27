from typing import Any

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str
    field: str | None = None
    details: Any | None = None
    correlation_id: str | None = None


class ApiResponse[T](BaseModel):
    ok: bool = True
    data: T | None = None
    error: ErrorDetail | None = None
    meta: dict[str, Any] | None = None


class PaginationMeta(BaseModel):
    total: int | None = None
    page: int | None = None
    per_page: int
    has_next: bool = False


class PaginatedResponse[T](BaseModel):
    ok: bool = True
    data: list[T] = []
    meta: PaginationMeta | None = None
    error: ErrorDetail | None = None
