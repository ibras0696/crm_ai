from typing import Any


class BaseAppError(Exception):
    """Base application error with stable API contract fields."""

    def __init__(self, code: str, message: str, status_code: int = 400, field: str | None = None, details: Any = None):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.field = field
        self.details = details
        super().__init__(message)


class AppError(BaseAppError):
    """Backward-compatible app error alias used across modules."""


class NotFoundError(AppError):
    def __init__(self, entity: str = "Resource", field: str | None = None):
        super().__init__(code="NOT_FOUND", message=f"{entity} not found", status_code=404, field=field)


class ConflictError(AppError):
    def __init__(self, message: str = "Resource already exists", field: str | None = None):
        super().__init__(code="CONFLICT", message=message, status_code=409, field=field)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Access denied"):
        super().__init__(code="FORBIDDEN", message=message, status_code=403)


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Not authenticated"):
        super().__init__(code="UNAUTHORIZED", message=message, status_code=401)


class ValidationError(AppError):
    def __init__(self, message: str = "Validation error", field: str | None = None):
        super().__init__(code="VALIDATION_ERROR", message=message, status_code=422, field=field)


class PaymentRequiredError(AppError):
    def __init__(self, message: str = "Active subscription required"):
        super().__init__(code="PAYMENT_REQUIRED", message=message, status_code=402)


class RateLimitError(AppError):
    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(code="RATE_LIMIT", message=message, status_code=429)
