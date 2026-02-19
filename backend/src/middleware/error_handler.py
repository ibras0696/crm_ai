import structlog
from fastapi import Request
from fastapi.responses import JSONResponse

from src.common.exceptions import AppError

logger = structlog.get_logger()


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    logger.warning(
        "app_error",
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
        path=str(request.url),
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
            },
        },
    )


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_error", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "data": None,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "field": None,
            },
        },
    )
