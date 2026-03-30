"""Service layer for reports dashboards."""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from src.modules.reports.analytics_engine import (
    analytics_type_for_field,
    build_table_schema,
    build_widget_data,
    execute_query,
    load_records_map,
    load_tables_map,
    parse_float,
    widget_to_out,
)
from src.modules.reports.models import ReportDashboard, ReportWidget
from src.modules.reports.repository import ReportsRepository
from src.modules.reports.schemas import (
    AnalyticsFieldOut,
    AnalyticsFilter,
    AnalyticsPreviewOut,
    AnalyticsQueryRequest,
    ColumnAggRequest,
    ColumnAggResult,
    DashboardCreateRequest,
    DashboardDataOut,
    DashboardDetailOut,
    DashboardOut,
    DashboardPreviewRequest,
    DashboardUpdateRequest,
    OrgReport,
    TableAggResponse,
    TableSummary,
    TimeSeriesPoint,
    WidgetDataOut,
    WidgetOut,
    WidgetUpdateRequest,
)
from src.modules.reports.schemas_v2 import (
    SEMANTIC_ROLE_DIMENSION,
    SEMANTIC_ROLE_IDENTIFIER,
    SEMANTIC_ROLE_MEASURE,
    SEMANTIC_ROLE_TIME,
    AnalyticsSemanticSchemaOut,
    SemanticFieldOut,
    UnifiedPreviewOut,
    UnifiedPreviewRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class ReportsService:
    """Application service for reports module."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ReportsRepository(session)

    async def org_summary(self, *, org_id: uuid.UUID) -> OrgReport:
        tables = await self.repo.list_org_tables_with_columns(org_id)
        table_ids = [table.id for table in tables]
        counts = await self.repo.count_records_by_table_ids(table_ids)

        summaries: list[TableSummary] = []
        total_records = 0
        total_columns = 0
        for table in tables:
            cnt = counts.get(table.id, 0)
            total_records += cnt
            col_cnt = len(table.columns)
            total_columns += col_cnt
            summaries.append(
                TableSummary(
                    id=str(table.id),
                    name=table.name,
                    records_count=cnt,
                    columns_count=col_cnt,
                ),
            )
        return OrgReport(
            tables_count=len(tables),
            records_count=total_records,
            columns_count=total_columns,
            tables=summaries,
        )

    async def table_analytics(self, *, org_id: uuid.UUID, body: ColumnAggRequest) -> TableAggResponse | None:
        try:
            table_uuid = uuid.UUID(body.table_id)
        except ValueError:
            return None
        table = await self.repo.get_table_with_columns(org_id, table_uuid)
        if not table:
            return None

        records = await self.repo.list_records_by_table(table.id)
        target_cols = table.columns
        if body.column_ids:
            col_set = set(body.column_ids)
            target_cols = [column for column in table.columns if str(column.id) in col_set]

        col_results: list[ColumnAggResult] = []
        for col in target_cols:
            cid = str(col.id)
            values = [
                rec.data.get(cid)
                for rec in records
                if rec.data.get(cid) is not None and str(rec.data.get(cid)).strip() != ""
            ]
            non_empty = len(values)
            agg = ColumnAggResult(
                column_id=cid,
                column_name=col.name,
                field_type=col.field_type,
                count=len(records),
                non_empty=non_empty,
            )

            if analytics_type_for_field(col.field_type) == "number":
                nums: list[float] = []
                for val in values:
                    num = parse_float(val)
                    if num is not None:
                        nums.append(num)
                if nums:
                    agg.sum = round(sum(nums), 4)
                    agg.avg = round(sum(nums) / len(nums), 4)
                    agg.min_val = str(min(nums))
                    agg.max_val = str(max(nums))
            else:
                if values:
                    str_vals = [str(v) for v in values]
                    agg.min_val = min(str_vals)
                    agg.max_val = max(str_vals)

            freq = Counter(str(v) for v in values)
            agg.top_values = [{"value": key, "count": count} for key, count in freq.most_common(10)]
            col_results.append(agg)

        return TableAggResponse(
            table_id=str(table.id),
            table_name=table.name,
            total_records=len(records),
            columns=col_results,
        )

    async def table_schema(self, *, org_id: uuid.UUID, table_id: uuid.UUID):
        table = await self.repo.get_table_with_columns(org_id, table_id)
        if not table:
            return None
        counts = await self.repo.count_records_by_table_ids([table.id])
        return build_table_schema(table, counts.get(table.id, 0))

    async def semantic_schema(
        self,
        *,
        org_id: uuid.UUID,
        table_id: uuid.UUID,
    ) -> AnalyticsSemanticSchemaOut | None:
        schema = await self.table_schema(org_id=org_id, table_id=table_id)
        if schema is None:
            return None

        dimensions: list[str] = []
        measures: list[str] = []
        time_dimensions: list[str] = []
        semantic_fields: list[SemanticFieldOut] = []

        for field in schema.fields:
            role = self._semantic_role(field)
            if role == SEMANTIC_ROLE_MEASURE:
                measures.append(field.id)
            elif role == SEMANTIC_ROLE_TIME:
                time_dimensions.append(field.id)
            else:
                dimensions.append(field.id)

            semantic_fields.append(
                SemanticFieldOut(
                    id=field.id,
                    name=field.name,
                    field_type=field.field_type,
                    analytics_type=field.analytics_type,
                    semantic_role=role,
                    position=field.position,
                    is_primary=field.is_primary,
                    supported_aggregations=field.supported_aggregations,
                    supported_filter_ops=field.supported_filter_ops,
                ),
            )

        supported_widget_types = ["metric", "table"]
        if dimensions:
            supported_widget_types.extend(["bar", "pie", "donut"])
        if time_dimensions:
            supported_widget_types.extend(["line", "area"])

        return AnalyticsSemanticSchemaOut(
            table_id=schema.table_id,
            table_name=schema.table_name,
            total_records=schema.total_records,
            fields=semantic_fields,
            dimensions=dimensions,
            measures=measures,
            time_dimensions=time_dimensions,
            default_metric_column_id=schema.default_metric_column_id,
            default_group_by_column_id=schema.default_group_by_column_id,
            default_time_column_id=schema.default_time_column_id,
            supported_widget_types=list(dict.fromkeys(supported_widget_types)),
            planned_widget_types=["funnel", "cohort", "heatmap"],
        )

    async def query_preview(self, *, org_id: uuid.UUID, body) -> AnalyticsPreviewOut | None:
        table, data = await execute_query(self.repo, org_id, body)
        if table is None:
            return None
        return AnalyticsPreviewOut(
            table_id=str(table.id),
            table_name=table.name,
            query=body,
            data=data,
        )

    async def unified_preview(
        self,
        *,
        org_id: uuid.UUID,
        body: UnifiedPreviewRequest,
    ) -> UnifiedPreviewOut | None:
        if body.mode == "query":
            if body.query is None:
                return None
            parsed_query = AnalyticsQueryRequest.model_validate(body.query)
            preview = await self.query_preview(org_id=org_id, body=parsed_query)
            if preview is None:
                return None
            return UnifiedPreviewOut(
                mode="query",
                query=preview.model_dump(mode="json"),
            )

        if body.dashboard is None:
            return None
        try:
            dashboard_uuid = uuid.UUID(body.dashboard.dashboard_id)
        except ValueError:
            return None
        preview = await self.dashboard_preview(
            org_id=org_id,
            dashboard_id=dashboard_uuid,
            body=DashboardPreviewRequest(
                table_id=body.dashboard.table_id,
                filters=[AnalyticsFilter.model_validate(item) for item in body.dashboard.filters],
            ),
        )
        if preview is None:
            return None
        return UnifiedPreviewOut(mode="dashboard", dashboard=preview.model_dump(mode="json"))

    async def records_timeline(self, *, org_id: uuid.UUID, days: int) -> list[TimeSeriesPoint]:
        cutoff = datetime.now(UTC) - timedelta(days=days)
        rows = await self.repo.records_timeline(org_id, cutoff)
        return [TimeSeriesPoint(date=str(day.date()), count=count) for day, count in rows]

    async def list_dashboards(self, *, org_id: uuid.UUID) -> list[DashboardOut]:
        rows = await self.repo.list_dashboards(org_id)
        return [
            DashboardOut(
                id=str(dash.id),
                name=dash.name,
                description=dash.description,
                created_at=dash.created_at,
            )
            for dash in rows
        ]

    async def create_dashboard(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        body: DashboardCreateRequest,
    ) -> DashboardOut:
        dash = ReportDashboard(
            org_id=org_id,
            created_by=user_id,
            name=body.name.strip(),
            description=body.description,
        )
        dash = await self.repo.create_dashboard(dash)
        return DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)

    async def update_dashboard(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        body: DashboardUpdateRequest,
    ) -> DashboardOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return None
        if body.name is not None:
            dash.name = body.name.strip()
        if body.description is not None:
            dash.description = body.description
        await self.session.flush()
        return DashboardOut(id=str(dash.id), name=dash.name, description=dash.description, created_at=dash.created_at)

    async def delete_dashboard(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> bool:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return False
        await self.repo.delete_dashboard(dash)
        return True

    async def get_dashboard(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> DashboardDetailOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id, with_widgets=True)
        if not dash:
            return None
        widgets = [widget_to_out(widget) for widget in sorted(dash.widgets, key=lambda item: item.position)]
        return DashboardDetailOut(id=str(dash.id), name=dash.name, description=dash.description, widgets=widgets)

    async def create_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        body,
    ) -> WidgetOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id)
        if not dash:
            return None
        table_uuid = uuid.UUID(body.table_id) if body.table_id else None
        widget = ReportWidget(
            dashboard_id=dashboard_id,
            org_id=org_id,
            title=body.title,
            widget_type=body.widget_type,
            table_id=table_uuid,
            config=body.config.model_dump(),
            position=body.position,
        )
        widget = await self.repo.create_widget(widget)
        return widget_to_out(widget)

    async def update_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        widget_id: uuid.UUID,
        body: WidgetUpdateRequest,
    ) -> WidgetOut | None:
        widget = await self.repo.get_widget_for_dashboard_org(
            widget_id=widget_id,
            dashboard_id=dashboard_id,
            org_id=org_id,
        )
        if not widget:
            return None
        if body.title is not None:
            widget.title = body.title
        if body.widget_type is not None:
            widget.widget_type = body.widget_type
        if body.table_id is not None:
            widget.table_id = uuid.UUID(body.table_id) if body.table_id else None
        if body.config is not None:
            widget.config = body.config.model_dump()
        if body.position is not None:
            widget.position = body.position
        await self.session.flush()
        return widget_to_out(widget)

    async def delete_widget(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        widget_id: uuid.UUID,
    ) -> bool:
        widget = await self.repo.get_widget_for_dashboard_org(
            widget_id=widget_id,
            dashboard_id=dashboard_id,
            org_id=org_id,
        )
        if not widget:
            return False
        await self.repo.delete_widget(widget)
        return True

    async def dashboard_data(self, *, org_id: uuid.UUID, dashboard_id: uuid.UUID) -> DashboardDataOut | None:
        return await self.dashboard_preview(org_id=org_id, dashboard_id=dashboard_id, body=DashboardPreviewRequest())

    async def dashboard_preview(
        self,
        *,
        org_id: uuid.UUID,
        dashboard_id: uuid.UUID,
        body: DashboardPreviewRequest,
    ) -> DashboardDataOut | None:
        dash = await self.repo.get_dashboard_for_org(dashboard_id=dashboard_id, org_id=org_id, with_widgets=True)
        if not dash:
            return None
        ordered_widgets = sorted(dash.widgets, key=lambda item: item.position)
        table_ids = [widget.table_id for widget in ordered_widgets if widget.table_id is not None]
        unique_table_ids = list(dict.fromkeys(table_ids))
        tables_map = await load_tables_map(self.repo, org_id=org_id, table_ids=unique_table_ids)
        records_map = await load_records_map(self.repo, table_ids=unique_table_ids)
        items: list[WidgetDataOut] = []
        for widget in ordered_widgets:
            scoped_filters = body.filters
            if body.table_id and widget.table_id and str(widget.table_id) != body.table_id:
                scoped_filters = []
            data = await build_widget_data(
                self.repo,
                org_id,
                widget,
                tables_map=tables_map,
                records_map=records_map,
                extra_filters=scoped_filters,
            )
            items.append(WidgetDataOut(widget=widget_to_out(widget), data=data))

        detail = DashboardDetailOut(
            id=str(dash.id),
            name=dash.name,
            description=dash.description,
            widgets=[widget_to_out(widget) for widget in ordered_widgets],
        )
        return DashboardDataOut(dashboard=detail, items=items)

    @staticmethod
    def _semantic_role(field: AnalyticsFieldOut) -> str:
        if field.analytics_type == "number":
            return SEMANTIC_ROLE_MEASURE
        if field.analytics_type == "date":
            return SEMANTIC_ROLE_TIME
        if field.is_primary:
            return SEMANTIC_ROLE_IDENTIFIER
        return SEMANTIC_ROLE_DIMENSION
