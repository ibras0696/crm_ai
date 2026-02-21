"""Superadmin endpoints."""

from fastapi import APIRouter, Depends

from src.common.schemas import ApiResponse
from src.modules.superadmin.dependencies import require_superadmin
from src.modules.superadmin.schemas import SetPlanRequest, SuperadminLoginRequest, SuperadminTokenResponse
from src.modules.superadmin.service import (
    ai_config,
    ai_usage_by_org,
    authenticate_superadmin,
    dashboard_data,
    list_orgs,
    list_tables,
    list_users,
    set_plan,
)

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


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
                "message": "Суперадмин не настроен. Добавьте SUPERADMIN_EMAIL и SUPERADMIN_PASSWORD в .env",
            },
        )
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "UNAUTHORIZED", "message": "Invalid credentials"})
    return ApiResponse(data=SuperadminTokenResponse(access_token=token))


@router.get("/dashboard", response_model=ApiResponse[dict])
async def superadmin_dashboard(_: dict = Depends(require_superadmin)):
    return ApiResponse(data=await dashboard_data())


@router.get("/orgs", response_model=ApiResponse[list])
async def superadmin_orgs(
    limit: int = 50,
    offset: int = 0,
    _: dict = Depends(require_superadmin),
):
    return ApiResponse(data=await list_orgs(limit=limit, offset=offset))


@router.get("/users", response_model=ApiResponse[list])
async def superadmin_users(
    limit: int = 50,
    offset: int = 0,
    _: dict = Depends(require_superadmin),
):
    return ApiResponse(data=await list_users(limit=limit, offset=offset))


@router.get("/tables", response_model=ApiResponse[list])
async def superadmin_tables(
    limit: int = 50,
    offset: int = 0,
    _: dict = Depends(require_superadmin),
):
    return ApiResponse(data=await list_tables(limit=limit, offset=offset))


@router.get("/ai-usage", response_model=ApiResponse[list])
async def superadmin_ai_usage(_: dict = Depends(require_superadmin)):
    return ApiResponse(data=await ai_usage_by_org())


@router.patch("/orgs/{org_id}/plan", response_model=ApiResponse[dict])
async def superadmin_set_plan(
    org_id: str,
    body: SetPlanRequest,
    _: dict = Depends(require_superadmin),
):
    try:
        data = await set_plan(org_id=org_id, plan_name=body.plan)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_PLAN", "message": f"Неверный тариф: {body.plan}"})
    except LookupError:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Организация не найдена"})
    return ApiResponse(data=data)


@router.get("/ai-config", response_model=ApiResponse[dict])
async def superadmin_ai_config(_: dict = Depends(require_superadmin)):
    return ApiResponse(data=ai_config())
