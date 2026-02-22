import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.common.exceptions import AppError
from src.config import settings
from src.infrastructure.logging import setup_logging
from src.infrastructure.metrics import setup_metrics
from src.infrastructure.redis_client import RedisClient, ping_with_timeout
from src.middleware.correlation import CorrelationIdMiddleware
from src.middleware.error_handler import app_error_handler, generic_error_handler

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

    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    if settings.ENABLE_METRICS:
        setup_metrics(application, version=settings.APP_VERSION)

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

        application.add_middleware(RateLimitMiddleware, requests_per_minute=120)

    # Correlation ID
    application.add_middleware(CorrelationIdMiddleware)

    # Error handlers
    application.add_exception_handler(AppError, app_error_handler)
    application.add_exception_handler(Exception, generic_error_handler)

    # Routers
    from src.modules.auth.routes import router as auth_router
    from src.modules.org.routes import router as org_router
    from src.modules.audit.routes import router as audit_router
    from src.modules.files.routes import router as files_router
    from src.modules.notifications.routes import router as notif_router
    from src.modules.tables.routes import router as tables_router
    from src.modules.tables.record_routes import router as records_router
    from src.modules.tables.views import router as views_router, filter_router
    from src.modules.knowledge.routes import router as kb_router
    from src.modules.reports.routes import router as reports_router
    from src.modules.billing.routes import router as billing_router
    from src.modules.ai.routes import router as ai_router
    from src.modules.schedule.routes import router as schedule_router
    from src.modules.access.routes import router as access_router
    from src.modules.superadmin.routes import router as superadmin_router

    application.include_router(auth_router, prefix="/api/v1")
    application.include_router(org_router, prefix="/api/v1")
    application.include_router(audit_router, prefix="/api/v1")
    application.include_router(files_router, prefix="/api/v1")
    application.include_router(notif_router, prefix="/api/v1")
    application.include_router(tables_router, prefix="/api/v1")
    application.include_router(records_router, prefix="/api/v1")
    application.include_router(views_router, prefix="/api/v1")
    application.include_router(filter_router, prefix="/api/v1")
    application.include_router(kb_router, prefix="/api/v1")
    application.include_router(reports_router, prefix="/api/v1")
    application.include_router(billing_router, prefix="/api/v1")
    application.include_router(ai_router, prefix="/api/v1")
    application.include_router(schedule_router, prefix="/api/v1")
    application.include_router(access_router, prefix="/api/v1")
    application.include_router(superadmin_router, prefix="/api/v1")

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
