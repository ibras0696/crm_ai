"""Redis-backed shared rate limiter middleware."""

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from src.config import settings
from src.infrastructure.redis import get_redis


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Shared fixed-window rate limiter per IP. Defaults: 60 req/min."""

    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.rpm = requests_per_minute
        self.prefix = (settings.RATE_LIMIT_REDIS_PREFIX or "rate_limit").strip() or "rate_limit"
        # Fallback for temporary Redis failures.
        self.buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        client_ip = request.client.host if request.client else "unknown"
        now = int(time.time())
        window_start = now - (now % 60)
        retry_after = max(1, 60 - (now - window_start))

        try:
            redis = await get_redis()
            key = f"{self.prefix}:{client_ip}:{window_start}"
            current = int(await redis.incr(key))
            if current == 1:
                # Keep key slightly longer than window to avoid clock skew edge-cases.
                await redis.expire(key, 120)
            if current > self.rpm:
                return JSONResponse(
                    status_code=429,
                    content={
                        "ok": False,
                        "error": {"code": "RATE_LIMITED", "message": "Слишком много запросов. Попробуйте позже."},
                    },
                    headers={
                        "Retry-After": str(retry_after),
                        "X-RateLimit-Limit": str(self.rpm),
                        "X-RateLimit-Remaining": "0",
                    },
                )
            remaining = max(0, self.rpm - current)
            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = str(self.rpm)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            return response
        except Exception:
            # Fallback to in-memory limiter if Redis is temporarily unavailable.
            now_f = time.time()
            window = 60.0
            self.buckets[client_ip] = [t for t in self.buckets[client_ip] if now_f - t < window]
            if len(self.buckets[client_ip]) >= self.rpm:
                return JSONResponse(
                    status_code=429,
                    content={
                        "ok": False,
                        "error": {"code": "RATE_LIMITED", "message": "Слишком много запросов. Попробуйте позже."},
                    },
                    headers={"Retry-After": "60"},
                )
            self.buckets[client_ip].append(now_f)
            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = str(self.rpm)
            response.headers["X-RateLimit-Remaining"] = str(max(0, self.rpm - len(self.buckets[client_ip])))
            return response
