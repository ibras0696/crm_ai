"""Reports and dashboard builder endpoints."""

import uuid

from fastapi import APIRouter, Depends

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.reports.schemas import (
    AnalyticsPreviewOut,
    AnalyticsQueryRequest,
    AnalyticsTableSchemaOut,
    ColumnAggRequest,
    DashboardCreateRequest,
    DashboardDataOut,
    DashboardDetailOut,
    DashboardOut,
    DashboardPreviewRequest,
    DashboardUpdateRequest,
    OrgReport,
    TableAggResponse,
    TimeSeriesPoint,
    WidgetCreateRequest,
    WidgetOut,
    WidgetUpdateRequest,
)
from src.modules.reports.service import ReportsService

router = APIRouter(prefix="/reports", tags=["reports"])

TABLE_NOT_FOUND_MESSAGE = "Таблица не найдена"
DASHBOARD_NOT_FOUND_MESSAGE = "Дашборд не найден"
WIDGET_NOT_FOUND_MESSAGE = "Виджет не найден"


@router.get("/summary", response_model=ApiResponse[OrgReport])
async def org_summary(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        report = await service.org_summary(org_id=current_user.org_id)
    return ApiResponse(data=report)


@router.post("/table-analytics", response_model=ApiResponse[TableAggResponse])
async def table_analytics(
    body: ColumnAggRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        response = await service.table_analytics(org_id=current_user.org_id, body=body)
        if response is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": TABLE_NOT_FOUND_MESSAGE})
    return ApiResponse(data=response)


@router.get("/tables/{table_id}/schema", response_model=ApiResponse[AnalyticsTableSchemaOut])
async def table_schema(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        response = await service.table_schema(org_id=current_user.org_id, table_id=table_id)
        if response is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": TABLE_NOT_FOUND_MESSAGE})
    return ApiResponse(data=response)


@router.post("/query-preview", response_model=ApiResponse[AnalyticsPreviewOut])
async def query_preview(
    body: AnalyticsQueryRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        response = await service.query_preview(org_id=current_user.org_id, body=body)
        if response is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": TABLE_NOT_FOUND_MESSAGE})
    return ApiResponse(data=response)


@router.get("/timeline", response_model=ApiResponse[list[TimeSeriesPoint]])
async def records_timeline(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    days: int = 30,
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        points = await service.records_timeline(org_id=current_user.org_id, days=days)
    return ApiResponse(data=points)


@router.get("/dashboards", response_model=ApiResponse[list[DashboardOut]])
async def list_dashboards(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        items = await service.list_dashboards(org_id=current_user.org_id)
    return ApiResponse(data=items)


@router.post("/dashboards", response_model=ApiResponse[DashboardOut])
async def create_dashboard(
    body: DashboardCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="reports", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        dashboard = await service.create_dashboard(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            body=body,
        )
        await uow.commit()
    return ApiResponse(data=dashboard)


@router.patch("/dashboards/{dashboard_id}", response_model=ApiResponse[DashboardOut])
async def update_dashboard(
    dashboard_id: uuid.UUID,
    body: DashboardUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(
        require_access(
            resource_type="reports",
            permission="can_write",
            resource_id_param="dashboard_id",
        ),
    ),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        dashboard = await service.update_dashboard(org_id=current_user.org_id, dashboard_id=dashboard_id, body=body)
        if dashboard is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
        await uow.commit()
    return ApiResponse(data=dashboard)


@router.delete("/dashboards/{dashboard_id}", response_model=ApiResponse[None])
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(
        require_access(
            resource_type="reports",
            permission="can_delete",
            resource_id_param="dashboard_id",
        ),
    ),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        deleted = await service.delete_dashboard(org_id=current_user.org_id, dashboard_id=dashboard_id)
        if not deleted:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/dashboards/{dashboard_id}", response_model=ApiResponse[DashboardDetailOut])
async def get_dashboard(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        dashboard = await service.get_dashboard(org_id=current_user.org_id, dashboard_id=dashboard_id)
        if dashboard is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
    return ApiResponse(data=dashboard)


@router.post("/dashboards/{dashboard_id}/widgets", response_model=ApiResponse[WidgetOut])
async def create_widget(
    dashboard_id: uuid.UUID,
    body: WidgetCreateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(
        require_access(
            resource_type="reports",
            permission="can_write",
            resource_id_param="dashboard_id",
        ),
    ),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        widget = await service.create_widget(org_id=current_user.org_id, dashboard_id=dashboard_id, body=body)
        if widget is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
        await uow.commit()
    return ApiResponse(data=widget)


@router.patch("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[WidgetOut])
async def update_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    body: WidgetUpdateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(
        require_access(
            resource_type="reports",
            permission="can_write",
            resource_id_param="dashboard_id",
        ),
    ),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        widget = await service.update_widget(
            org_id=current_user.org_id,
            dashboard_id=dashboard_id,
            widget_id=widget_id,
            body=body,
        )
        if widget is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": WIDGET_NOT_FOUND_MESSAGE},
            )
        await uow.commit()
    return ApiResponse(data=widget)


@router.delete("/dashboards/{dashboard_id}/widgets/{widget_id}", response_model=ApiResponse[None])
async def delete_widget(
    dashboard_id: uuid.UUID,
    widget_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(
        require_access(
            resource_type="reports",
            permission="can_delete",
            resource_id_param="dashboard_id",
        ),
    ),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        deleted = await service.delete_widget(
            org_id=current_user.org_id,
            dashboard_id=dashboard_id,
            widget_id=widget_id,
        )
        if not deleted:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": WIDGET_NOT_FOUND_MESSAGE},
            )
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/dashboards/{dashboard_id}/data", response_model=ApiResponse[DashboardDataOut])
async def dashboard_data(
    dashboard_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        data = await service.dashboard_data(org_id=current_user.org_id, dashboard_id=dashboard_id)
        if data is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
    return ApiResponse(data=data)


@router.post("/dashboards/{dashboard_id}/preview", response_model=ApiResponse[DashboardDataOut])
async def dashboard_preview(
    dashboard_id: uuid.UUID,
    body: DashboardPreviewRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="reports", permission="can_read", resource_id_param="dashboard_id")),
):
    async with UnitOfWork() as uow:
        service = ReportsService(uow.session)
        data = await service.dashboard_preview(org_id=current_user.org_id, dashboard_id=dashboard_id, body=body)
        if data is None:
            return ApiResponse(
                ok=False,
                data=None,
                error={"code": "NOT_FOUND", "message": DASHBOARD_NOT_FOUND_MESSAGE},
            )
    return ApiResponse(data=data)
