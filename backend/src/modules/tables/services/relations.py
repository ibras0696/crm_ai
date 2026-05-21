from __future__ import annotations

import uuid

from src.modules.tables.models import FieldType, Table
from src.modules.tables.records import Record, RecordRepository
from src.modules.tables.repository import ColumnRepository, TableRepository


class RelationValidationError(ValueError):
    def __init__(self, *, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class TableRelationEngine:
    """Domain logic for relation/lookup/rollup fields.

    This class intentionally contains business rules only and does not own HTTP/transaction concerns.
    """

    def __init__(self, session):
        self.table_repo = TableRepository(session)
        self.column_repo = ColumnRepository(session)
        self.record_repo = RecordRepository(session)

    async def normalize_data_for_write(
        self,
        *,
        table: Table,
        incoming_data: dict | None,
        existing_data: dict | None,
    ) -> dict:
        base = dict(existing_data or {})
        patch = incoming_data if isinstance(incoming_data, dict) else {}
        if not patch:
            return base

        columns_by_id = {str(col.id): col for col in (table.columns or [])}
        result = dict(base)

        for raw_key, raw_value in patch.items():
            col_id = str(raw_key)
            column = columns_by_id.get(col_id)
            if column is None:
                result[col_id] = raw_value
                continue

            if column.field_type in {FieldType.LOOKUP, FieldType.ROLLUP, FieldType.FORMULA}:
                continue

            if column.field_type != FieldType.RELATION:
                result[col_id] = raw_value
                continue

            cfg = column.config if isinstance(column.config, dict) else {}
            related_table_id_raw = str(cfg.get("related_table_id") or "").strip()
            if not related_table_id_raw:
                raise RelationValidationError(
                    code="INVALID_COLUMN_CONFIG",
                    message=f"Для relation-колонки '{column.name}' не задан related_table_id",
                )

            related_table_id = self._parse_uuid_or_raise(
                related_table_id_raw,
                code="INVALID_COLUMN_CONFIG",
                message=f"Неверный related_table_id у relation-колонки '{column.name}'",
            )
            multiple = bool(cfg.get("multiple", False))
            normalized_ids = self.normalize_relation_ids(raw_value, multiple=multiple)

            if normalized_ids:
                parsed_ids = [
                    self._parse_uuid_or_raise(
                        x,
                        code="INVALID_RELATION_VALUE",
                        message=f"Некорректный relation id: {x}",
                    )
                    for x in normalized_ids
                ]
                existing = await self.record_repo.list_by_ids_for_table(
                    table_id=related_table_id,
                    record_ids=parsed_ids,
                )
                existing_set = {str(rec.id) for rec in existing}
                missing = [x for x in normalized_ids if x not in existing_set]
                if missing:
                    raise RelationValidationError(
                        code="INVALID_RELATION_VALUE",
                        message=f"Связанные записи не найдены: {', '.join(missing)}",
                    )

            result[col_id] = normalized_ids if multiple else (normalized_ids[0] if normalized_ids else None)

        return result

    async def enrich_records_for_read(
        self,
        *,
        table: Table,
        records: list[Record],
    ) -> None:
        if not records:
            return

        columns = list(table.columns or [])
        if not columns:
            return

        columns_by_id = {str(col.id): col for col in columns}
        relation_cols = [col for col in columns if col.field_type == FieldType.RELATION]
        lookup_cols = [col for col in columns if col.field_type == FieldType.LOOKUP]
        rollup_cols = [col for col in columns if col.field_type == FieldType.ROLLUP]

        if not lookup_cols and not rollup_cols:
            return

        relation_cache: dict[str, dict[str, Record]] = {}
        for rel_col in relation_cols:
            rel_col_id = str(rel_col.id)
            cfg = rel_col.config if isinstance(rel_col.config, dict) else {}
            related_table_id_raw = str(cfg.get("related_table_id") or "").strip()
            if not related_table_id_raw:
                continue
            try:
                related_table_id = uuid.UUID(related_table_id_raw)
            except Exception:
                continue

            related_ids: list[str] = []
            for rec in records:
                rec_data = rec.data if isinstance(rec.data, dict) else {}
                related_ids.extend(
                    self.normalize_relation_ids(
                        rec_data.get(rel_col_id),
                        multiple=bool(cfg.get("multiple", False)),
                    )
                )

            unique_ids = sorted(set(related_ids))
            if not unique_ids:
                relation_cache[rel_col_id] = {}
                continue

            parsed_ids: list[uuid.UUID] = []
            for raw_id in unique_ids:
                try:
                    parsed_ids.append(uuid.UUID(raw_id))
                except Exception:
                    continue

            if not parsed_ids:
                relation_cache[rel_col_id] = {}
                continue

            related_records = await self.record_repo.list_by_ids_for_table(
                table_id=related_table_id,
                record_ids=parsed_ids,
            )
            relation_cache[rel_col_id] = {str(item.id): item for item in related_records}

        for rec in records:
            data = dict(rec.data if isinstance(rec.data, dict) else {})

            for lookup_col in lookup_cols:
                lookup_cfg = lookup_col.config if isinstance(lookup_col.config, dict) else {}
                relation_col_id = str(lookup_cfg.get("relation_column_id") or "").strip()
                lookup_column_id = str(lookup_cfg.get("lookup_column_id") or "").strip()
                relation_column = columns_by_id.get(relation_col_id)
                if relation_column is None or relation_column.field_type != FieldType.RELATION or not lookup_column_id:
                    data[str(lookup_col.id)] = None
                    continue

                relation_cfg = relation_column.config if isinstance(relation_column.config, dict) else {}
                rel_ids = self.normalize_relation_ids(
                    data.get(relation_col_id),
                    multiple=bool(relation_cfg.get("multiple", False)),
                )
                rel_map = relation_cache.get(relation_col_id, {})
                values = [self.safe_data(rel_map[rid]).get(lookup_column_id) for rid in rel_ids if rid in rel_map]
                data[str(lookup_col.id)] = (
                    values
                    if bool(relation_cfg.get("multiple", False))
                    else (values[0] if values else None)
                )

            for rollup_col in rollup_cols:
                rollup_cfg = rollup_col.config if isinstance(rollup_col.config, dict) else {}
                relation_col_id = str(rollup_cfg.get("relation_column_id") or "").strip()
                lookup_column_id = str(rollup_cfg.get("lookup_column_id") or "").strip()
                agg = str(rollup_cfg.get("aggregation") or "count").strip().lower()
                relation_column = columns_by_id.get(relation_col_id)
                if relation_column is None or relation_column.field_type != FieldType.RELATION or not lookup_column_id:
                    data[str(rollup_col.id)] = None
                    continue

                relation_cfg = relation_column.config if isinstance(relation_column.config, dict) else {}
                rel_ids = self.normalize_relation_ids(
                    data.get(relation_col_id),
                    multiple=bool(relation_cfg.get("multiple", False)),
                )
                rel_map = relation_cache.get(relation_col_id, {})
                related_values = [
                    self.safe_data(rel_map[rid]).get(lookup_column_id)
                    for rid in rel_ids
                    if rid in rel_map
                ]

                if agg == "count":
                    data[str(rollup_col.id)] = len([v for v in related_values if v is not None and str(v) != ""])
                    continue

                nums: list[float] = []
                for value in related_values:
                    if value is None or str(value).strip() == "":
                        continue
                    try:
                        nums.append(float(value))
                    except Exception:
                        continue

                if not nums:
                    data[str(rollup_col.id)] = None
                elif agg == "sum":
                    data[str(rollup_col.id)] = sum(nums)
                elif agg == "avg":
                    data[str(rollup_col.id)] = sum(nums) / len(nums)
                elif agg == "min":
                    data[str(rollup_col.id)] = min(nums)
                elif agg == "max":
                    data[str(rollup_col.id)] = max(nums)
                else:
                    data[str(rollup_col.id)] = None

            rec.data = data

    async def get_relation_options(
        self,
        *,
        table_id: uuid.UUID,
        column_id: uuid.UUID,
        org_id: uuid.UUID,
        limit: int = 100,
        search: str | None = None,
    ) -> list[dict[str, str]]:
        table = await self.table_repo.get_by_id_for_org(table_id=table_id, org_id=org_id, with_columns=True)
        if table is None:
            raise RelationValidationError(code="NOT_FOUND", message="Таблица не найдена")

        relation_col = next((col for col in table.columns if col.id == column_id), None)
        if relation_col is None or relation_col.field_type != FieldType.RELATION:
            raise RelationValidationError(code="NOT_FOUND", message="Relation-колонка не найдена")

        cfg = relation_col.config if isinstance(relation_col.config, dict) else {}
        related_table_id_raw = str(cfg.get("related_table_id") or "").strip()
        if not related_table_id_raw:
            raise RelationValidationError(
                code="INVALID_COLUMN_CONFIG",
                message="У relation-поля не задана связанная таблица",
            )

        related_table_id = self._parse_uuid_or_raise(
            related_table_id_raw,
            code="INVALID_COLUMN_CONFIG",
            message="related_table_id должен быть UUID",
        )
        related_table = await self.table_repo.get_by_id_for_org(
            table_id=related_table_id,
            org_id=org_id,
            with_columns=True,
        )
        if related_table is None:
            raise RelationValidationError(code="NOT_FOUND", message="Связанная таблица не найдена")

        label_column_id = str(cfg.get("related_column_id") or "").strip()
        if not label_column_id:
            primary = next((col for col in related_table.columns if col.is_primary), None)
            label_column_id = (
                str(primary.id)
                if primary
                else (str(related_table.columns[0].id) if related_table.columns else "")
            )

        records = await self.record_repo.list_by_table(related_table_id, limit=max(1, min(int(limit), 500)), offset=0)
        needle = (search or "").strip().lower()
        out: list[dict[str, str]] = []

        for rec in records:
            data = rec.data if isinstance(rec.data, dict) else {}
            label = str(data.get(label_column_id) or rec.id)
            if needle and needle not in label.lower():
                continue
            out.append({"id": str(rec.id), "label": label})

        return out

    @staticmethod
    def normalize_relation_ids(value: object, *, multiple: bool) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            raw_items = list(value)
        elif isinstance(value, str) and multiple and "," in value:
            raw_items = [part.strip() for part in value.split(",")]
        else:
            raw_items = [value]

        out: list[str] = []
        for item in raw_items:
            normalized = str(item or "").strip()
            if not normalized:
                continue
            out.append(normalized)

        unique = list(dict.fromkeys(out))
        if not multiple and unique:
            return unique[:1]
        return unique

    @staticmethod
    def safe_data(record: Record) -> dict:
        return record.data if isinstance(record.data, dict) else {}

    @staticmethod
    def _parse_uuid_or_raise(raw_value: str, *, code: str, message: str) -> uuid.UUID:
        try:
            return uuid.UUID(str(raw_value).strip())
        except Exception as exc:
            raise RelationValidationError(code=code, message=message) from exc
