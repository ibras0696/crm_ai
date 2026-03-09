import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface TableSummary {
  id: string
  name: string
  records_count: number
  columns_count: number
}

export interface OrgReport {
  tables_count: number
  records_count: number
  columns_count: number
  tables: TableSummary[]
}

export interface ColumnAggResult {
  column_id: string
  column_name: string
  field_type: string
  count: number
  non_empty: number
  sum: number | null
  avg: number | null
  min_val: string | null
  max_val: string | null
  top_values: Array<{ value: string; count: number }> | null
}

export interface TableAggResponse {
  table_id: string
  table_name: string
  total_records: number
  columns: ColumnAggResult[]
}

export interface TimeSeriesPoint {
  date: string
  count: number
}

export interface AnalyticsMetric {
  key: string
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  column_id: string | null
  label: string | null
}

export interface AnalyticsFilter {
  column_id: string
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in' | 'is_empty' | 'not_empty' | 'between'
  value?: string | number | boolean | null
  values?: Array<string | number | boolean>
  from_value?: string | number | null
  to_value?: string | number | null
}

export type DashboardFilter = AnalyticsFilter

export interface AnalyticsSort {
  by: 'label' | 'metric'
  metric_key?: string | null
  direction: 'asc' | 'desc'
}

export interface AnalyticsField {
  id: string
  name: string
  field_type: string
  analytics_type: 'number' | 'date' | 'list' | 'boolean' | 'text'
  position: number
  is_primary: boolean
  supported_aggregations: Array<'count' | 'sum' | 'avg' | 'min' | 'max'>
  supported_filter_ops: AnalyticsFilter['op'][]
}

export interface AnalyticsTableSchema {
  table_id: string
  table_name: string
  total_records: number
  fields: AnalyticsField[]
  default_metric_column_id: string | null
  default_group_by_column_id: string | null
  default_time_column_id: string | null
}

export interface AnalyticsQueryRequest {
  table_id: string
  widget_type: 'metric' | 'bar' | 'line' | 'donut' | 'table' | 'pie' | 'area'
  title?: string | null
  metrics: AnalyticsMetric[]
  group_by_column_id?: string | null
  time_column_id?: string | null
  date_bucket?: 'day' | 'week' | 'month'
  filters?: AnalyticsFilter[]
  sort?: AnalyticsSort | null
  limit?: number
  selected_column_ids?: string[]
}

export interface AnalyticsPreviewResponse {
  table_id: string
  table_name: string
  query: AnalyticsQueryRequest
  data: Record<string, unknown>
}

export interface DashboardInfo {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface DashboardWidgetConfig {
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  value_column_id: string | null
  group_by_column_id: string | null
  time_column_id: string | null
  time_granularity: 'day' | 'week' | 'month'
  filters: AnalyticsFilter[]
  limit: number
  selected_column_ids: string[]
  metrics?: AnalyticsMetric[]
  sort_by?: 'label' | 'metric'
  sort_direction?: 'asc' | 'desc'
  sort_metric_key?: string | null
}

export interface DashboardWidget {
  id: string
  title: string
  widget_type: 'metric' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'table'
  table_id: string | null
  config: DashboardWidgetConfig
  position: number
  created_at: string
}

export interface DashboardDetail {
  id: string
  name: string
  description: string | null
  widgets: DashboardWidget[]
}

export interface DashboardDataItem {
  widget: DashboardWidget
  data: Record<string, unknown>
}

export interface DashboardDataResponse {
  dashboard: DashboardDetail
  items: DashboardDataItem[]
}

export const reportsApi = {
  summary: () => api.get<ApiResponse<OrgReport>>('/reports/summary'),
  tableAnalytics: (table_id: string, column_ids: string[] = []) => api.post<ApiResponse<TableAggResponse>>('/reports/table-analytics', { table_id, column_ids }),
  tableSchema: (tableId: string) => api.get<ApiResponse<AnalyticsTableSchema>>(`/reports/tables/${tableId}/schema`),
  queryPreview: (data: AnalyticsQueryRequest) => api.post<ApiResponse<AnalyticsPreviewResponse>>('/reports/query-preview', data),
  timeline: (days = 30) => api.get<ApiResponse<TimeSeriesPoint[]>>(`/reports/timeline?days=${days}`),
  listDashboards: () => api.get<ApiResponse<DashboardInfo[]>>('/reports/dashboards'),
  createDashboard: (data: { name: string; description?: string }) => api.post<ApiResponse<DashboardInfo>>('/reports/dashboards', data),
  updateDashboard: (id: string, data: { name?: string; description?: string }) => api.patch<ApiResponse<DashboardInfo>>(`/reports/dashboards/${id}`, data),
  deleteDashboard: (id: string) => api.delete<ApiResponse<null>>(`/reports/dashboards/${id}`),
  getDashboard: (id: string) => api.get<ApiResponse<DashboardDetail>>(`/reports/dashboards/${id}`),
  getDashboardData: (id: string) => api.get<ApiResponse<DashboardDataResponse>>(`/reports/dashboards/${id}/data`),
  previewDashboard: (id: string, data: { table_id?: string | null; filters?: AnalyticsFilter[] }) =>
    api.post<ApiResponse<DashboardDataResponse>>(`/reports/dashboards/${id}/preview`, data),
  createWidget: (
    dashboardId: string,
    data: { title: string; widget_type: string; table_id?: string | null; config?: Partial<DashboardWidgetConfig>; position?: number },
  ) => api.post<ApiResponse<DashboardWidget>>(`/reports/dashboards/${dashboardId}/widgets`, data),
  updateWidget: (
    dashboardId: string,
    widgetId: string,
    data: { title?: string; widget_type?: string; table_id?: string | null; config?: Partial<DashboardWidgetConfig>; position?: number },
  ) => api.patch<ApiResponse<DashboardWidget>>(`/reports/dashboards/${dashboardId}/widgets/${widgetId}`, data),
  deleteWidget: (dashboardId: string, widgetId: string) => api.delete<ApiResponse<null>>(`/reports/dashboards/${dashboardId}/widgets/${widgetId}`),
}
