from __future__ import annotations

from src.common.exceptions import AppError


class KnowledgeModuleError(AppError):
    """Knowledge module specific error."""

    def __init__(self, *, code: str, message: str, status_code: int = 422):
        super().__init__(code=code, message=message, status_code=status_code)

    @classmethod
    def limit_reached(cls) -> "KnowledgeModuleError":
        return cls(
            code="KNOWLEDGE_LIMIT_REACHED",
            message="Достигнут лимит тарифа по базе знаний.",
            status_code=422,
        )
