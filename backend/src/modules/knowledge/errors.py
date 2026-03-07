from __future__ import annotations

from src.common.exceptions import AppError


class KnowledgeModuleError(AppError):
    """Knowledge module specific error."""

    @classmethod
    def limit_reached(cls) -> "KnowledgeModuleError":
        return cls(
            code="KNOWLEDGE_LIMIT_REACHED",
            message="Достигнут лимит тарифа по базе знаний.",
            status_code=422,
        )
