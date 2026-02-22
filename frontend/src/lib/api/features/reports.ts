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

export interface DashboardInfo {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface DashboardFilter {
  column_id: string
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte'
  value: string | number | boolean
}

export interface DashboardWidgetConfig {
  aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  value_column_id: string | null
  group_by_column_id: string | null
  time_column_id: string | null
  time_granularity: 'day' | 'week' | 'month'
  filters: DashboardFilter[]
  limit: number
  selected_column_ids: string[]
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
  timeline: (days = 30) => api.get<ApiResponse<TimeSeriesPoint[]>>(`/reports/timeline?days=${days}`),
  listDashboards: () => api.get<ApiResponse<DashboardInfo[]>>('/reports/dashboards'),
  createDashboard: (data: { name: string; description?: string }) => api.post<ApiResponse<DashboardInfo>>('/reports/dashboards', data),
  updateDashboard: (id: string, data: { name?: string; description?: string }) => api.patch<ApiResponse<DashboardInfo>>(`/reports/dashboards/${id}`, data),
  deleteDashboard: (id: string) => api.delete<ApiResponse<null>>(`/reports/dashboards/${id}`),
  getDashboard: (id: string) => api.get<ApiResponse<DashboardDetail>>(`/reports/dashboards/${id}`),
  getDashboardData: (id: string) => api.get<ApiResponse<DashboardDataResponse>>(`/reports/dashboards/${id}/data`),
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
