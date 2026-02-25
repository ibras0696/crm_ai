from __future__ import annotations

from src.common.exceptions import AppError


class FilesModuleError(AppError):
    """Files module specific error."""

    def __init__(self, *, code: str, message: str, status_code: int = 422):
        super().__init__(code=code, message=message, status_code=status_code)
