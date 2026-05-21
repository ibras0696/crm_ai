"""Service layer for tables module."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from src.common.enums import AuditAction
from src.common.optimistic_lock import optimistic_lock_matches
from src.modules.audit.models import AuditLog
from src.modules.tables.errors import TablesModuleError
from src.modules.tables.models import Column, FieldType, Table, TableFolder, TableView
from src.modules.tables.records import Record, RecordRepository
from src.modules.tables.repository import (
    ColumnRepository,
    TableFolderRepository,
    TablePlanLimitsRepository,
    TableRepository,
    TableViewRepository,
)
from src.modules.tables.services import (
    FormulaValidationError,
    RelationValidationError,
    TableFormulaEngine,
    TableRelationEngine,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from src.modules.tables.schemas import (
        BulkDeleteRecordsRequest,
        BulkUpdateRecordsRequest,
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
        UpdateViewRequest,
    )


class TableServiceError(TablesModuleError):
    """Domain error for tables module operations."""

    def __init__(self, *, code: str, message: str, status_code: int = 422):
        super().__init__(code=code, message=message, status_code=status_code)


class TablesService:
    """Application service for folders/tables/columns CRUD."""

    MAX_FOLDER_DEPTH = 2

    def __init__(self, session: AsyncSession):
        self.folder_repo = TableFolderRepository(session)
        self.table_repo = TableRepository(session)
        self.column_repo = ColumnRepository(session)
        self.plan_limits_repo = TablePlanLimitsRepository(session)
        self.formula_engine = TableFormulaEngine()

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
        normalized_config = await self._normalize_column_config(
            table_id=table_id,
            org_id=org_id,
            field_type=body.field_type,
            config=body.config,
        )
        await self.get_table(table_id=table_id, org_id=org_id, with_columns=False)
        max_pos = await self.column_repo.get_max_position(table_id)
        column = Column(
            table_id=table_id,
            name=body.name,
            field_type=body.field_type,
            position=max_pos + 1,
            is_required=body.is_required,
            is_primary=body.is_primary,
            config=normalized_config,
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
        updates = body.model_dump(exclude_unset=True)
        target_field_type = str(updates.get("field_type") or column.field_type)
        if "field_type" in updates:
            self._ensure_field_type(target_field_type)
        if "config" in updates or "field_type" in updates:
            updates["config"] = await self._normalize_column_config(
                table_id=table_id,
                org_id=org_id,
                field_type=target_field_type,
                config=updates.get("config", column.config),
            )
        for field, value in updates.items():
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

    async def _normalize_column_config(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        field_type: str,
        config: dict | None,
    ) -> dict | None:
        if config is None:
            if field_type in {FieldType.RELATION, FieldType.LOOKUP, FieldType.ROLLUP, FieldType.FORMULA}:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message=f"Для поля типа '{field_type}' требуется конфигурация",
                )
            return None
        if not isinstance(config, dict):
            raise TableServiceError(code="INVALID_COLUMN_CONFIG", message="Конфигурация колонки должна быть объектом")

        if field_type in {FieldType.SELECT, FieldType.MULTI_SELECT}:
            options = config.get("options")
            if options is None:
                return None
            if not isinstance(options, list):
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Для select/multi_select ожидается options: string[]",
                )
            normalized = [str(x).strip() for x in options if str(x).strip()]
            return {"options": normalized}

        if field_type == FieldType.RELATION:
            related_table_id_raw = str(config.get("related_table_id") or "").strip()
            if not related_table_id_raw:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Для relation требуется related_table_id",
                )
            try:
                related_table_id = uuid.UUID(related_table_id_raw)
            except Exception as exc:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="related_table_id должен быть UUID",
                ) from exc

            related_table = await self.table_repo.get_by_id_for_org(
                table_id=related_table_id,
                org_id=org_id,
                with_columns=False,
            )
            if related_table is None:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="related_table_id не найден в организации",
                )
            related_column_raw = str(config.get("related_column_id") or "").strip()
            if related_column_raw:
                try:
                    related_column_id = uuid.UUID(related_column_raw)
                except Exception as exc:
                    raise TableServiceError(
                        code="INVALID_COLUMN_CONFIG",
                        message="related_column_id должен быть UUID",
                    ) from exc
                related_column = await self.column_repo.get_by_id(related_column_id)
                if related_column is None or str(related_column.table_id) != str(related_table_id):
                    raise TableServiceError(
                        code="INVALID_COLUMN_CONFIG",
                        message="related_column_id должен принадлежать related_table_id",
                    )

            return {
                "related_table_id": str(related_table_id),
                "related_column_id": related_column_raw or None,
                "multiple": bool(config.get("multiple", False)),
            }

        if field_type == FieldType.LOOKUP:
            relation_column_id = str(config.get("relation_column_id") or "").strip()
            lookup_column_id = str(config.get("lookup_column_id") or "").strip()
            if not relation_column_id or not lookup_column_id:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Для lookup требуются relation_column_id и lookup_column_id",
                )
            relation_column_uuid = self._parse_uuid_or_raise(
                relation_column_id,
                message="relation_column_id должен быть UUID",
            )
            lookup_column_uuid = self._parse_uuid_or_raise(
                lookup_column_id,
                message="lookup_column_id должен быть UUID",
            )
            relation_column = await self.column_repo.get_by_id_for_table(
                column_id=relation_column_uuid,
                table_id=table_id,
            )
            if relation_column is None or relation_column.field_type != FieldType.RELATION:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="relation_column_id должен ссылаться на relation-поле текущей таблицы",
                )
            relation_cfg = relation_column.config if isinstance(relation_column.config, dict) else {}
            related_table_id_raw = str(relation_cfg.get("related_table_id") or "").strip()
            related_table_id = self._parse_uuid_or_raise(
                related_table_id_raw,
                message="У relation-поля отсутствует корректный related_table_id",
            )
            lookup_column = await self.column_repo.get_by_id(lookup_column_uuid)
            if lookup_column is None or lookup_column.table_id != related_table_id:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="lookup_column_id должен принадлежать связанной таблице relation-поля",
                )
            return {"relation_column_id": relation_column_id, "lookup_column_id": lookup_column_id}

        if field_type == FieldType.ROLLUP:
            relation_column_id = str(config.get("relation_column_id") or "").strip()
            lookup_column_id = str(config.get("lookup_column_id") or "").strip()
            aggregation = str(config.get("aggregation") or "count").strip().lower()
            if not relation_column_id or not lookup_column_id:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Для rollup требуются relation_column_id и lookup_column_id",
                )
            if aggregation not in {"count", "sum", "avg", "min", "max"}:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="aggregation должен быть одним из: count,sum,avg,min,max",
                )
            relation_column_uuid = self._parse_uuid_or_raise(
                relation_column_id,
                message="relation_column_id должен быть UUID",
            )
            lookup_column_uuid = self._parse_uuid_or_raise(
                lookup_column_id,
                message="lookup_column_id должен быть UUID",
            )
            relation_column = await self.column_repo.get_by_id_for_table(
                column_id=relation_column_uuid,
                table_id=table_id,
            )
            if relation_column is None or relation_column.field_type != FieldType.RELATION:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="relation_column_id должен ссылаться на relation-поле текущей таблицы",
                )
            relation_cfg = relation_column.config if isinstance(relation_column.config, dict) else {}
            related_table_id_raw = str(relation_cfg.get("related_table_id") or "").strip()
            related_table_id = self._parse_uuid_or_raise(
                related_table_id_raw,
                message="У relation-поля отсутствует корректный related_table_id",
            )
            lookup_column = await self.column_repo.get_by_id(lookup_column_uuid)
            if lookup_column is None or lookup_column.table_id != related_table_id:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="lookup_column_id должен принадлежать связанной таблице relation-поля",
                )
            return {
                "relation_column_id": relation_column_id,
                "lookup_column_id": lookup_column_id,
                "aggregation": aggregation,
            }

        if field_type == FieldType.FORMULA:
            expression = str(config.get("expression") or "").strip()
            if not expression:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Для formula требуется expression",
                )
            if len(expression) > 2000:
                raise TableServiceError(
                    code="INVALID_COLUMN_CONFIG",
                    message="Formula expression слишком длинное (максимум 2000)",
                )
            result_type = str(config.get("result_type") or "").strip() or None
            table = await self.get_table(table_id=table_id, org_id=org_id, with_columns=True)
            try:
                self.formula_engine.validate_expression(table=table, expression=expression)
            except FormulaValidationError as error:
                raise TableServiceError(code=error.code, message=error.message) from error
            return {"expression": expression, "result_type": result_type}

        return config

    @staticmethod
    def _parse_uuid_or_raise(raw_value: str, *, message: str) -> uuid.UUID:
        try:
            return uuid.UUID(str(raw_value).strip())
        except Exception as exc:
            raise TableServiceError(code="INVALID_COLUMN_CONFIG", message=message) from exc

    async def preview_formula(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        expression: str,
        sample_row: dict | None,
    ) -> dict:
        table = await self.get_table(table_id=table_id, org_id=org_id, with_columns=True)
        return self.formula_engine.preview(
            table=table,
            expression=expression,
            sample_row=sample_row,
        )

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
        self.session = session
        self.table_repo = TableRepository(session)
        self.record_repo = RecordRepository(session)
        self.plan_limits_repo = TablePlanLimitsRepository(session)
        self.relation_engine = TableRelationEngine(session)
        self.formula_engine = TableFormulaEngine()

    async def create_record(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: CreateRecordRequest,
    ) -> Record:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
        await self._enforce_record_limit(org_id=org_id)
        normalized_data = await self._normalize_data_for_write(
            table=table,
            incoming_data=body.data,
            existing_data=None,
        )
        position = (await self.record_repo.get_max_position(table_id)) + 1
        record = Record(
            table_id=table_id,
            org_id=org_id,
            created_by=user_id,
            data=normalized_data,
            position=position,
        )
        created = await self.record_repo.create(record)
        await self.enrich_records_for_read(table=table, records=[created])
        await self._log_record_event(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            record_id=created.id,
            table_id=table_id,
            before_data=None,
            after_data=dict(created.data or {}),
            source="records.create",
        )
        return created

    async def list_records(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[list[Record], int]:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
        records = await self.record_repo.list_by_table(table_id, limit=limit, offset=offset)
        await self.enrich_records_for_read(table=table, records=records)
        total = await self.record_repo.count_by_table(table_id)
        return records, total

    async def get_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> Record:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
        record = await self.record_repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            raise TableServiceError(code="NOT_FOUND", message="Запись не найдена")
        await self.enrich_records_for_read(table=table, records=[record])
        return record

    async def update_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID | None,
        body: UpdateRecordRequest,
    ) -> Record:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
        record = await self.record_repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            raise TableServiceError(code="NOT_FOUND", message="Запись не найдена")
        if not optimistic_lock_matches(current=record.updated_at, expected=body.expected_updated_at):
            raise TableServiceError(
                code="CONFLICT",
                message="Запись уже изменена другим сотрудником. Обновите таблицу и повторите изменение.",
                status_code=409,
            )
        before_data = dict(record.data or {})
        merged = await self._normalize_data_for_write(
            table=table,
            incoming_data=body.data,
            existing_data=before_data,
        )
        if merged == before_data:
            await self.enrich_records_for_read(table=table, records=[record])
            return record
        record.data = merged
        await self.record_repo.update(record)
        await self.enrich_records_for_read(table=table, records=[record])
        await self._log_record_event(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            record_id=record.id,
            table_id=table_id,
            before_data=before_data,
            after_data=dict(record.data or {}),
            source="records.update",
        )
        return record

    async def delete_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=False)
        record = await self.record_repo.get_by_id(record_id)
        if not record or record.table_id != table_id:
            raise TableServiceError(code="NOT_FOUND", message="Запись не найдена")
        before_data = dict(record.data or {})
        await self._log_record_event(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.DELETE,
            record_id=record.id,
            table_id=table_id,
            before_data=before_data,
            after_data=None,
            source="records.delete",
        )
        await self.record_repo.delete(record)

    async def bulk_update_records(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID | None,
        body: BulkUpdateRecordsRequest,
    ) -> int:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
        if not body.data:
            return 0
        target_ids = list(dict.fromkeys(body.record_ids))
        records = await self.record_repo.list_by_ids_for_table(table_id=table_id, record_ids=target_ids)
        if not records:
            return 0
        updated_count = 0
        for rec in records:
            before_data = dict(rec.data or {})
            merged = await self._normalize_data_for_write(
                table=table,
                incoming_data=body.data,
                existing_data=before_data,
            )
            if merged == before_data:
                continue
            rec.data = merged
            await self.record_repo.update(rec)
            updated_count += 1
            await self._log_record_event(
                org_id=org_id,
                actor_id=user_id,
                action=AuditAction.UPDATE,
                record_id=rec.id,
                table_id=table_id,
                before_data=before_data,
                after_data=dict(rec.data or {}),
                source="records.bulk_update",
            )
        return updated_count

    async def bulk_delete_records(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID | None,
        body: BulkDeleteRecordsRequest,
    ) -> int:
        await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=False)
        target_ids = list(dict.fromkeys(body.record_ids))
        if not target_ids:
            return 0
        records = await self.record_repo.list_by_ids_for_table(table_id=table_id, record_ids=target_ids)
        for rec in records:
            await self._log_record_event(
                org_id=org_id,
                actor_id=user_id,
                action=AuditAction.DELETE,
                record_id=rec.id,
                table_id=table_id,
                before_data=dict(rec.data or {}),
                after_data=None,
                source="records.bulk_delete",
            )
        return await self.record_repo.bulk_delete_by_ids(table_id=table_id, record_ids=target_ids)

    async def move_record(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        body: MoveRecordRequest,
    ) -> Record:
        table = await self._ensure_table_scope(table_id=table_id, org_id=org_id, with_columns=True)
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
        await self.enrich_records_for_read(table=table, records=[record])
        return record

    async def get_relation_options(
        self,
        *,
        table_id: uuid.UUID,
        column_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int = 100,
        search: str | None = None,
    ) -> list[dict[str, str]]:
        try:
            return await self.relation_engine.get_relation_options(
                table_id=table_id,
                column_id=column_id,
                org_id=org_id,
                limit=limit,
                search=search,
            )
        except RelationValidationError as error:
            raise TableServiceError(code=error.code, message=error.message) from error

    async def list_record_history(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> tuple[list[AuditLog], int]:
        await self.get_record(table_id=table_id, record_id=record_id, org_id=org_id)
        base = select(AuditLog).where(
            AuditLog.org_id == org_id,
            AuditLog.entity_type == "table_record",
            AuditLog.entity_id == str(record_id),
        )
        total = int((await self.session.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0)
        rows = list(
            (
                await self.session.execute(
                    base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
                )
            ).scalars().all()
        )
        return rows, total

    async def rollback_last_record_change(
        self,
        *,
        table_id: uuid.UUID,
        record_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> tuple[Record, uuid.UUID]:
        record = await self.get_record(table_id=table_id, record_id=record_id, org_id=org_id)
        history_stmt = (
            select(AuditLog)
            .where(
                AuditLog.org_id == org_id,
                AuditLog.entity_type == "table_record",
                AuditLog.entity_id == str(record_id),
                AuditLog.action == AuditAction.UPDATE,
            )
            .order_by(AuditLog.created_at.desc())
            .limit(20)
        )
        history_rows = list((await self.session.execute(history_stmt)).scalars().all())
        revert_from: AuditLog | None = None
        for item in history_rows:
            meta = item.meta if isinstance(item.meta, dict) else {}
            before = meta.get("before_data")
            if isinstance(before, dict):
                revert_from = item
                break
        if revert_from is None:
            raise TableServiceError(code="NO_HISTORY", message="Нет изменений для отката", status_code=409)

        before_data = dict(record.data or {})
        revert_meta = revert_from.meta if isinstance(revert_from.meta, dict) else {}
        restored_data = revert_meta.get("before_data")
        if not isinstance(restored_data, dict):
            raise TableServiceError(code="NO_HISTORY", message="Нет изменений для отката", status_code=409)

        record.data = restored_data
        await self.record_repo.update(record)
        await self._log_record_event(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.UPDATE,
            record_id=record.id,
            table_id=table_id,
            before_data=before_data,
            after_data=dict(record.data or {}),
            source="records.rollback_last",
            extra_meta={"rollback_from_history_id": str(revert_from.id)},
        )
        return record, revert_from.id

    async def _ensure_table_scope(self, *, table_id: uuid.UUID, org_id: uuid.UUID, with_columns: bool = False) -> Table:
        table = await self.table_repo.get_by_id_for_org(table_id=table_id, org_id=org_id, with_columns=with_columns)
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

    async def _log_record_event(
        self,
        *,
        org_id: uuid.UUID,
        actor_id: uuid.UUID | None,
        action: AuditAction,
        record_id: uuid.UUID,
        table_id: uuid.UUID,
        before_data: dict | None,
        after_data: dict | None,
        source: str,
        extra_meta: dict | None = None,
    ) -> None:
        changed_columns = self._changed_columns(before_data=before_data, after_data=after_data)
        meta = {
            "table_id": str(table_id),
            "record_id": str(record_id),
            "source": source,
            "changed_columns": changed_columns,
            "before_data": before_data,
            "after_data": after_data,
        }
        if extra_meta:
            meta.update(extra_meta)
        self.session.add(
            AuditLog(
                org_id=org_id,
                actor_id=actor_id,
                action=action,
                entity_type="table_record",
                entity_id=str(record_id),
                meta=meta,
            )
        )
        await self.session.flush()

    @staticmethod
    def _changed_columns(*, before_data: dict | None, after_data: dict | None) -> list[str]:
        before = before_data or {}
        after = after_data or {}
        keys = set(before.keys()) | set(after.keys())
        return sorted([str(k) for k in keys if before.get(k) != after.get(k)])

    async def _normalize_data_for_write(
        self,
        *,
        table: Table,
        incoming_data: dict | None,
        existing_data: dict | None,
    ) -> dict:
        try:
            return await self.relation_engine.normalize_data_for_write(
                table=table,
                incoming_data=incoming_data,
                existing_data=existing_data,
            )
        except RelationValidationError as error:
            raise TableServiceError(code=error.code, message=error.message) from error

    async def enrich_records_for_read(
        self,
        *,
        table: Table,
        records: list[Record],
    ) -> None:
        try:
            await self.relation_engine.enrich_records_for_read(table=table, records=records)
            await self.formula_engine.enrich_records_for_read(table=table, records=records)
        except RelationValidationError as error:
            raise TableServiceError(code=error.code, message=error.message) from error
        except FormulaValidationError as error:
            raise TableServiceError(code=error.code, message=error.message) from error


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
        if body.is_default:
            await self.view_repo.clear_default_for_table(table_id=table_id, org_id=org_id)
        view = TableView(
            table_id=table_id,
            org_id=org_id,
            name=body.name,
            view_type=body.view_type,
            is_default=body.is_default,
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

    async def update_view(
        self,
        *,
        table_id: uuid.UUID,
        view_id: uuid.UUID,
        org_id: uuid.UUID,
        body: UpdateViewRequest,
    ) -> TableView:
        view = await self.view_repo.get_by_id_for_scope(view_id=view_id, table_id=table_id, org_id=org_id)
        if view is None:
            raise TableServiceError(code="NOT_FOUND", message="Вид не найден")

        updates = body.model_dump(exclude_unset=True)
        if updates.get("is_default") is True:
            await self.view_repo.clear_default_for_table(
                table_id=table_id,
                org_id=org_id,
                exclude_view_id=view.id,
            )

        for field, value in updates.items():
            setattr(view, field, value)
        return await self.view_repo.update(view)
