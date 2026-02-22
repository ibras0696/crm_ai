"""Saved views CRUD for tables (filters/sorts/config)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.models import TableView
from src.modules.tables.repository import TableRepository
from src.modules.tables.schemas import CreateViewRequest, ViewOut


router = APIRouter(prefix="/tables/{table_id}/views", tags=["views"])


@router.post("/", response_model=ApiResponse[ViewOut])
async def create_view(
    table_id: uuid.UUID,
    body: CreateViewRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        t_repo = TableRepository(uow.session)
        table = await t_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        view = TableView(
            table_id=table_id,
            org_id=current_user.org_id,
            name=body.name,
            view_type=body.view_type,
            filters=body.filters,
            sorts=body.sorts,
            config=body.config,
        )
        uow.session.add(view)
        await uow.session.flush()
        await uow.commit()
        item = ViewOut.model_validate(view)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[ViewOut]])
async def list_views(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        stmt = (
            select(TableView)
            .where(TableView.table_id == table_id, TableView.org_id == current_user.org_id)
            .order_by(TableView.created_at)
        )
        result = await uow.session.execute(stmt)
        views = list(result.scalars().all())
        items = [ViewOut.model_validate(v) for v in views]
    return ApiResponse(data=items)


@router.delete("/{view_id}", response_model=ApiResponse[None])
async def delete_view(
    table_id: uuid.UUID,
    view_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        view = await uow.session.get(TableView, view_id)
        if not view or view.org_id != current_user.org_id or view.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Вид не найден"})
        await uow.session.delete(view)
        await uow.commit()
    return ApiResponse(data=None)

