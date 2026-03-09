"""Pydantic schemas for tables module (tables, columns, folders, records, views)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


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
    config: dict | None = None
    default_value: str | None = None


class UpdateColumnRequest(BaseModel):
    name: str | None = None
    field_type: str | None = None
    position: int | None = None
    is_required: bool | None = None
    config: dict | None = None
    default_value: str | None = None


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
    filters: dict | None
    sorts: dict | None
    config: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateViewRequest(BaseModel):
    name: str
    view_type: str = "grid"
    filters: dict | None = None
    sorts: dict | None = None
    config: dict | None = None


class FilterRequest(BaseModel):
    # {col_id: {op: "eq"|"contains"|"gt"|"lt"|"neq", value: ...}}
    filters: dict | None = None
    # [{col_id: str, dir: "asc"|"desc"}]
    sorts: list[dict] | None = None
