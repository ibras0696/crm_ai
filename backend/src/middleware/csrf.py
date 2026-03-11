"""CSRF protection middleware."""

import logging
import secrets
from typing import ClassVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)


class CSRFMiddleware(BaseHTTPMiddleware):
    """CSRF protection for state-changing requests."""

    SAFE_METHODS: ClassVar[set[str]] = {"GET", "HEAD", "OPTIONS", "TRACE"}
    CSRF_COOKIE_NAME = "csrf_token"
    CSRF_HEADER_NAME = "X-CSRF-Token"

    def __init__(self, app, exempt_paths: list[str] | None = None):
        super().__init__(app)
        self.exempt_paths = exempt_paths or []

    async def dispatch(self, request: Request, call_next):
        # Skip CSRF for safe methods
        if request.method in self.SAFE_METHODS:
            return await self._set_csrf_cookie(request, call_next)

        # Skip CSRF for exempt paths
        if any(request.url.path.startswith(path) for path in self.exempt_paths):
            return await call_next(request)

        # Verify CSRF token
        token = request.headers.get(self.CSRF_HEADER_NAME)
        cookie_token = request.cookies.get(self.CSRF_COOKIE_NAME)

        if not token or not cookie_token or token != cookie_token:
            logger.warning(
                f"CSRF token validation failed for {request.method} {request.url.path}",
                extra={
                    "ip": request.client.host if request.client else None,
                    "has_header": bool(token),
                    "has_cookie": bool(cookie_token),
                    "match": token == cookie_token if token and cookie_token else False,
                },
            )
            return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)

        return await call_next(request)

    async def _set_csrf_cookie(self, request: Request, call_next) -> Response:
        """Set CSRF token cookie if not present."""
        response = await call_next(request)

        if not request.cookies.get(self.CSRF_COOKIE_NAME):
            csrf_token = secrets.token_urlsafe(32)
            response.set_cookie(
                self.CSRF_COOKIE_NAME,
                csrf_token,
                httponly=False,  # JS needs to read it
                samesite="strict",
                secure=False,  # Set to True in production with HTTPS
                max_age=86400,  # 24 hours
            )

        return response
