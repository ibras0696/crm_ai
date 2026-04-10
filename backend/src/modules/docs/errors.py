"""Ошибки бизнес-логики модуля Docs."""

from __future__ import annotations

from src.common.exceptions import AppError


class DocsModuleError(AppError):
    """Базовая ошибка модуля Docs."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int = 422,
        field: str | None = None,
        details: object | None = None,
    ):
        super().__init__(code=code, message=message, status_code=status_code, field=field, details=details)


class QuotaExceededError(DocsModuleError):
    """Превышен лимит хранилища по тарифу."""

    def __init__(self, message: str = "Достигнут лимит хранилища организации."):
        super().__init__(code="QUOTA_EXCEEDED", message=message, status_code=422)


class InvalidDepthError(DocsModuleError):
    """Нарушено ограничение глубины папок."""

    def __init__(self, message: str = "Максимальная вложенность папок: 2 уровня"):
        super().__init__(code="INVALID_DEPTH", message=message, status_code=422)


class InvalidTypeError(DocsModuleError):
    """Передан неподдерживаемый тип файла."""

    def __init__(self, message: str = "Поддерживаются только TXT, PDF, DOCX"):
        super().__init__(code="INVALID_TYPE", message=message, status_code=422)
