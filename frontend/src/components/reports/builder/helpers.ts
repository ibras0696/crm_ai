import type {
  AnalyticsField,
  AnalyticsFilter,
  AnalyticsMetric,
  AnalyticsTableSchema,
  DashboardWidgetConfig,
} from '@/lib/api'
import { BarChart3, Donut, LayoutDashboard, LineChart, Table2, type LucideIcon } from 'lucide-react'
import { normalizeConfig } from '@/components/reports/WidgetEditor'

export type BuilderWidgetKind = 'metric' | 'bar' | 'line' | 'donut' | 'table'

export const BUILDER_WIDGETS: Array<{
  kind: BuilderWidgetKind
  title: string
  hint: string
  icon: LucideIcon
}> = [
  { kind: 'metric', title: 'KPI', hint: 'Одно главное число', icon: LayoutDashboard },
  { kind: 'bar', title: 'Сравнение', hint: 'Категории по объёму', icon: BarChart3 },
  { kind: 'line', title: 'Динамика', hint: 'Изменения во времени', icon: LineChart },
  { kind: 'donut', title: 'Структура', hint: 'Доли по категориям', icon: Donut },
  { kind: 'table', title: 'Таблица', hint: 'Список или сводка', icon: Table2 },
]

function makeMetric(
  key: string,
  aggregation: AnalyticsMetric['aggregation'],
  columnId: string | null,
  label: string,
): AnalyticsMetric {
  return {
    key,
    aggregation,
    column_id: columnId,
    label,
  }
}

export function buildDefaultWidgetConfig(
  kind: BuilderWidgetKind,
  schema: AnalyticsTableSchema | null,
): DashboardWidgetConfig {
  const metricColumnId = schema?.default_metric_column_id ?? null
  const groupColumnId = schema?.default_group_by_column_id ?? null
  const timeColumnId = schema?.default_time_column_id ?? null

  if (kind === 'metric') {
    return normalizeConfig({
      aggregation: metricColumnId ? 'sum' : 'count',
      value_column_id: metricColumnId,
      limit: 1,
      metrics: [makeMetric('value', metricColumnId ? 'sum' : 'count', metricColumnId, 'Значение')],
    })
  }

  if (kind === 'line') {
    return normalizeConfig({
      aggregation: metricColumnId ? 'sum' : 'count',
      value_column_id: metricColumnId,
      time_column_id: timeColumnId,
      time_granularity: 'month',
      limit: 12,
      metrics: [makeMetric('value', metricColumnId ? 'sum' : 'count', metricColumnId, metricColumnId ? 'Сумма' : 'Количество')],
      sort_by: 'label',
      sort_direction: 'asc',
    })
  }

  if (kind === 'bar') {
    return normalizeConfig({
      aggregation: metricColumnId ? 'sum' : 'count',
      value_column_id: metricColumnId,
      group_by_column_id: groupColumnId,
      limit: 8,
      metrics: [makeMetric('value', metricColumnId ? 'sum' : 'count', metricColumnId, metricColumnId ? 'Сумма' : 'Количество')],
      sort_by: 'metric',
      sort_direction: 'desc',
    })
  }

  if (kind === 'donut') {
    return normalizeConfig({
      aggregation: 'count',
      group_by_column_id: groupColumnId,
      limit: 8,
      metrics: [makeMetric('value', 'count', null, 'Количество')],
      sort_by: 'metric',
      sort_direction: 'desc',
    })
  }

  return normalizeConfig({
    aggregation: metricColumnId ? 'sum' : 'count',
    group_by_column_id: groupColumnId,
    limit: 10,
    selected_column_ids: schema?.fields.slice(0, 5).map((field) => field.id) ?? [],
    metrics: [makeMetric('value', metricColumnId ? 'sum' : 'count', metricColumnId, metricColumnId ? 'Сумма' : 'Количество')],
    sort_by: 'metric',
    sort_direction: 'desc',
  })
}

export function buildDefaultWidgetTitle(kind: BuilderWidgetKind, schema: AnalyticsTableSchema | null): string {
  const metricField = schema?.fields.find((field) => field.id === schema.default_metric_column_id)
  const groupField = schema?.fields.find((field) => field.id === schema.default_group_by_column_id)
  const dateField = schema?.fields.find((field) => field.id === schema.default_time_column_id)

  switch (kind) {
    case 'metric':
      return metricField ? `Итог по ${metricField.name}` : 'Всего записей'
    case 'bar':
      return groupField ? `Сравнение по ${groupField.name.toLowerCase()}` : 'Сравнение по категориям'
    case 'line':
      return dateField ? `Динамика по ${dateField.name.toLowerCase()}` : 'Динамика'
    case 'donut':
      return groupField ? `Структура по ${groupField.name.toLowerCase()}` : 'Структура'
    case 'table':
      return 'Таблица записей'
  }
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
  }
  return String(value)
}

export function defaultFilterForField(field: AnalyticsField): AnalyticsFilter {
  if (field.analytics_type === 'boolean') {
    return { column_id: field.id, op: 'eq', value: 'true' }
  }
  if (field.analytics_type === 'date') {
    return { column_id: field.id, op: 'between', from_value: '', to_value: '' }
  }
  return { column_id: field.id, op: 'eq', value: '' }
}
