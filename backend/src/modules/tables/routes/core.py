"""HTTP routes for folders, tables and columns."""

import uuid

from fastapi import APIRouter, Depends, Query

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.schemas import (
    ColumnOut,
    CreateColumnRequest,
    CreateFolderRequest,
    CreateTableRequest,
    FolderOut,
    FormulaPreviewOut,
    FormulaPreviewRequest,
    RelationOptionOut,
    TableOut,
    UpdateColumnRequest,
    UpdateFolderRequest,
    UpdateTableRequest,
)
from src.modules.tables.service import TableRecordsService, TableServiceError, TablesService

router = APIRouter(prefix="/tables", tags=["tables"])


def _error_response(error: TableServiceError) -> ApiResponse[None]:
    return ApiResponse(
        ok=False,
        data=None,
        error={"code": error.code, "message": error.message},
    )


@router.post("/folders/", response_model=ApiResponse[FolderOut])
async def create_folder(
    body: CreateFolderRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            folder = await service.create_folder(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = FolderOut.model_validate(folder)
    return ApiResponse(data=item)


@router.get("/folders/", response_model=ApiResponse[list[FolderOut]])
async def list_folders(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        folders = await service.list_folders(org_id=current_user.org_id)
        items = [FolderOut.model_validate(folder) for folder in folders]
    return ApiResponse(data=items)


@router.patch("/folders/{folder_id}", response_model=ApiResponse[FolderOut])
async def update_folder(
    folder_id: uuid.UUID,
    body: UpdateFolderRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            folder = await service.update_folder(folder_id=folder_id, org_id=current_user.org_id, body=body)
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = FolderOut.model_validate(folder)
    return ApiResponse(data=item)


@router.delete("/folders/{folder_id}", response_model=ApiResponse[None])
async def delete_folder(
    folder_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            await service.delete_folder(folder_id=folder_id, org_id=current_user.org_id)
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/", response_model=ApiResponse[TableOut])
async def create_table(
    body: CreateTableRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            table = await service.create_table(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        table = await service.get_table(table_id=table.id, org_id=current_user.org_id, with_columns=True)
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[TableOut]])
async def list_tables(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        tables = await service.list_tables(org_id=current_user.org_id)
        items = [TableOut.model_validate(table) for table in tables]
    return ApiResponse(data=items)


@router.get("/{table_id}", response_model=ApiResponse[TableOut])
async def get_table(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            table = await service.get_table(table_id=table_id, org_id=current_user.org_id, with_columns=True)
        except TableServiceError as error:
            return _error_response(error)
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.patch("/{table_id}", response_model=ApiResponse[TableOut])
async def update_table(
    table_id: uuid.UUID,
    body: UpdateTableRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            table = await service.update_table(
                table_id=table_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.delete("/{table_id}", response_model=ApiResponse[None])
async def delete_table(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            await service.delete_table(table_id=table_id, org_id=current_user.org_id)
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/{table_id}/columns", response_model=ApiResponse[ColumnOut])
async def create_column(
    table_id: uuid.UUID,
    body: CreateColumnRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            column = await service.create_column(
                table_id=table_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = ColumnOut.model_validate(column)
    return ApiResponse(data=item)


@router.patch("/{table_id}/columns/{column_id}", response_model=ApiResponse[ColumnOut])
async def update_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    body: UpdateColumnRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            column = await service.update_column(
                table_id=table_id,
                column_id=column_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        item = ColumnOut.model_validate(column)
    return ApiResponse(data=item)


@router.delete("/{table_id}/columns/{column_id}", response_model=ApiResponse[None])
async def delete_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            await service.delete_column(table_id=table_id, column_id=column_id, org_id=current_user.org_id)
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/{table_id}/formula/preview", response_model=ApiResponse[FormulaPreviewOut])
async def preview_formula(
    table_id: uuid.UUID,
    body: FormulaPreviewRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TablesService(uow.session)
        try:
            preview = await service.preview_formula(
                table_id=table_id,
                org_id=current_user.org_id,
                expression=body.expression,
                sample_row=body.sample_row,
            )
        except TableServiceError as error:
            return _error_response(error)
    return ApiResponse(data=FormulaPreviewOut.model_validate(preview))


@router.get("/{table_id}/columns/{column_id}/relation-options", response_model=ApiResponse[list[RelationOptionOut]])
async def relation_options(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    search: str | None = Query(default=None),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            options = await service.get_relation_options(
                table_id=table_id,
                column_id=column_id,
                org_id=current_user.org_id,
                limit=limit,
                search=search,
            )
        except TableServiceError as error:
            return _error_response(error)
    return ApiResponse(data=[RelationOptionOut.model_validate(item) for item in options])
