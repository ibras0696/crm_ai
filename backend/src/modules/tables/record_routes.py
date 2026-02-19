"""Record CRUD endpoints."""
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.models import Table
from src.modules.tables.repository import TableRepository
from src.modules.tables.records import Record, RecordRepository
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/tables/{table_id}/records", tags=["records"])


class RecordOut(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    data: dict
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    position: int

    model_config = {"from_attributes": True}


class RecordListOut(BaseModel):
    records: list[RecordOut]
    total: int


class CreateRecordRequest(BaseModel):
    data: dict


class UpdateRecordRequest(BaseModel):
    data: dict


class MoveRecordRequest(BaseModel):
    direction: Literal["up", "down"]


async def _get_table_or_fail(table_id: uuid.UUID, org_id: uuid.UUID, uow) -> Table | None:
    repo = TableRepository(uow.session)
    table = await repo.get_by_id(table_id, with_columns=False)
    if not table or table.org_id != org_id:
        return None
    return table


@router.post("/", response_model=ApiResponse[RecordOut])
async def create_record(
    table_id: uuid.UUID,
    body: CreateRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        repo = RecordRepository(uow.session)
        record = Record(
            table_id=table_id,
            org_id=current_user.org_id,
            created_by=current_user.user_id,
            data=body.data,
            position=(await repo.get_max_position(table_id)) + 1,
        )
        record = await repo.create(record)
        await uow.commit()
        await uow.session.refresh(record)
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[RecordListOut])
async def list_records(
    table_id: uuid.UUID,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        repo = RecordRepository(uow.session)
        records = await repo.list_by_table(table_id, limit=limit, offset=offset)
        total = await repo.count_by_table(table_id)
        items = [RecordOut.model_validate(r) for r in records]
    return ApiResponse(data=RecordListOut(records=items, total=total))


@router.get("/{record_id}", response_model=ApiResponse[RecordOut])
async def get_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        repo = RecordRepository(uow.session)
        record = await repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Запись не найдена"})
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.patch("/{record_id}", response_model=ApiResponse[RecordOut])
async def update_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    body: UpdateRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        repo = RecordRepository(uow.session)
        record = await repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Запись не найдена"})

        # Merge data
        merged = {**record.data, **body.data}
        record.data = merged
        await repo.update(record)
        await uow.commit()
        await uow.session.refresh(record)
        item = RecordOut.model_validate(record)
    return ApiResponse(data=item)


@router.delete("/{record_id}", response_model=ApiResponse[None])
async def delete_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        repo = RecordRepository(uow.session)
        record = await repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Запись не найдена"})

        await repo.delete(record)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/{record_id}/move", response_model=ApiResponse[RecordOut])
async def move_record(
    table_id: uuid.UUID,
    record_id: uuid.UUID,
    body: MoveRecordRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        table = await _get_table_or_fail(table_id, current_user.org_id, uow)
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "РўР°Р±Р»РёС†Р° РЅРµ РЅР°Р№РґРµРЅР°"})

        repo = RecordRepository(uow.session)
        await repo.normalize_positions(table_id)
        record = await repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Р—Р°РїРёСЃСЊ РЅРµ РЅР°Р№РґРµРЅР°"})

        neighbor = (
            await repo.get_prev_in_table(table_id, record.position)
            if body.direction == "up"
            else await repo.get_next_in_table(table_id, record.position)
        )
        if not neighbor:
            await uow.session.refresh(record)
            return ApiResponse(data=RecordOut.model_validate(record))

        record.position, neighbor.position = neighbor.position, record.position
        await repo.update(record)
        await repo.update(neighbor)
        await uow.commit()
        await uow.session.refresh(record)
        return ApiResponse(data=RecordOut.model_validate(record))
