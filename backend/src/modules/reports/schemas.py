"""Pydantic schemas for analytics, reports and dashboards."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

ALLOWED_WIDGET_TYPES = {"metric", "bar", "line", "area", "pie", "donut", "table"}
ALLOWED_ANALYTICS_WIDGET_TYPES = {"metric", "bar", "line", "donut", "table", "pie", "area"}
ALLOWED_AGGREGATIONS = {"count", "sum", "avg", "min", "max"}
ALLOWED_TIME_GRANULARITY = {"day", "week", "month"}
ALLOWED_FILTER_OPS = {
    "eq",
    "neq",
    "contains",
    "gt",
    "lt",
    "gte",
    "lte",
    "in",
    "not_in",
    "is_empty",
    "not_empty",
    "between",
}
ALLOWED_SORT_BY = {"label", "metric"}
ALLOWED_SORT_DIRECTION = {"asc", "desc"}


def _normalize_str(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


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

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = _normalize_str(value)
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class DashboardUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    description: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = _normalize_str(value)
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class AnalyticsMetric(BaseModel):
    key: str = "value"
    aggregation: str = "count"
    column_id: str | None = None
    label: str | None = None

    @field_validator("key", mode="before")
    @classmethod
    def _normalize_key(cls, value: str) -> str:
        normalized = _normalize_str(value) or "value"
        return normalized.replace(" ", "_").lower()

    @field_validator("aggregation", mode="before")
    @classmethod
    def _normalize_aggregation(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "count").lower()
        if normalized not in ALLOWED_AGGREGATIONS:
            raise ValueError(f"Некорректная агрегация: {normalized}")
        return normalized


class AnalyticsFilter(BaseModel):
    column_id: str
    op: str = "eq"
    value: Any | None = None
    values: list[Any] = Field(default_factory=list)
    from_value: Any | None = None
    to_value: Any | None = None

    @field_validator("op", mode="before")
    @classmethod
    def _normalize_op(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "eq").lower()
        if normalized not in ALLOWED_FILTER_OPS:
            raise ValueError(f"Некорректная операция фильтра: {normalized}")
        return normalized


class AnalyticsSort(BaseModel):
    by: str = "metric"
    metric_key: str | None = None
    direction: str = "desc"

    @field_validator("by", mode="before")
    @classmethod
    def _normalize_by(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "metric").lower()
        if normalized not in ALLOWED_SORT_BY:
            raise ValueError(f"Некорректный тип сортировки: {normalized}")
        return normalized

    @field_validator("direction", mode="before")
    @classmethod
    def _normalize_direction(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "desc").lower()
        if normalized not in ALLOWED_SORT_DIRECTION:
            raise ValueError(f"Некорректное направление сортировки: {normalized}")
        return normalized


class AnalyticsQueryRequest(BaseModel):
    table_id: str
    widget_type: str = "table"
    title: str | None = None
    metrics: list[AnalyticsMetric] = Field(default_factory=list)
    group_by_column_id: str | None = None
    time_column_id: str | None = None
    date_bucket: str = "month"
    filters: list[AnalyticsFilter] = Field(default_factory=list)
    sort: AnalyticsSort | None = None
    limit: int = 10
    selected_column_ids: list[str] = Field(default_factory=list)

    @field_validator("widget_type", mode="before")
    @classmethod
    def _normalize_widget_type(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "table").lower()
        if normalized not in ALLOWED_ANALYTICS_WIDGET_TYPES:
            raise ValueError(f"Некорректный тип виджета: {normalized}")
        return normalized

    @field_validator("date_bucket", mode="before")
    @classmethod
    def _normalize_bucket(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "month").lower()
        if normalized not in ALLOWED_TIME_GRANULARITY:
            raise ValueError(f"Некорректная гранулярность: {normalized}")
        return normalized

    @field_validator("limit", mode="before")
    @classmethod
    def _normalize_limit(cls, value: int) -> int:
        parsed = int(value)
        if parsed < 1 or parsed > 500:
            raise ValueError("limit должен быть в диапазоне 1..500")
        return parsed

    @model_validator(mode="after")
    def _ensure_metrics(self) -> "AnalyticsQueryRequest":
        if not self.metrics:
            self.metrics = [AnalyticsMetric()]
        return self


class DashboardPreviewRequest(BaseModel):
    table_id: str | None = None
    filters: list[AnalyticsFilter] = Field(default_factory=list)


class AnalyticsFieldOut(BaseModel):
    id: str
    name: str
    field_type: str
    analytics_type: str
    position: int
    is_primary: bool
    supported_aggregations: list[str]
    supported_filter_ops: list[str]


class AnalyticsTableSchemaOut(BaseModel):
    table_id: str
    table_name: str
    total_records: int
    fields: list[AnalyticsFieldOut]
    default_metric_column_id: str | None = None
    default_group_by_column_id: str | None = None
    default_time_column_id: str | None = None


class AnalyticsPreviewOut(BaseModel):
    table_id: str
    table_name: str
    query: AnalyticsQueryRequest
    data: dict[str, Any]


class WidgetFilter(AnalyticsFilter):
    pass


class WidgetConfig(BaseModel):
    aggregation: str = "count"
    value_column_id: str | None = None
    group_by_column_id: str | None = None
    time_column_id: str | None = None
    time_granularity: str = "day"
    filters: list[WidgetFilter] = Field(default_factory=list)
    limit: int = 10
    selected_column_ids: list[str] = Field(default_factory=list)
    metrics: list[AnalyticsMetric] = Field(default_factory=list)
    sort_by: str = "metric"
    sort_direction: str = "desc"
    sort_metric_key: str | None = None

    @field_validator("aggregation", mode="before")
    @classmethod
    def _normalize_aggregation(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "count").lower()
        if normalized not in ALLOWED_AGGREGATIONS:
            raise ValueError(f"Некорректная агрегация: {normalized}")
        return normalized

    @field_validator("time_granularity", mode="before")
    @classmethod
    def _normalize_granularity(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "day").lower()
        if normalized not in ALLOWED_TIME_GRANULARITY:
            raise ValueError(f"Некорректная гранулярность: {normalized}")
        return normalized

    @field_validator("limit", mode="before")
    @classmethod
    def _normalize_limit(cls, value: int) -> int:
        parsed = int(value)
        if parsed < 1 or parsed > 500:
            raise ValueError("limit должен быть в диапазоне 1..500")
        return parsed

    @field_validator("sort_by", mode="before")
    @classmethod
    def _normalize_sort_by(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "metric").lower()
        if normalized not in ALLOWED_SORT_BY:
            raise ValueError(f"Некорректный тип сортировки: {normalized}")
        return normalized

    @field_validator("sort_direction", mode="before")
    @classmethod
    def _normalize_sort_direction(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "desc").lower()
        if normalized not in ALLOWED_SORT_DIRECTION:
            raise ValueError(f"Некорректное направление сортировки: {normalized}")
        return normalized


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
    widget_type: str = "metric"
    table_id: str | None = None
    config: WidgetConfig = Field(default_factory=WidgetConfig)
    position: int = 0

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value: str) -> str:
        normalized = _normalize_str(value)
        if not normalized:
            raise ValueError("Заголовок не может быть пустым")
        return normalized

    @field_validator("widget_type", mode="before")
    @classmethod
    def _normalize_widget_type(cls, value: str) -> str:
        normalized = (_normalize_str(value) or "metric").lower()
        if normalized not in ALLOWED_WIDGET_TYPES:
            raise ValueError(f"Некорректный тип виджета: {normalized}")
        return normalized


class WidgetUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    widget_type: str | None = None
    table_id: str | None = None
    config: WidgetConfig | None = None
    position: int | None = None

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = _normalize_str(value)
        if not normalized:
            raise ValueError("Заголовок не может быть пустым")
        return normalized

    @field_validator("widget_type", mode="before")
    @classmethod
    def _normalize_widget_type(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = _normalize_str(value)
        if not normalized or normalized not in ALLOWED_WIDGET_TYPES:
            raise ValueError(f"Некорректный тип виджета: {normalized}")
        return normalized


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
