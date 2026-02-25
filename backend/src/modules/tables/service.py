"""Service layer for tables module."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.tables.models import Column, FieldType, Table, TableFolder, TableView
from src.modules.tables.records import Record, RecordRepository
from src.modules.tables.repository import (
    ColumnRepository,
    TableFolderRepository,
    TablePlanLimitsRepository,
    TableRepository,
    TableViewRepository,
)
from src.modules.tables.schemas import (
    CreateColumnRequest,
    CreateFolderRequest,
    CreateRecordRequest,
    CreateTableRequest,
    CreateViewRequest,
    MoveRecordRequest,
    UpdateColumnRequest,
    UpdateFolderRequest,
    UpdateRecordRequest,
    UpdateTableRequest,
)


class TableServiceError(Exception):
    """Domain error for tables module operations."""

    def __init__(self, *, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class TablesService:
    """Application service for folders/tables/columns CRUD."""
    MAX_FOLDER_DEPTH = 2

    def __init__(self, session: AsyncSession):
        self.folder_repo = TableFolderRepository(session)
        self.table_repo = TableRepository(session)
        self.column_repo = ColumnRepository(session)
        self.plan_limits_repo = TablePlanLimitsRepository(session)

    async def create_folder(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: CreateFolderRequest,
    ) -> TableFolder:
        parent_id = await self._validate_parent_folder(
            org_id=org_id,
            parent_id=body.parent_id,
            current_folder_id=None,
        )
        max_pos = await self.folder_repo.get_max_position(org_id)
        folder = TableFolder(
            org_id=org_id,
            created_by=user_id,
            parent_id=parent_id,
            name=body.name,
            position=max_pos + 1,
        )
        return await self.folder_repo.create(folder)

    async def list_folders(self, *, org_id: uuid.UUID) -> list[TableFolder]:
        return await self.folder_repo.list_by_org(org_id)

    async def update_folder(
        self,
        *,
        folder_id: uuid.UUID,
        org_id: uuid.UUID,
        body: UpdateFolderRequest,
    ) -> TableFolder:
        folder = await self.folder_repo.get_by_id(folder_id)
        if not folder or folder.org_id != org_id:
            raise TableServiceError(code="NOT_FOUND", message="Папка не найдена")

        updates = body.model_dump(exclude_unset=True)
        if "parent_id" in updates:
            updates["parent_id"] = await self._validate_parent_folder(
                org_id=org_id,
                parent_id=updates["parent_id"],
                current_folder_id=folder.id,
            )

        for field, value in updates.items():
            setattr(folder, field, value)
        return await self.folder_repo.update(folder)

    async def delete_folder(self, *, folder_id: uuid.UUID, org_id: uuid.UUID) -> None:
        folder = await self.folder_repo.get_by_id(folder_id)
        if not folder or folder.org_id != org_id:
            raise TableServiceError(code="NOT_FOUND", message="Папка не найдена")
        await self.table_repo.clear_folder(org_id=org_id, folder_id=folder_id)
        await self.folder_repo.delete(folder)

    async def create_table(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: CreateTableRequest,
    ) -> Table:
        await self._enforce_table_limit(org_id=org_id)
        if body.folder_id is not None:
            folder = await self.folder_repo.get_by_id(body.folder_id)
            if not folder or folder.org_id != org_id:
                raise TableServiceError(code="NOT_FOUND", message="Папка не найдена")

        table = Table(
            org_id=org_id,
            created_by=user_id,
            folder_id=body.folder_id,
            name=body.name,
            description=body.description,
            icon=body.icon,
            color=body.color,
        )
        table = await self.table_repo.create(table)

        primary_col = Column(
            table_id=table.id,
            name="Название",
            field_type=FieldType.TEXT,
            position=0,
            is_required=True,
            is_primary=True,
        )
        await self.column_repo.create(primary_col)
        return table

    async def list_tables(self, *, org_id: uuid.UUID) -> list[Table]:
        return await self.table_repo.list_by_org(org_id)

    async def get_table(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        with_columns: bool = True,
    ) -> Table:
        table = await self.table_repo.get_by_id_for_org(
            table_id=table_id,
            org_id=org_id,
            with_columns=with_columns,
        )
        if table is None:
            raise TableServiceError(code="NOT_FOUND", message="Таблица не найдена")
        return table

    async def update_table(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        body: UpdateTableRequest,
    ) -> Table:
        table = await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        updates = body.model_dump(exclude_unset=True)

        folder_id = updates.get("folder_id")
        if "folder_id" in updates and folder_id is not None:
            folder = await self.folder_repo.get_by_id(folder_id)
            if not folder or folder.org_id != org_id:
                raise TableServiceError(code="NOT_FOUND", message="Папка не найдена")

        for field, value in updates.items():
            setattr(table, field, value)
        await self.table_repo.update(table)
        return await self.get_table(table_id=table_id, org_id=org_id, with_columns=True)

    async def delete_table(self, *, table_id: uuid.UUID, org_id: uuid.UUID) -> None:
        table = await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        await self.table_repo.delete(table)

    async def create_column(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        body: CreateColumnRequest,
    ) -> Column:
        self._ensure_field_type(body.field_type)
        await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        max_pos = await self.column_repo.get_max_position(table_id)
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
        return await self.column_repo.create(column)

    async def update_column(
        self,
        *,
        table_id: uuid.UUID,
        column_id: uuid.UUID,
        org_id: uuid.UUID,
        body: UpdateColumnRequest,
    ) -> Column:
        await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        column = await self.column_repo.get_by_id_for_table(column_id=column_id, table_id=table_id)
        if column is None:
            raise TableServiceError(code="NOT_FOUND", message="Колонка не найдена")
        for field, value in body.model_dump(exclude_unset=True).items():
            if field == "field_type":
                self._ensure_field_type(value)
            setattr(column, field, value)
        return await self.column_repo.update(column)

    async def delete_column(
        self,
        *,
        table_id: uuid.UUID,
        column_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> None:
        await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        column = await self.column_repo.get_by_id_for_table(column_id=column_id, table_id=table_id)
        if column is None:
            raise TableServiceError(code="NOT_FOUND", message="Колонка не найдена")
        if column.is_primary:
            raise TableServiceError(code="CANNOT_DELETE_PRIMARY", message="Нельзя удалить первичную колонку")
        await self.column_repo.delete(column)

    @staticmethod
    def _ensure_field_type(field_type: str) -> None:
        if field_type not in FieldType.ALL:
            raise TableServiceError(code="INVALID_FIELD_TYPE", message=f"Неверный тип поля: {field_type}")

    async def _validate_parent_folder(
        self,
        *,
        org_id: uuid.UUID,
        parent_id: uuid.UUID | None,
        current_folder_id: uuid.UUID | None,
    ) -> uuid.UUID | None:
        if parent_id is None:
            return None

        if current_folder_id is not None and parent_id == current_folder_id:
            raise TableServiceError(code="INVALID_PARENT", message="Нельзя вложить папку в саму себя")

        folders = await self.folder_repo.list_by_org(org_id)
        folders_by_id = {folder.id: folder for folder in folders}
        parent = folders_by_id.get(parent_id)
        if not parent or parent.org_id != org_id:
            raise TableServiceError(code="NOT_FOUND", message="Родительская папка не найдена")

        # Защита от циклов: нельзя выбрать потомка в качестве родителя.
        if current_folder_id is not None:
            cursor = parent
            while cursor.parent_id is not None:
                if cursor.parent_id == current_folder_id:
                    raise TableServiceError(code="INVALID_PARENT", message="Нельзя вложить папку в своего потомка")
                cursor = folders_by_id.get(cursor.parent_id)
                if cursor is None or cursor.org_id != org_id:
                    break

        depth = 0
        cursor = parent
        while cursor.parent_id is not None:
            depth += 1
            cursor = folders_by_id.get(cursor.parent_id)
            if cursor is None or cursor.org_id != org_id:
                break
            if depth > self.MAX_FOLDER_DEPTH:
                break

        if depth + 1 > self.MAX_FOLDER_DEPTH:
            raise TableServiceError(
                code="MAX_DEPTH_EXCEEDED",
                message="Максимальная вложенность папок: 2 уровня",
            )

        return parent_id

    async def _enforce_table_limit(self, *, org_id: uuid.UUID) -> None:
        plan = await self.plan_limits_repo.resolve_effective_plan(org_id=org_id)
        limit = int(getattr(plan, "max_tables", 0) or 0)
        if limit <= 0:
            return
        current = await self.table_repo.count_by_org(org_id)
        if current >= limit:
            raise TableServiceError(
                code="TABLE_LIMIT_REACHED",
                message=f"Достигнут лимит тарифа по таблицам ({limit})",
            )


class TableRecordsService:
    """Application service for table records CRUD and ordering."""

    def __init__(self, session: AsyncSession):
        self.table_repo = TableRepository(session)
        self.record_repo = RecordRepository(session)
        self.plan_limits_repo = TablePlanLimitsRepository(session)

    async def create_record(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: CreateRecordRequest,
    ) -> Record:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id)
        await self._enforce_record_limit(org_id=org_id)
        position = (await self.record_repo.get_max_position(table_id)) + 1
        record = Record(
            table_id=table_id,
            org_id=org_id,
            created_by=user_id,
            data=body.data,
            position=position,
        )
        return await self.record_repo.create(record)

    async def list_records(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[list[Record], int]:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id)
        records = await self.record_repo.list_by_table(table_id, limit=limit, offset=offset)
        total = await self.record_repo.count_by_table(table_id)
        return records, total

    async def get_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> Record:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id)
        record = await self.record_repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            raise TableServiceError(code="NOT_FOUND", message="Запись не найдена")
        return record

    async def update_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        body: UpdateRecordRequest,
    ) -> Record:
        record = await self.get_record(table_id=table_id, record_id=record_id, org_id=org_id)
        record.data = {**record.data, **body.data}
        await self.record_repo.update(record)
        return record

    async def delete_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> None:
        record = await self.get_record(table_id=table_id, record_id=record_id, org_id=org_id)
        await self.record_repo.delete(record)

    async def move_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        body: MoveRecordRequest,
    ) -> Record:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id)
        await self.record_repo.normalize_positions(table_id)

        record = await self.record_repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            raise TableServiceError(code="NOT_FOUND", message="Запись не найдена")

        neighbor = (
            await self.record_repo.get_prev_in_table(table_id, record.position)
            if body.direction == "up"
            else await self.record_repo.get_next_in_table(table_id, record.position)
        )
        if neighbor is None:
            return record

        record.position, neighbor.position = neighbor.position, record.position
        await self.record_repo.update(record)
        await self.record_repo.update(neighbor)
        return record

    async def _ensure_table_scope(self, *, table_id: uuid.UUID, org_id: uuid.UUID) -> Table:
        table = await self.table_repo.get_by_id_for_org(table_id=table_id, org_id=org_id, with_columns=False)
        if table is None:
            raise TableServiceError(code="NOT_FOUND", message="Таблица не найдена")
        return table

    async def _enforce_record_limit(self, *, org_id: uuid.UUID) -> None:
        plan = await self.plan_limits_repo.resolve_effective_plan(org_id=org_id)
        limit = int(getattr(plan, "max_records", 0) or 0)
        if limit <= 0:
            return
        current = await self.plan_limits_repo.count_records_by_org(org_id)
        if current >= limit:
            raise TableServiceError(
                code="RECORD_LIMIT_REACHED",
                message=f"Достигнут лимит тарифа по записям ({limit})",
            )


class TableViewsService:
    """Application service for saved table views."""

    def __init__(self, session: AsyncSession):
        self.table_repo = TableRepository(session)
        self.view_repo = TableViewRepository(session)

    async def create_view(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        body: CreateViewRequest,
    ) -> TableView:
        table = await self.table_repo.get_by_id_for_org(table_id=table_id, org_id=org_id, with_columns=False)
        if table is None:
            raise TableServiceError(code="NOT_FOUND", message="Таблица не найдена")
        view = TableView(
            table_id=table_id,
            org_id=org_id,
            name=body.name,
            view_type=body.view_type,
            filters=body.filters,
            sorts=body.sorts,
            config=body.config,
        )
        return await self.view_repo.create(view)

    async def list_views(self, *, table_id: uuid.UUID, org_id: uuid.UUID) -> list[TableView]:
        table = await self.table_repo.get_by_id_for_org(table_id=table_id, org_id=org_id, with_columns=False)
        if table is None:
            raise TableServiceError(code="NOT_FOUND", message="Таблица не найдена")
        return await self.view_repo.list_by_table(table_id=table_id, org_id=org_id)

    async def delete_view(
        self,
        *,
        table_id: uuid.UUID,
        view_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> None:
        view = await self.view_repo.get_by_id_for_scope(view_id=view_id, table_id=table_id, org_id=org_id)
        if view is None:
            raise TableServiceError(code="NOT_FOUND", message="Вид не найден")
        await self.view_repo.delete(view)
