import structlog
from fastapi import Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.common.exceptions import BaseAppError

logger = structlog.get_logger()


def _correlation_id(request: Request) -> str | None:
    return getattr(getattr(request, "state", None), "correlation_id", None)


def _json_safe(value):
    """Привести произвольное значение к JSON-сериализуемому виду."""
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [_json_safe(v) for v in value]
    return str(value)


async def app_error_handler(request: Request, exc: BaseAppError) -> JSONResponse:
    correlation_id = _correlation_id(request)
    logger.warning(
        "app_error",
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        path=str(request.url),
        correlation_id=correlation_id,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "ok": False,
            "data": None,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "field": exc.field,
                "details": exc.details,
                "correlation_id": correlation_id,
            },
        },
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    correlation_id = _correlation_id(request)
    safe_errors = _json_safe(exc.errors())
    logger.warning(
        "request_validation_error",
        code="VALIDATION_ERROR",
        path=str(request.url),
        correlation_id=correlation_id,
        errors=safe_errors,
    )
    # Keep FastAPI's normalized error details shape.
    _ = await request_validation_exception_handler(request, exc)
    return JSONResponse(
        status_code=422,
        content={
            "ok": False,
            "data": None,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Validation error",
                "field": None,
                "details": safe_errors,
                "correlation_id": correlation_id,
            },
        },
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    correlation_id = _correlation_id(request)
    code = "HTTP_ERROR"
    if exc.status_code == 404:
        code = "NOT_FOUND"
    elif exc.status_code == 401:
        code = "UNAUTHORIZED"
    elif exc.status_code == 403:
        code = "FORBIDDEN"
    elif exc.status_code == 405:
        code = "METHOD_NOT_ALLOWED"

    logger.warning(
        "http_error",
        code=code,
        status_code=exc.status_code,
        detail=str(exc.detail),
        path=str(request.url),
        correlation_id=correlation_id,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "ok": False,
            "data": None,
            "error": {
                "code": code,
                "message": str(exc.detail),
                "field": None,
                "details": None,
                "correlation_id": correlation_id,
            },
        },
    )


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    correlation_id = _correlation_id(request)
    logger.exception("unhandled_error", path=str(request.url), error=str(exc), correlation_id=correlation_id)
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "field": None,
                "details": None,
                "correlation_id": correlation_id,
            },
        },
    )
