import json
import logging
import subprocess

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.common.exceptions import AppError
from src.config import settings
from src.infrastructure.logging import setup_logging
from src.infrastructure.metrics import setup_metrics
from src.middleware.correlation import CorrelationIdMiddleware
from src.middleware.error_handler import app_error_handler, generic_error_handler

setup_logging(debug=settings.DEBUG)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    setup_metrics(application, version=settings.APP_VERSION)

    # CORS
    origins = json.loads(settings.CORS_ORIGINS)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Security headers
    from src.middleware.security_headers import SecurityHeadersMiddleware
    application.add_middleware(SecurityHeadersMiddleware)

    # Rate limiter
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
        # DB check
        try:
            from src.infrastructure.database import async_session_factory
            async with async_session_factory() as session:
                await session.execute(__import__("sqlalchemy").text("SELECT 1"))
            result["services"]["db"] = "ok"
        except Exception:
            result["services"]["db"] = "error"
            result["status"] = "degraded"
        # Redis check
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.REDIS_URL)
            await r.ping()
            await r.aclose()
            result["services"]["redis"] = "ok"
        except Exception:
            result["services"]["redis"] = "error"
        return result

    @application.get("/api/readiness")
    async def readiness():
        """Readiness probe — returns 200 only when DB is reachable."""
        from fastapi.responses import JSONResponse
        try:
            from src.infrastructure.database import async_session_factory
            async with async_session_factory() as session:
                await session.execute(__import__("sqlalchemy").text("SELECT 1"))
            return JSONResponse({"ready": True})
        except Exception:
            return JSONResponse({"ready": False}, status_code=503)

    @application.on_event("startup")
    async def _run_migrations_and_seed():
        """Run alembic migrations + seed plans on every startup."""
        import asyncpg
        try:
            url = settings.DATABASE_URL.replace("+asyncpg", "")
            conn = await asyncpg.connect(url)
            users_exists = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='users')"
            )
            alembic_exists = await conn.fetchval(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='alembic_version')"
            )
            if alembic_exists and not users_exists:
                logger.warning("[startup] Stale alembic_version — resetting")
                await conn.execute("DELETE FROM alembic_version")
            await conn.close()
        except Exception as e:
            logger.error(f"[startup] DB check failed: {e}")

        try:
            result = subprocess.run(
                ["alembic", "upgrade", "head"],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode == 0:
                logger.info("[startup] Migrations OK")
            else:
                logger.error(f"[startup] Migration failed: {result.stderr}")
        except Exception as e:
            logger.error(f"[startup] Migration error: {e}")

        # Reset connection pool so asyncpg drops stale prepared statements
        try:
            from src.infrastructure.database import engine
            await engine.dispose()
            logger.info("[startup] Connection pool reset")
        except Exception as e:
            logger.error(f"[startup] Pool reset error: {e}")

        try:
            from src.infrastructure.database import async_session_factory
            from src.modules.billing.models import Plan
            from sqlalchemy import select
            async with async_session_factory() as session:
                existing = (await session.execute(select(Plan))).scalars().first()
                if not existing:
                    session.add(Plan(
                        name='free', display_name='Бесплатный',
                        price_monthly=0, price_yearly=0,
                        max_members=10, max_tables=10, max_records=10000, max_storage_mb=500,
                        has_ai=False, features={}, is_active=True,
                    ))
                    session.add(Plan(
                        name='team', display_name='Команда',
                        price_monthly=149000, price_yearly=1190000,
                        max_members=999999, max_tables=999999,
                        max_records=999999999, max_storage_mb=999999,
                        has_ai=True, features={'ai': True}, is_active=True,
                    ))
                    await session.commit()
                    logger.info("[startup] Plans seeded")
                else:
                    logger.info("[startup] Plans exist, skip seed")
        except Exception as e:
            logger.error(f"[startup] Seed error: {e}")

    return application


import time as _time_mod
_start_time = _time_mod.time()

app = create_app()
