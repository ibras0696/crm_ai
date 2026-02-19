"""Simple in-memory rate limiter middleware."""
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket rate limiter per IP. Defaults: 60 req/min."""

    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.rpm = requests_per_minute
        self.buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60.0

        # Clean old entries
        self.buckets[client_ip] = [t for t in self.buckets[client_ip] if now - t < window]

        if len(self.buckets[client_ip]) >= self.rpm:
            return JSONResponse(
                status_code=429,
                content={"ok": False, "error": {"code": "RATE_LIMITED", "message": "Слишком много запросов. Попробуйте позже."}},
                headers={"Retry-After": "60"},
            )

        self.buckets[client_ip].append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.rpm)
        response.headers["X-RateLimit-Remaining"] = str(self.rpm - len(self.buckets[client_ip]))
        return response
