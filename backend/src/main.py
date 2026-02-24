import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from src.common.exceptions import AppError
from src.config import settings
from src.infrastructure.logging import setup_logging
from src.infrastructure.metrics import setup_metrics
from src.infrastructure.redis_client import RedisClient, ping_with_timeout
from src.middleware.correlation import CorrelationIdMiddleware
from src.middleware.error_handler import app_error_handler, generic_error_handler
from src.middleware.request_size_limit import RequestSizeLimitMiddleware

setup_logging(debug=settings.DEBUG)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Long-lived clients go here so health checks don't create a new TCP connection per request.
        app.state.redis = RedisClient(settings.REDIS_URL)
        try:
            yield
        finally:
            await app.state.redis.close()

    is_prod = str(settings.ENVIRONMENT).lower() == "production"
    docs_enabled = (not is_prod) or bool(settings.EXPOSE_API_DOCS_IN_PROD)

    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/api/docs" if docs_enabled else None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
        lifespan=lifespan,
    )

    if settings.ENABLE_METRICS:
        setup_metrics(application, version=settings.APP_VERSION)

    # Correlation ID (should be first so all following logs/errors include it).
    application.add_middleware(CorrelationIdMiddleware)

    # Request size limit (basic DoS protection).
    max_bytes = int(max(0, int(settings.MAX_REQUEST_BODY_MB or 0))) * 1024 * 1024
    if max_bytes > 0:
        application.add_middleware(RequestSizeLimitMiddleware, max_bytes=max_bytes)

    # Trusted hosts in production.
    if str(settings.ENVIRONMENT).lower() == "production":
        hosts = settings.TRUSTED_HOSTS or []
        if not hosts and settings.DOMAIN:
            hosts = [settings.DOMAIN]
        if hosts:
            application.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    # CORS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Security headers
    from src.middleware.security_headers import SecurityHeadersMiddleware

    application.add_middleware(SecurityHeadersMiddleware)

    # Rate limiter
    if settings.ENABLE_RATE_LIMIT:
        from src.middleware.rate_limit import RateLimitMiddleware

        rpm = int(settings.RATE_LIMIT_REQUESTS_PER_MINUTE or 120)
        # Dev UX: avoid false-positive 429 under local proxy/HMR noise.
        if str(settings.ENVIRONMENT).lower() != "production":
            rpm = max(rpm, 600)
        application.add_middleware(RateLimitMiddleware, requests_per_minute=rpm)

    # Error handlers
    application.add_exception_handler(AppError, app_error_handler)
    application.add_exception_handler(Exception, generic_error_handler)

    from src.router import router as api_router

    application.include_router(api_router)

    @application.get("/api/health")
    async def health():
        result = {"status": "ok", "version": settings.APP_VERSION, "services": {}}

        # DB check (timeout-protected)
        try:
            from src.infrastructure.database import async_session_factory

            async with async_session_factory() as session:
                await asyncio.wait_for(
                    session.execute(__import__("sqlalchemy").text("SELECT 1")),
                    timeout=float(settings.DB_HEALTH_TIMEOUT_S),
                )
            result["services"]["db"] = "ok"
        except Exception:
            result["services"]["db"] = "error"
            result["status"] = "degraded"

        # Redis check (timeout-protected, shared client)
        try:
            r = await application.state.redis.get()
            await ping_with_timeout(r, timeout_s=float(settings.REDIS_HEALTH_TIMEOUT_S))
            result["services"]["redis"] = "ok"
        except Exception:
            result["services"]["redis"] = "error"

        return result

    @application.get("/api/readiness")
    async def readiness():
        """Readiness probe: returns 200 only when DB is reachable."""
        from fastapi.responses import JSONResponse

        try:
            from src.infrastructure.database import async_session_factory

            async with async_session_factory() as session:
                await asyncio.wait_for(
                    session.execute(__import__("sqlalchemy").text("SELECT 1")),
                    timeout=float(settings.DB_HEALTH_TIMEOUT_S),
                )
            return JSONResponse({"ready": True})
        except Exception:
            return JSONResponse({"ready": False}, status_code=503)

    return application


app = create_app()
