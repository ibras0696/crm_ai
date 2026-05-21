"""Pydantic schemas for tables module (tables, columns, folders, records, views)."""

from __future__ import annotations

import uuid  # noqa: TC003
from datetime import datetime  # noqa: TC003
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class ColumnOut(BaseModel):
    id: uuid.UUID
    name: str
    field_type: str
    position: int
    is_required: bool
    is_primary: bool
    config: dict[str, Any] | None
    default_value: str | None

    model_config = {"from_attributes": True}


class TableOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    folder_id: uuid.UUID | None
    name: str
    description: str | None
    icon: str | None
    color: str | None
    is_archived: bool
    columns: list[ColumnOut]
    created_at: datetime

    model_config = {"from_attributes": True}


class FolderOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateTableRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    folder_id: uuid.UUID | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class UpdateTableRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_archived: bool | None = None
    folder_id: uuid.UUID | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class CreateFolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class UpdateFolderRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    position: int | None = None
    parent_id: uuid.UUID | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class CreateColumnRequest(BaseModel):
    name: str
    field_type: str
    is_required: bool = False
    is_primary: bool = False
    config: dict[str, Any] | None = None
    default_value: str | None = None


class UpdateColumnRequest(BaseModel):
    name: str | None = None
    field_type: str | None = None
    position: int | None = None
    is_required: bool | None = None
    config: dict[str, Any] | None = None
    default_value: str | None = None


class RelationColumnConfig(BaseModel):
    related_table_id: uuid.UUID
    related_column_id: uuid.UUID | None = None
    multiple: bool = False


class LookupColumnConfig(BaseModel):
    relation_column_id: uuid.UUID
    lookup_column_id: uuid.UUID


class RollupColumnConfig(BaseModel):
    relation_column_id: uuid.UUID
    lookup_column_id: uuid.UUID
    aggregation: Literal["count", "sum", "avg", "min", "max"] = "count"


class FormulaColumnConfig(BaseModel):
    expression: str = Field(min_length=1, max_length=2000)
    result_type: str | None = None


class RelationOptionOut(BaseModel):
    id: str
    label: str


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
    expected_updated_at: datetime


class MoveRecordRequest(BaseModel):
    direction: Literal["up", "down"]


class ViewOut(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    name: str
    view_type: str
    is_default: bool
    filters: dict | list | None
    sorts: dict | list | None
    config: dict | list | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateViewRequest(BaseModel):
    name: str
    view_type: str = "grid"
    is_default: bool = False
    filters: dict | list | None = None
    sorts: dict | list | None = None
    config: dict | list | None = None


class UpdateViewRequest(BaseModel):
    name: str | None = None
    view_type: str | None = None
    is_default: bool | None = None
    filters: dict | list | None = None
    sorts: dict | list | None = None
    config: dict | list | None = None


class SortRequestItem(BaseModel):
    col_id: str
    dir: Literal["asc", "desc"] = "asc"


class FilterRequestItem(BaseModel):
    col_id: str
    op: Literal["eq", "neq", "gt", "lt", "between", "contains", "is_empty", "in"] = "contains"
    value: Any | None = None


class FilterRequest(BaseModel):
    """In-memory filtering request for table records.

    `filters` shape: `{col_id: {op: "eq"|"contains"|"gt"|"lt"|"neq", value: ...}}`
    `sorts` shape: `[{col_id: str, dir: "asc"|"desc"}]`
    """

    search: str | None = None
    filters: list[FilterRequestItem] | dict | None = None
    sorts: list[SortRequestItem] | None = None


class BulkUpdateRecordsRequest(BaseModel):
    record_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    data: dict[str, Any]


class BulkDeleteRecordsRequest(BaseModel):
    record_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class FormulaPreviewRequest(BaseModel):
    expression: str = Field(min_length=1, max_length=2000)
    sample_row: dict[str, Any] | None = None


class FormulaPreviewOut(BaseModel):
    expression: str
    referenced_column_ids: list[str]
    value_preview: Any | None = None
    warnings: list[str] = Field(default_factory=list)
    is_valid: bool = True
    error: str | None = None


class CsvImportColumnMatchOut(BaseModel):
    csv_column: str
    table_column_id: str | None = None
    table_column_name: str | None = None


class CsvImportRowErrorOut(BaseModel):
    row_number: int
    column: str
    code: str
    message: str
    raw_value: str | None = None


class CsvImportPreviewRowOut(BaseModel):
    row_number: int
    data: dict[str, Any]


class CsvImportPreviewOut(BaseModel):
    mode: Literal["append", "replace"]
    header: list[str]
    matched_columns: list[CsvImportColumnMatchOut]
    total_rows: int
    valid_rows: int
    invalid_rows: int
    sample_rows: list[CsvImportPreviewRowOut]
    errors: list[CsvImportRowErrorOut]


class CsvImportCommitOut(BaseModel):
    mode: Literal["append", "replace"]
    records_created: int
    records_skipped: int
    deleted_before: int
    total_rows: int
    errors: list[CsvImportRowErrorOut]


class RecordHistoryItemOut(BaseModel):
    id: uuid.UUID
    action: str
    actor_id: uuid.UUID | None = None
    changed_columns: list[str] = Field(default_factory=list)
    before_data: dict[str, Any] | None = None
    after_data: dict[str, Any] | None = None
    source: str | None = None
    created_at: datetime


class RecordHistoryListOut(BaseModel):
    items: list[RecordHistoryItemOut]
    total: int


class RecordRollbackOut(BaseModel):
    record: RecordOut
    rollback_from_history_id: uuid.UUID
