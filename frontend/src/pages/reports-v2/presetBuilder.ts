import type { AnalyticsFilter, AnalyticsQueryRequest, AnalyticsSemanticSchema } from '@/lib/api'

export type DashboardPreset = 'executive' | 'revenue' | 'ops' | 'funnel' | 'marketing'

export interface WidgetPlan {
  id: string
  title: string
  widget_type: AnalyticsQueryRequest['widget_type']
  span: 'half' | 'full'
  query: AnalyticsQueryRequest
}

interface BuildPresetInput {
  tableId: string
  schema: AnalyticsSemanticSchema
  preset: DashboardPreset
  filters: AnalyticsFilter[]
}

function metric(key: string, aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max', column_id: string | null, label: string) {
  return [{ key, aggregation, column_id, label }]
}

function makeQuery(
  tableId: string,
  widgetType: AnalyticsQueryRequest['widget_type'],
  title: string,
  filters: AnalyticsFilter[],
  overrides: Partial<AnalyticsQueryRequest>,
): AnalyticsQueryRequest {
  return {
    table_id: tableId,
    widget_type: widgetType,
    title,
    metrics: metric('total', 'count', null, 'Количество'),
    filters,
    limit: 12,
    ...overrides,
  }
}

function firstExisting(ids: Array<string | null | undefined>): string | null {
  for (const id of ids) {
    if (id) return id
  }
  return null
}

export function buildWidgetPlans({ tableId, schema, preset, filters }: BuildPresetInput): WidgetPlan[] {
  const defaultMeasure = firstExisting([schema.default_metric_column_id, schema.measures[0]])
  const defaultDimension = firstExisting([schema.default_group_by_column_id, schema.dimensions[0]])
  const defaultTime = firstExisting([schema.default_time_column_id, schema.time_dimensions[0]])

  const plans: WidgetPlan[] = []

  plans.push({
    id: 'kpi-records',
    title: 'Всего записей',
    widget_type: 'metric',
    span: 'half',
    query: makeQuery(tableId, 'metric', 'Всего записей', filters, {
      metrics: metric('total_records', 'count', null, 'Записи'),
    }),
  })

  if (defaultMeasure) {
    plans.push({
      id: 'kpi-measure',
      title: 'Ключевая сумма',
      widget_type: 'metric',
      span: 'half',
      query: makeQuery(tableId, 'metric', 'Ключевая сумма', filters, {
        metrics: metric('sum_value', 'sum', defaultMeasure, 'Сумма'),
      }),
    })
  }

  const barTitle = preset === 'marketing' ? 'Каналы' : preset === 'funnel' ? 'Этапы воронки' : 'Разрез по категориям'
  if (defaultDimension) {
    plans.push({
      id: 'bar-dimension',
      title: barTitle,
      widget_type: 'bar',
      span: 'half',
      query: makeQuery(tableId, 'bar', barTitle, filters, {
        metrics: metric(
          'sum_value',
          defaultMeasure ? 'sum' : 'count',
          defaultMeasure,
          defaultMeasure ? 'Сумма' : 'Количество',
        ),
        group_by_column_id: defaultDimension,
        sort: { by: 'metric', metric_key: 'sum_value', direction: 'desc' },
        limit: preset === 'funnel' ? 6 : 10,
      }),
    })

    plans.push({
      id: 'pie-share',
      title: 'Доля сегментов',
      widget_type: preset === 'marketing' ? 'donut' : 'pie',
      span: 'half',
      query: makeQuery(tableId, preset === 'marketing' ? 'donut' : 'pie', 'Доля сегментов', filters, {
        metrics: metric(
          'segment_value',
          defaultMeasure ? 'sum' : 'count',
          defaultMeasure,
          defaultMeasure ? 'Сумма' : 'Количество',
        ),
        group_by_column_id: defaultDimension,
        sort: { by: 'metric', metric_key: 'segment_value', direction: 'desc' },
        limit: 8,
      }),
    })
  }

  if (defaultTime) {
    const trendType: AnalyticsQueryRequest['widget_type'] = preset === 'ops' ? 'area' : 'line'
    plans.push({
      id: 'trend-time',
      title: 'Динамика',
      widget_type: trendType,
      span: 'full',
      query: makeQuery(tableId, trendType, 'Динамика', filters, {
        metrics: metric(
          'trend_value',
          defaultMeasure ? 'sum' : 'count',
          defaultMeasure,
          defaultMeasure ? 'Сумма' : 'Количество',
        ),
        time_column_id: defaultTime,
        date_bucket: preset === 'executive' ? 'month' : 'week',
        sort: { by: 'label', direction: 'asc' },
        limit: 24,
      }),
    })
  }

  const selectedColumns = schema.fields.slice(0, 7).map((field) => field.id)
  plans.push({
    id: 'table-details',
    title: 'Детализация',
    widget_type: 'table',
    span: 'full',
    query: makeQuery(tableId, 'table', 'Детализация', filters, {
      selected_column_ids: selectedColumns,
      limit: 25,
    }),
  })

  return plans
}
