from __future__ import annotations

from src.common.exceptions import AppError


class BillingModuleError(AppError):
    """Billing module specific error."""

    @classmethod
    def invalid_period(cls) -> "BillingModuleError":
        return cls(code="INVALID_PERIOD", message="Поддерживается только ежемесячная подписка (monthly)", status_code=422)

    @classmethod
    def not_configured(cls) -> "BillingModuleError":
        return cls(
            code="BILLING_NOT_CONFIGURED",
            message="Платежный шлюз не настроен. Добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env",
            status_code=503,
        )

    @classmethod
    def plan_not_found(cls, plan_name: str) -> "BillingModuleError":
        return cls(code="PLAN_NOT_FOUND", message=f"Тариф '{plan_name}' не найден", status_code=404)

    @classmethod
    def free_plan(cls) -> "BillingModuleError":
        return cls(code="FREE_PLAN", message="Этот тариф бесплатный", status_code=422)

    @classmethod
    def payment_required(cls, message: str = "Требуется активная подписка") -> "BillingModuleError":
        return cls(code="PAYMENT_REQUIRED", message=message, status_code=402)

    @classmethod
    def state_conflict(cls, message: str = "Конфликт состояния биллинга") -> "BillingModuleError":
        return cls(code="BILLING_STATE_CONFLICT", message=message, status_code=409)
