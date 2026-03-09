from __future__ import annotations

import time

from prometheus_client import Gauge, Info
from prometheus_fastapi_instrumentator import Instrumentator

APP_INFO = Info("app_info", "Application info")
APP_UPTIME_SECONDS = Gauge("app_uptime_seconds", "Uptime in seconds")
_START_TS = time.time()


def setup_metrics(app, *, version: str) -> None:
    # Expose app-level metadata and uptime.
    APP_INFO.info({"version": version})

    def _update_uptime() -> None:
        APP_UPTIME_SECONDS.set(time.time() - _START_TS)

    # Instrument FastAPI with HTTP metrics:
    # - http_requests_total
    # - http_request_duration_seconds
    # - etc.
    instrumentator = Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        # Always expose /metrics in our stack (Prometheus expects it).
        # If we ever need a toggle, we can add it explicitly in settings.
        should_respect_env_var=False,
        excluded_handlers=["/metrics", "/api/health", "/api/readiness"],
    )
    instrumentator.instrument(app)

    # Expose /metrics (Prometheus format).
    instrumentator.expose(
        app,
        endpoint="/metrics",
        include_in_schema=False,
    )

    # Keep uptime fresh on each scrape.
    # Prometheus pulls metrics, so updating on request is enough.
    @app.middleware("http")
    async def _metrics_uptime_middleware(request, call_next):
        if request.url.path == "/metrics":
            _update_uptime()
        return await call_next(request)
