"""HTTP routes for saved table views."""

from __future__ import annotations

import uuid  # noqa: TC003

from fastapi import APIRouter, Depends

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.schemas import CreateViewRequest, ViewOut
from src.modules.tables.service import TableServiceError, TableViewsService

router = APIRouter(prefix="/tables/{table_id}/views", tags=["views"])


def _error_response(error: TableServiceError) -> ApiResponse[None]:
    return ApiResponse(
        ok=False,
        data=None,
        error={"code": error.code, "message": error.message},
    )


@router.post("/", response_model=ApiResponse[ViewOut])
async def create_view(
    table_id: uuid.UUID,
    body: CreateViewRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableViewsService(uow.session)
        try:
            view = await service.create_view(
                table_id=table_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = ViewOut.model_validate(view)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[ViewOut]])
async def list_views(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableViewsService(uow.session)
        try:
            views = await service.list_views(table_id=table_id, org_id=current_user.org_id)
        except TableServiceError as error:
            return _error_response(error)
        items = [ViewOut.model_validate(view) for view in views]
    return ApiResponse(data=items)


@router.delete("/{view_id}", response_model=ApiResponse[None])
async def delete_view(
    table_id: uuid.UUID,
    view_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableViewsService(uow.session)
        try:
            await service.delete_view(table_id=table_id, view_id=view_id, org_id=current_user.org_id)
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)
