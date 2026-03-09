from __future__ import annotations

from src.common.exceptions import AppError


class AIModuleError(AppError):
    """AI module specific error."""

    @classmethod
    def provider_timeout(cls) -> AIModuleError:
        return cls(code="AI_PROVIDER_TIMEOUT", message="AI provider timeout.", status_code=504)

    @classmethod
    def provider_unavailable(cls) -> AIModuleError:
        return cls(code="AI_PROVIDER_UNAVAILABLE", message="AI provider is unavailable.", status_code=503)

    @classmethod
    def provider_bad_response(cls) -> AIModuleError:
        return cls(
            code="AI_BAD_PROVIDER_RESPONSE",
            message="AI provider returned an invalid response format.",
            status_code=502,
        )

    @classmethod
    def internal(cls) -> AIModuleError:
        return cls(code="AI_INTERNAL_ERROR", message="Внутренняя ошибка AI сервиса.", status_code=500)
