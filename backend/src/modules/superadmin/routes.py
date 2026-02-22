"""Superadmin endpoints."""

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from src.common.schemas import ApiResponse
from src.common.http_headers import content_disposition_attachment
from src.modules.superadmin.dependencies import require_superadmin
from src.modules.superadmin.schemas import (
    SetPlanRequest,
    SuperadminAuditPage,
    SuperadminOrgDetail,
    SuperadminOrgListPage,
    SuperadminOrgMembersPage,
    SuperadminDashboardResponse,
    SuperadminLoginRequest,
    SuperadminOverviewResponse,
    SuperadminRecordListPage,
    SuperadminTableDetail,
    SuperadminTableListPage,
    SuperadminTokenResponse,
    SuperadminUserListPage,
)
from src.modules.superadmin.service import (
    ai_config,
    ai_usage_by_org,
    audit_logs_page,
    authenticate_superadmin,
    dashboard_data,
    export_table_csv,
    export_table_xlsx,
    list_tables,
    list_orgs_page,
    list_users_page,
    org_detail,
    org_members_page,
    org_table_detail,
    org_table_records_page,
    org_tables_page,
    overview_data,
    set_plan,
)

router = APIRouter(prefix="/superadmin", tags=["superadmin"])

# Protect all non-login endpoints with a single dependency.
protected = APIRouter(dependencies=[Depends(require_superadmin)])


@router.post("/login", response_model=ApiResponse[SuperadminTokenResponse])
async def superadmin_login(body: SuperadminLoginRequest):
    try:
        token = authenticate_superadmin(body.email, body.password)
    except RuntimeError:
        return ApiResponse(
            ok=False,
            data=None,
            error={
                "code": "SUPERADMIN_NOT_CONFIGURED",
                "message": (
                    "Суперадмин не настроен. Задайте SUPERADMIN_EMAIL и SUPERADMIN_PASSWORD "
                    "(через secrets.yml или переменные окружения) и перезапустите backend."
                ),
            },
        )
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "UNAUTHORIZED", "message": "Invalid credentials"})
    return ApiResponse(data=SuperadminTokenResponse(access_token=token))


@protected.get("/dashboard", response_model=ApiResponse[SuperadminDashboardResponse])
async def superadmin_dashboard():
    return ApiResponse(data=await dashboard_data())


@protected.get("/overview", response_model=ApiResponse[SuperadminOverviewResponse])
async def superadmin_overview(org_limit: int = 200):
    return ApiResponse(data=await overview_data(org_limit=org_limit))


@protected.get("/orgs", response_model=ApiResponse[SuperadminOrgListPage])
async def superadmin_orgs(
    q: str | None = None,
    plan: str | None = None,
    sub_status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    return ApiResponse(data=await list_orgs_page(q=q, plan=plan, sub_status=sub_status, limit=limit, offset=offset))


@protected.get("/orgs/{org_id}", response_model=ApiResponse[SuperadminOrgDetail])
async def superadmin_org_detail(org_id: str):
    try:
        data = await org_detail(org_id)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Организация не найдена"})
    return ApiResponse(data=data)


@protected.get("/orgs/{org_id}/members", response_model=ApiResponse[SuperadminOrgMembersPage])
async def superadmin_org_members(org_id: str, limit: int = 50, offset: int = 0):
    return ApiResponse(data=await org_members_page(org_id, limit=limit, offset=offset))


@protected.get("/users", response_model=ApiResponse[SuperadminUserListPage])
async def superadmin_users(
    q: str | None = None,
    org_id: str | None = None,
    is_active: bool | None = None,
    limit: int = 50,
    offset: int = 0,
):
    return ApiResponse(data=await list_users_page(q=q, org_id=org_id, is_active=is_active, limit=limit, offset=offset))


@protected.get("/tables", response_model=ApiResponse[list])
async def superadmin_tables(limit: int = 50, offset: int = 0):
    return ApiResponse(data=await list_tables(limit=limit, offset=offset))


@protected.get("/ai-usage", response_model=ApiResponse[list])
async def superadmin_ai_usage():
    return ApiResponse(data=await ai_usage_by_org())


@protected.patch("/orgs/{org_id}/plan", response_model=ApiResponse[dict])
async def superadmin_set_plan(org_id: str, body: SetPlanRequest):
    try:
        data = await set_plan(org_id=org_id, plan_name=body.plan)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_PLAN", "message": f"Неверный тариф: {body.plan}"})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Организация не найдена"})
    return ApiResponse(data=data)


@protected.get("/ai-config", response_model=ApiResponse[dict])
async def superadmin_ai_config():
    return ApiResponse(data=ai_config())


@protected.get("/audit/logs", response_model=ApiResponse[SuperadminAuditPage])
async def superadmin_audit_logs(org_id: str | None = None, limit: int = 50, offset: int = 0):
    return ApiResponse(data=await audit_logs_page(org_id=org_id, limit=limit, offset=offset))


@protected.get("/orgs/{org_id}/tables", response_model=ApiResponse[SuperadminTableListPage])
async def superadmin_org_tables(
    org_id: str,
    q: str | None = None,
    include_archived: bool = True,
    limit: int = 50,
    offset: int = 0,
):
    return ApiResponse(data=await org_tables_page(org_id, q=q, include_archived=include_archived, limit=limit, offset=offset))


@protected.get("/orgs/{org_id}/tables/{table_id}", response_model=ApiResponse[SuperadminTableDetail])
async def superadmin_org_table_detail(org_id: str, table_id: str):
    try:
        return ApiResponse(data=await org_table_detail(org_id, table_id))
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})


@protected.get("/orgs/{org_id}/tables/{table_id}/records", response_model=ApiResponse[SuperadminRecordListPage])
async def superadmin_org_table_records(
    org_id: str,
    table_id: str,
    q: str | None = None,
    sort_col_id: str | None = None,
    sort_dir: str = "asc",
    limit: int = 100,
    offset: int = 0,
):
    try:
        return ApiResponse(
            data=await org_table_records_page(
                org_id,
                table_id,
                q=q,
                sort_col_id=sort_col_id,
                sort_dir=sort_dir,
                limit=limit,
                offset=offset,
            )
        )
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})


@protected.get("/orgs/{org_id}/tables/{table_id}/export/csv")
async def superadmin_export_csv(org_id: str, table_id: str):
    """Экспорт CSV из supеradmin (read-only, строгая привязка к org_id)."""
    try:
        payload, filename = await export_table_csv(org_id=org_id, table_id=table_id)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

    return StreamingResponse(
        iter([payload]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


@protected.get("/orgs/{org_id}/tables/{table_id}/export/xlsx")
async def superadmin_export_xlsx(org_id: str, table_id: str):
    """Экспорт XLSX из supеradmin (read-only, строгая привязка к org_id)."""
    try:
        payload, filename = await export_table_xlsx(org_id=org_id, table_id=table_id)
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": content_disposition_attachment(filename)},
    )


router.include_router(protected)
