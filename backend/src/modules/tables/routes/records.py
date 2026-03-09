"""HTTP routes for records CRUD and ordering."""

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.schemas import (
    CreateRecordRequest,
    MoveRecordRequest,
    RecordListOut,
    RecordOut,
    UpdateRecordRequest,
)
from src.modules.tables.service import TableRecordsService, TableServiceError


router = APIRouter(prefix="/tables/{table_id}/records", tags=["records"])


def _error_response(error: TableServiceError) -> ApiResponse[None]:
    return ApiResponse(
        ok=False,
        data=None,
        error={"code": error.code, "message": error.message},
    )


def _error_json_response(error: TableServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"ok": False, "data": None, "error": {"code": error.code, "message": error.message}},
    )


@router.post("/", response_model=ApiResponse[RecordOut])
async def create_record(
    table_id: uuid.UUID,
    body: CreateRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            record = await service.create_record(
                table_id=table_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        await uow.session.refresh(record)
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[RecordListOut])
async def list_records(
    table_id: uuid.UUID,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            records, total = await service.list_records(
                table_id=table_id,
                org_id=current_user.org_id,
                limit=limit,
                offset=offset,
            )
        except TableServiceError as error:
            return _error_response(error)
        items = [RecordOut.model_validate(record) for record in records]
    return ApiResponse(data=RecordListOut(records=items, total=total))


@router.get("/{record_id}", response_model=ApiResponse[RecordOut])
async def get_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            record = await service.get_record(
                table_id=table_id,
                record_id=record_id,
                org_id=current_user.org_id,
            )
        except TableServiceError as error:
            return _error_response(error)
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.patch("/{record_id}", response_model=ApiResponse[RecordOut])
async def update_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    body: UpdateRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            record = await service.update_record(
                table_id=table_id,
                record_id=record_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            if error.status_code == 409:
                return _error_json_response(error)
            return _error_response(error)
        await uow.commit()
        await uow.session.refresh(record)
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.delete("/{record_id}", response_model=ApiResponse[None])
async def delete_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_delete", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            await service.delete_record(
                table_id=table_id,
                record_id=record_id,
                org_id=current_user.org_id,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/{record_id}/move", response_model=ApiResponse[RecordOut])
async def move_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    body: MoveRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    async with UnitOfWork() as uow:
        service = TableRecordsService(uow.session)
        try:
            record = await service.move_record(
                table_id=table_id,
                record_id=record_id,
                org_id=current_user.org_id,
                body=body,
            )
        except TableServiceError as error:
            return _error_response(error)
        await uow.commit()
        await uow.session.refresh(record)
    return ApiResponse(data=RecordOut.model_validate(record))
