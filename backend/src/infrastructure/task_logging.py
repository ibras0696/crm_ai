"""Helpers for safe structured logging of background task failures."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import logging

_MAX_STRING_LENGTH = 500
_MAX_COLLECTION_ITEMS = 20


def _truncate(text: str, *, limit: int = _MAX_STRING_LENGTH) -> str:
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def sanitize_log_value(value: Any) -> Any:
    """Convert arbitrary task data into log-safe structured payload."""
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return _truncate(value)
    if isinstance(value, Mapping):
        items = list(value.items())[:_MAX_COLLECTION_ITEMS]
        return {str(key): sanitize_log_value(item) for key, item in items}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return [sanitize_log_value(item) for item in list(value)[:_MAX_COLLECTION_ITEMS]]
    if isinstance(value, set):
        return [sanitize_log_value(item) for item in list(value)[:_MAX_COLLECTION_ITEMS]]
    return _truncate(repr(value))


def build_task_failure_log_extra(
    *,
    task_name: str | None,
    task_id: str | None,
    task_args: Any,
    task_kwargs: Any,
    exc: BaseException,
    context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a structured payload that does not collide with LogRecord fields."""
    payload: dict[str, Any] = {
        "task_name": str(task_name or ""),
        "task_id": str(task_id or ""),
        "exception_type": type(exc).__name__,
        "exception_message": _truncate(str(exc)),
        "task_args": sanitize_log_value(task_args),
        "task_kwargs": sanitize_log_value(task_kwargs),
    }
    if context:
        payload["task_context"] = sanitize_log_value(context)
    return payload


def log_task_failure(
    logger: logging.Logger,
    *,
    task_name: str | None,
    task_id: str | None,
    task_args: Any,
    task_kwargs: Any,
    exc: BaseException,
    einfo: Any = None,
    context: Mapping[str, Any] | None = None,
    message: str = "Background task failed",
) -> None:
    """Log a task failure with safe keys and traceback when available."""
    exc_info = getattr(einfo, "exc_info", None)
    if not exc_info or exc_info == (None, None, None):
        exc_info = (type(exc), exc, getattr(exc, "__traceback__", None))
    logger.error(
        message,
        extra=build_task_failure_log_extra(
            task_name=task_name,
            task_id=task_id,
            task_args=task_args,
            task_kwargs=task_kwargs,
            exc=exc,
            context=context,
        ),
        exc_info=exc_info,
    )
