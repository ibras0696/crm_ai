"""Метрики AI-чата для оркестратора `chat_controller`."""

from __future__ import annotations

import logging

from src.config import settings
from src.infrastructure.metrics_custom import AI_LIMIT_REJECTIONS_TOTAL, AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL

logger = logging.getLogger(__name__)


def _record_metric(status: str, tokens: int | None = None) -> None:
    """Безопасно записать метрики AI-запроса.

    Args:
        status: Статус запроса для метрики `crm_ai_requests_total`.
        tokens: Количество токенов для `crm_ai_tokens_total` (опционально).

    Returns:
        None.
    """
    try:
        AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status=status).inc()
        if tokens is not None and tokens > 0:
            AI_TOKENS_TOTAL.labels(model=settings.OPENAI_MODEL).inc(float(tokens))
    except (TypeError, ValueError, RuntimeError) as exc:
        logger.warning("ai_metrics_record_failed", exc_info=exc)


def _record_limit_rejection(code: str) -> None:
    """Зафиксировать отклонение запроса лимитером.

    Args:
        code: Код ошибки лимита (например, `AI_RATE_LIMIT`).

    Returns:
        None.
    """
    try:
        AI_LIMIT_REJECTIONS_TOTAL.labels(code=code).inc()
    except (TypeError, ValueError, RuntimeError) as exc:
        logger.warning("ai_limit_rejection_metric_failed", exc_info=exc)
