import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.models import Table, Column, FieldType
from src.modules.tables.repository import TableRepository, ColumnRepository
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/tables", tags=["tables"])


# --- Schemas ---

class ColumnOut(BaseModel):
    id: uuid.UUID
    name: str
    field_type: str
    position: int
    is_required: bool
    is_primary: bool
    config: dict | None
    default_value: str | None

    model_config = {"from_attributes": True}


class TableOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    icon: str | None
    color: str | None
    is_archived: bool
    columns: list[ColumnOut]
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTableRequest(BaseModel):
    name: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None


class UpdateTableRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_archived: bool | None = None


class CreateColumnRequest(BaseModel):
    name: str
    field_type: str
    is_required: bool = False
    is_primary: bool = False
    config: dict | None = None
    default_value: str | None = None


class UpdateColumnRequest(BaseModel):
    name: str | None = None
    field_type: str | None = None
    position: int | None = None
    is_required: bool | None = None
    config: dict | None = None
    default_value: str | None = None


# --- Table CRUD ---

@router.post("/", response_model=ApiResponse[TableOut])
async def create_table(
    body: CreateTableRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        repo = TableRepository(uow.session)
        table = Table(
            org_id=current_user.org_id,
            created_by=current_user.user_id,
            name=body.name,
            description=body.description,
            icon=body.icon,
            color=body.color,
        )
        table = await repo.create(table)
        # Auto-create a primary "Название" column
        col_repo = ColumnRepository(uow.session)
        primary_col = Column(
            table_id=table.id,
            name="Название",
            field_type=FieldType.TEXT,
            position=0,
            is_required=True,
            is_primary=True,
        )
        await col_repo.create(primary_col)
        await uow.commit()
        table = await repo.get_by_id(table.id)
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[TableOut]])
async def list_tables(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        repo = TableRepository(uow.session)
        tables = await repo.list_by_org(current_user.org_id)
        items = [TableOut.model_validate(t) for t in tables]
    return ApiResponse(data=items)


@router.get("/{table_id}", response_model=ApiResponse[TableOut])
async def get_table(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        repo = TableRepository(uow.session)
        table = await repo.get_by_id(table_id)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.patch("/{table_id}", response_model=ApiResponse[TableOut])
async def update_table(
    table_id: uuid.UUID,
    body: UpdateTableRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        repo = TableRepository(uow.session)
        table = await repo.get_by_id(table_id)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(table, field, value)
        await repo.update(table)
        await uow.commit()
        table = await repo.get_by_id(table_id)
        item = TableOut.model_validate(table)
    return ApiResponse(data=item)


@router.delete("/{table_id}", response_model=ApiResponse[None])
async def delete_table(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        repo = TableRepository(uow.session)
        table = await repo.get_by_id(table_id)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        await repo.delete(table)
        await uow.commit()
    return ApiResponse(data=None)


# --- Column CRUD ---

@router.post("/{table_id}/columns", response_model=ApiResponse[ColumnOut])
async def create_column(
    table_id: uuid.UUID,
    body: CreateColumnRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    if body.field_type not in FieldType.ALL:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_FIELD_TYPE", "message": f"Неверный тип поля: {body.field_type}"})

    async with UnitOfWork() as uow:
        table_repo = TableRepository(uow.session)
        table = await table_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        col_repo = ColumnRepository(uow.session)
        max_pos = await col_repo.get_max_position(table_id)
        column = Column(
            table_id=table_id,
            name=body.name,
            field_type=body.field_type,
            position=max_pos + 1,
            is_required=body.is_required,
            is_primary=body.is_primary,
            config=body.config,
            default_value=body.default_value,
        )
        column = await col_repo.create(column)
        await uow.commit()
        item = ColumnOut.model_validate(column)
    return ApiResponse(data=item)


@router.patch("/{table_id}/columns/{column_id}", response_model=ApiResponse[ColumnOut])
async def update_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    body: UpdateColumnRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        col_repo = ColumnRepository(uow.session)
        column = await col_repo.get_by_id(column_id)
        if not column or column.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Колонка не найдена"})
        # Verify org ownership
        table_repo = TableRepository(uow.session)
        table = await table_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        for field, value in body.model_dump(exclude_unset=True).items():
            if field == "field_type" and value not in FieldType.ALL:
                return ApiResponse(ok=False, data=None, error={"code": "INVALID_FIELD_TYPE", "message": f"Неверный тип поля: {value}"})
            setattr(column, field, value)
        await col_repo.update(column)
        await uow.commit()
        item = ColumnOut.model_validate(column)
    return ApiResponse(data=item)


@router.delete("/{table_id}/columns/{column_id}", response_model=ApiResponse[None])
async def delete_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        col_repo = ColumnRepository(uow.session)
        column = await col_repo.get_by_id(column_id)
        if not column or column.table_id != table_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Колонка не найдена"})
        table_repo = TableRepository(uow.session)
        table = await table_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        if column.is_primary:
            return ApiResponse(ok=False, data=None, error={"code": "CANNOT_DELETE_PRIMARY", "message": "Нельзя удалить первичную колонку"})

        await col_repo.delete(column)
        await uow.commit()
    return ApiResponse(data=None)
