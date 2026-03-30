"""Versioned V2 schemas for universal analytics contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

SEMANTIC_ROLE_IDENTIFIER = "identifier"
SEMANTIC_ROLE_DIMENSION = "dimension"
SEMANTIC_ROLE_MEASURE = "measure"
SEMANTIC_ROLE_TIME = "time"


class SemanticFieldOut(BaseModel):
    id: str
    name: str
    field_type: str
    analytics_type: str
    semantic_role: Literal["identifier", "dimension", "measure", "time"]
    position: int
    is_primary: bool
    supported_aggregations: list[str]
    supported_filter_ops: list[str]


class AnalyticsSemanticSchemaOut(BaseModel):
    contract_version: str = "2.0"
    table_id: str
    table_name: str
    total_records: int
    fields: list[SemanticFieldOut]
    dimensions: list[str] = Field(default_factory=list)
    measures: list[str] = Field(default_factory=list)
    time_dimensions: list[str] = Field(default_factory=list)
    default_metric_column_id: str | None = None
    default_group_by_column_id: str | None = None
    default_time_column_id: str | None = None
    supported_widget_types: list[str] = Field(default_factory=list)
    planned_widget_types: list[str] = Field(default_factory=list)


class UnifiedDashboardPreviewRequest(BaseModel):
    dashboard_id: str
    table_id: str | None = None
    filters: list[dict] = Field(default_factory=list)


class UnifiedPreviewRequest(BaseModel):
    mode: Literal["query", "dashboard"]
    query: dict | None = None
    dashboard: UnifiedDashboardPreviewRequest | None = None

    @model_validator(mode="after")
    def _validate_payload(self) -> UnifiedPreviewRequest:
        if self.mode == "query" and self.query is None:
            raise ValueError("Для mode=query необходимо поле query")
        if self.mode == "dashboard" and self.dashboard is None:
            raise ValueError("Для mode=dashboard необходимо поле dashboard")
        return self


class UnifiedPreviewOut(BaseModel):
    mode: Literal["query", "dashboard"]
    query: dict | None = None
    dashboard: dict | None = None
