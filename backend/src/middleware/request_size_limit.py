from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Enforce max request size using Content-Length when available.
    This avoids reading the body (important for file uploads / streaming).
    """

    def __init__(self, app, *, max_bytes: int):
        super().__init__(app)
        self.max_bytes = int(max(0, max_bytes))

    async def dispatch(self, request: Request, call_next) -> Response:
        if self.max_bytes <= 0:
            return await call_next(request)
        cl = request.headers.get("content-length")
        if cl:
            try:
                n = int(cl)
                if n > self.max_bytes:
                    return JSONResponse(
                        {"ok": False, "data": None, "error": {"code": "REQUEST_TOO_LARGE", "message": "Request too large"}},
                        status_code=413,
                    )
            except Exception:
                pass
        return await call_next(request)

