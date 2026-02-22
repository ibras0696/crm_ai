"""Pydantic schemas for reports and dashboards."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class TableSummary(BaseModel):
    id: str
    name: str
    records_count: int
    columns_count: int


class OrgReport(BaseModel):
    tables_count: int
    records_count: int
    columns_count: int
    tables: list[TableSummary]


class ColumnAggRequest(BaseModel):
    table_id: str
    column_ids: list[str] = Field(default_factory=list)


class ColumnAggResult(BaseModel):
    column_id: str
    column_name: str
    field_type: str
    count: int
    non_empty: int
    sum: float | None = None
    avg: float | None = None
    min_val: str | None = None
    max_val: str | None = None
    top_values: list[dict[str, int | str]] | None = None


class TableAggResponse(BaseModel):
    table_id: str
    table_name: str
    total_records: int
    columns: list[ColumnAggResult]


class TimeSeriesPoint(BaseModel):
    date: str
    count: int


class DashboardOut(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: datetime


class DashboardCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class DashboardUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None


class WidgetFilter(BaseModel):
    column_id: str
    op: str = "eq"  # eq|neq|contains|gt|lt|gte|lte
    value: str | float | int | bool


class WidgetConfig(BaseModel):
    aggregation: str = "count"  # count|sum|avg|min|max
    value_column_id: str | None = None
    group_by_column_id: str | None = None
    time_column_id: str | None = None
    time_granularity: str = "day"  # day|week|month
    filters: list[WidgetFilter] = Field(default_factory=list)
    limit: int = 10
    selected_column_ids: list[str] = Field(default_factory=list)


class WidgetOut(BaseModel):
    id: str
    title: str
    widget_type: str
    table_id: str | None
    config: WidgetConfig
    position: int
    created_at: datetime


class WidgetCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    widget_type: str = "metric"  # metric|bar|line|area|pie|donut|table
    table_id: str | None = None
    config: WidgetConfig = Field(default_factory=WidgetConfig)
    position: int = 0


class WidgetUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    widget_type: str | None = None
    table_id: str | None = None
    config: WidgetConfig | None = None
    position: int | None = None


class DashboardDetailOut(BaseModel):
    id: str
    name: str
    description: str | None
    widgets: list[WidgetOut]


class WidgetDataOut(BaseModel):
    widget: WidgetOut
    data: dict[str, Any]


class DashboardDataOut(BaseModel):
    dashboard: DashboardDetailOut
    items: list[WidgetDataOut]
