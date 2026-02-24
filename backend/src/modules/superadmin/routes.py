"""Superadmin endpoints."""

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse

from src.common.http_headers import content_disposition_attachment
from src.common.schemas import ApiResponse
from src.config import settings
from src.modules.superadmin.dependencies import require_superadmin
from src.modules.superadmin.schemas import (
    SetOrgAIEnabledRequest,
    SetPlanRequest,
    SuperadminAIUsageResetResponse,
    SuperadminAuditPage,
    SuperadminDashboardResponse,
    SuperadminLoginRequest,
    SuperadminOrgDetail,
    SuperadminOrgAIEnabledResponse,
    SuperadminOrgListPage,
    SuperadminOrgMembersPage,
    SuperadminOverviewResponse,
    SuperadminPlanChangeResponse,
    SuperadminRecordListPage,
    SuperadminTableDetail,
    SuperadminTableListPage,
    SuperadminTokenResponse,
    SuperadminUserListPage,
)
from src.modules.superadmin.service import SuperadminService
from src.modules.superadmin.services.auth import SuperadminRateLimitedError

router = APIRouter(prefix="/superadmin", tags=["superadmin"])
protected = APIRouter(dependencies=[Depends(require_superadmin)])

NOT_FOUND_ORG = "Организация не найдена"
NOT_FOUND_TABLE = "Таблица не найдена"
INVALID_ID = "Некорректный идентификатор"
NOT_FOUND_WIDGET = "Виджет не найден"
NOT_FOUND_DASHBOARD = "Дашборд не найден"

_service = SuperadminService()


def _set_superadmin_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.SUPERADMIN_ACCESS_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=bool(settings.AUTH_COOKIE_SECURE),
        samesite=settings.AUTH_COOKIE_SAMESITE,  # type: ignore[arg-type]
        path=settings.AUTH_COOKIE_PATH or "/",
        domain=(settings.AUTH_COOKIE_DOMAIN or None),
        max_age=12 * 3600,
    )


def _clear_superadmin_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.SUPERADMIN_ACCESS_COOKIE_NAME,
        path=settings.AUTH_COOKIE_PATH or "/",
        domain=(settings.AUTH_COOKIE_DOMAIN or None),
    )


@router.post("/login", response_model=ApiResponse[SuperadminTokenResponse])
async def superadmin_login(body: SuperadminLoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else None
    try:
        token = await _service.auth.authenticate_superadmin(body.email, body.password, ip_address=ip)
    except RuntimeError:
        return ApiResponse(
            ok=False,
            data=None,
            error={
                "code": "SUPERADMIN_NOT_CONFIGURED",
                "message": (
                    "Суперадмин не настроен. Задайте SUPERADMIN_EMAIL и SUPERADMIN_PASSWORD_HASH "
                    "(через secrets.yml или переменные окружения) и перезапустите backend."
                ),
            },
        )
    except SuperadminRateLimitedError as exc:
        return ApiResponse(
            ok=False,
            data=None,
            error={
                "code": "RATE_LIMIT",
                "message": f"Too many failed login attempts. Retry after {exc.retry_after_s}s.",
            },
        )
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "UNAUTHORIZED", "message": "Invalid credentials"})
    _set_superadmin_cookie(response, token)
    return ApiResponse(data=SuperadminTokenResponse(access_token=token))


@protected.post("/logout", response_model=ApiResponse[None])
async def superadmin_logout(response: Response):
    _clear_superadmin_cookie(response)
    return ApiResponse(data=None)


@protected.get("/dashboard", response_model=ApiResponse[SuperadminDashboardResponse])
async def superadmin_dashboard():
    return ApiResponse(data=await _service.overview.dashboard_data())


@protected.get("/overview", response_model=ApiResponse[SuperadminOverviewResponse])
async def superadmin_overview(org_limit: int = 200):
    return ApiResponse(data=await _service.overview.overview_data(org_limit=org_limit))


@protected.get("/orgs", response_model=ApiResponse[SuperadminOrgListPage])
async def superadmin_orgs(
    q: str | None = None,
    plan: str | None = None,
    sub_status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    return ApiResponse(
        data=await _service.orgs.list_orgs_page(
            q=q,
            plan=plan,
            sub_status=sub_status,
            limit=limit,
            offset=offset,
        ),
    )


@protected.get("/orgs/{org_id}", response_model=ApiResponse[SuperadminOrgDetail])
async def superadmin_org_detail(org_id: str):
    try:
        data = await _service.orgs.org_detail(org_id)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_ORG})
    return ApiResponse(data=data)


@protected.get("/orgs/{org_id}/members", response_model=ApiResponse[SuperadminOrgMembersPage])
async def superadmin_org_members(org_id: str, limit: int = 50, offset: int = 0):
    return ApiResponse(data=await _service.orgs.org_members_page(org_id, limit=limit, offset=offset))


@protected.get("/users", response_model=ApiResponse[SuperadminUserListPage])
async def superadmin_users(
    q: str | None = None,
    org_id: str | None = None,
    is_active: bool | None = None,
    limit: int = 50,
    offset: int = 0,
):
    return ApiResponse(
        data=await _service.orgs.list_users_page(
            q=q,
            org_id=org_id,
            is_active=is_active,
            limit=limit,
            offset=offset,
        ),
    )


@protected.get("/tables", response_model=ApiResponse[list])
async def superadmin_tables(limit: int = 50, offset: int = 0):
    return ApiResponse(data=await _service.overview.list_tables(limit=limit, offset=offset))


@protected.get("/ai-usage", response_model=ApiResponse[list])
async def superadmin_ai_usage():
    return ApiResponse(data=await _service.overview.ai_usage_by_org())


@protected.patch("/orgs/{org_id}/plan", response_model=ApiResponse[SuperadminPlanChangeResponse])
async def superadmin_set_plan(org_id: str, body: SetPlanRequest):
    try:
        data = await _service.orgs.set_plan(org_id=org_id, plan_name=body.plan)
    except ValueError:
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "INVALID_PLAN", "message": f"Неверный тариф: {body.plan}"},
        )
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_ORG})
    return ApiResponse(data=data)


@protected.patch("/orgs/{org_id}/ai-enabled", response_model=ApiResponse[SuperadminOrgAIEnabledResponse])
async def superadmin_set_org_ai_enabled(org_id: str, body: SetOrgAIEnabledRequest):
    try:
        data = await _service.orgs.set_org_ai_enabled(org_id=org_id, enabled=body.enabled)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_ORG})
    return ApiResponse(data=data)


@protected.post("/orgs/{org_id}/ai/reset-usage", response_model=ApiResponse[SuperadminAIUsageResetResponse])
async def superadmin_reset_org_ai_usage(org_id: str):
    try:
        data = await _service.orgs.reset_org_ai_usage_today(org_id=org_id)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_ORG})
    return ApiResponse(data=data)


@protected.get("/ai-config", response_model=ApiResponse[dict])
async def superadmin_ai_config():
    return ApiResponse(data=_service.auth.ai_config())


@protected.get("/audit/logs", response_model=ApiResponse[SuperadminAuditPage])
async def superadmin_audit_logs(org_id: str | None = None, limit: int = 50, offset: int = 0):
    return ApiResponse(data=await _service.orgs.audit_logs_page(org_id=org_id, limit=limit, offset=offset))


@protected.get("/orgs/{org_id}/tables", response_model=ApiResponse[SuperadminTableListPage])
async def superadmin_org_tables(
    org_id: str,
    q: str | None = None,
    include_archived: bool = True,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    try:
        return ApiResponse(
            data=await _service.tables.org_tables_page(
                org_id,
                q=q,
                include_archived=include_archived,
                limit=limit,
                offset=offset,
            ),
        )
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": INVALID_ID})


@protected.get("/orgs/{org_id}/tables/{table_id}", response_model=ApiResponse[SuperadminTableDetail])
async def superadmin_org_table_detail(org_id: str, table_id: str):
    try:
        return ApiResponse(data=await _service.tables.org_table_detail(org_id, table_id))
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": INVALID_ID})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_TABLE})


@protected.get("/orgs/{org_id}/tables/{table_id}/records", response_model=ApiResponse[SuperadminRecordListPage])
async def superadmin_org_table_records(
    org_id: str,
    table_id: str,
    q: str | None = None,
    sort_col_id: str | None = None,
    sort_dir: str = "asc",
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    try:
        data = await _service.tables.org_table_records_page(
            org_id,
            table_id,
            q=q,
            sort_col_id=sort_col_id,
            sort_dir=sort_dir,
            limit=limit,
            offset=offset,
        )
        return ApiResponse(data=data)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": INVALID_ID})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_TABLE})


@protected.get("/orgs/{org_id}/tables/{table_id}/export/csv")
async def superadmin_export_csv(org_id: str, table_id: str):
    try:
        payload, filename = await _service.tables.export_table_csv(org_id=org_id, table_id=table_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": INVALID_ID})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_TABLE})

    return StreamingResponse(
        iter([payload]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


@protected.get("/orgs/{org_id}/tables/{table_id}/export/xlsx")
async def superadmin_export_xlsx(org_id: str, table_id: str):
    try:
        payload, filename = await _service.tables.export_table_xlsx(org_id=org_id, table_id=table_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": INVALID_ID})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": NOT_FOUND_TABLE})

    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


router.include_router(protected)
