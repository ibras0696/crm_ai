import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Loader2, Sparkles, WandSparkles } from 'lucide-react'

import {
  reportsApi,
  tablesApi,
  type AnalyticsFilter,
  type AnalyticsTableSchema,
  type DashboardDataItem,
  type DashboardDataResponse,
  type DashboardInfo,
  type DashboardWidget,
  type TableInfo,
} from '@/lib/api'
import ChartCard from '@/components/reports/ChartCard'
import DashboardCanvas from '@/components/reports/builder/DashboardCanvas'
import FiltersSidebar from '@/components/reports/builder/FiltersSidebar'
import InspectorPanel from '@/components/reports/builder/InspectorPanel'
import WorkspaceToolbar from '@/components/reports/builder/WorkspaceToolbar'
import {
  BUILDER_WIDGETS,
  buildDefaultWidgetConfig,
  buildDefaultWidgetTitle,
  formatValue,
  type BuilderWidgetKind,
} from '@/components/reports/builder/helpers'
import { normalizeConfig } from '@/components/reports/WidgetEditor'

const REPORTS_SHELL = 'rounded-[28px] border border-[#19355e] bg-[#060f22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]'
const REPORTS_CARD = 'rounded-2xl border border-[#1e3f69] bg-[#0a1e39]'
const REPORTS_MUTED_TEXT = 'text-[#8ea8cf]'

type ReportsViewMode = 'dashboard' | 'builder'
type ReportsPeriod = 'today' | '7d' | '30d'

function toChartPoints(item: DashboardDataItem | null): Array<{ x: string; y: number }> {
  if (!item) return []
  const rawPoints = item.data.points
  if (!Array.isArray(rawPoints)) return []

  return rawPoints
    .map((point) => {
      if (!point || typeof point !== 'object') return null
      const xRaw = (point as Record<string, unknown>).x
      const yRaw = (point as Record<string, unknown>).y
      const x = typeof xRaw === 'string' || typeof xRaw === 'number' ? String(xRaw) : ''
      const y = typeof yRaw === 'number' ? yRaw : Number(yRaw)
      if (!x || !Number.isFinite(y)) return null
      return { x, y }
    })
    .filter((point): point is { x: string; y: number } => Boolean(point))
}

function toTableShape(item: DashboardDataItem | null): { header: string[]; rows: string[][] } {
  if (!item) return { header: [], rows: [] }

  const data = item.data as Record<string, unknown>
  const header = Array.isArray(data.header)
    ? data.header.map((cell) => String(cell ?? '')).filter(Boolean)
    : []

  const rows = Array.isArray(data.rows)
    ? data.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '—')) : [])).filter((row) => row.length > 0)
    : []

  return { header, rows }
}

function toMetricValue(item: DashboardDataItem): string {
  const data = item.data as Record<string, unknown>
  if (data.value !== undefined && data.value !== null) return formatValue(data.value)

  const metrics = data.metrics
  if (metrics && typeof metrics === 'object') {
    const firstMetric = Object.values(metrics as Record<string, unknown>)[0]
    if (firstMetric !== undefined) return formatValue(firstMetric)
  }

  if (data.total !== undefined && data.total !== null) return formatValue(data.total)
  if (data.total_records !== undefined && data.total_records !== null) return formatValue(data.total_records)
  return '—'
}

function toMetricHint(item: DashboardDataItem): string {
  const data = item.data as Record<string, unknown>
  const totalRecords = data.total_records
  if (typeof totalRecords === 'number' && Number.isFinite(totalRecords)) {
    return `${formatValue(totalRecords)} записей после фильтра`
  }
  return 'Актуально для текущих фильтров'
}

export default function ReportsPage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [dashboards, setDashboards] = useState<DashboardInfo[]>([])
  const [selectedTableId, setSelectedTableId] = useState('')
  const [selectedDashboardId, setSelectedDashboardId] = useState('')
  const [tableSchema, setTableSchema] = useState<AnalyticsTableSchema | null>(null)
  const [dashboardData, setDashboardData] = useState<DashboardDataResponse | null>(null)
  const [selectedWidgetId, setSelectedWidgetId] = useState('')
  const [globalFilters, setGlobalFilters] = useState<AnalyticsFilter[]>([])
  const [newDashboardName, setNewDashboardName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ReportsViewMode>('dashboard')
  const [period, setPeriod] = useState<ReportsPeriod>('30d')

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? null,
    [tables, selectedTableId],
  )

  const selectedWidget = useMemo(
    () => dashboardData?.dashboard.widgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [dashboardData, selectedWidgetId],
  )

  const showInspector = Boolean(selectedWidget)

  const metricItems = useMemo(
    () => (dashboardData?.items ?? []).filter((item) => item.widget.widget_type === 'metric'),
    [dashboardData],
  )

  const chartItems = useMemo(
    () => (dashboardData?.items ?? []).filter((item) => item.widget.widget_type !== 'metric'),
    [dashboardData],
  )

  const primaryChartItem = useMemo(
    () => chartItems.find((item) => ['line', 'area', 'bar'].includes(item.widget.widget_type)) ?? chartItems[0] ?? null,
    [chartItems],
  )

  const secondaryChartItem = useMemo(
    () => chartItems.find((item) => item.widget.id !== primaryChartItem?.widget.id) ?? null,
    [chartItems, primaryChartItem],
  )

  const tableWidgetItem = useMemo(
    () => chartItems.find((item) => item.widget.widget_type === 'table') ?? null,
    [chartItems],
  )

  const insights = useMemo(
    () => [
      { label: 'Активные фильтры', value: String(globalFilters.length) },
      { label: 'Виджеты в дашборде', value: String(dashboardData?.dashboard.widgets.length ?? 0) },
      { label: 'Записей в таблице', value: formatValue(tableSchema?.total_records ?? 0) },
      { label: 'Выбранная таблица', value: selectedTable?.name ?? 'Не выбрана' },
      { label: 'Период', value: period === 'today' ? 'Сегодня' : period === '7d' ? '7 дней' : '30 дней' },
      { label: 'Режим', value: viewMode === 'dashboard' ? 'Дашборд' : 'Конструктор' },
    ],
    [globalFilters.length, dashboardData?.dashboard.widgets.length, tableSchema?.total_records, selectedTable?.name, period, viewMode],
  )

  const topChartPoints = useMemo(
    () => toChartPoints(secondaryChartItem ?? primaryChartItem).slice(0, 5),
    [primaryChartItem, secondaryChartItem],
  )

  const funnelPoints = useMemo(
    () => toChartPoints(primaryChartItem).slice(0, 5),
    [primaryChartItem],
  )

  const tableShape = useMemo(
    () => toTableShape(tableWidgetItem),
    [tableWidgetItem],
  )

  async function loadTablesAndDashboards() {
    setLoading(true)
    setError(null)
    try {
      const [tablesResp, dashboardsResp] = await Promise.all([
        tablesApi.list(),
        reportsApi.listDashboards(),
      ])
      const nextTables = tablesResp.data.data ?? []
      const nextDashboards = dashboardsResp.data.data ?? []
      setTables(nextTables)
      setDashboards(nextDashboards)
      setSelectedTableId((current) => current || nextTables[0]?.id || '')
      setSelectedDashboardId((current) => current || nextDashboards[0]?.id || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аналитику.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTablesAndDashboards()
  }, [])

  useEffect(() => {
    if (!selectedTableId) {
      setTableSchema(null)
      setGlobalFilters([])
      return
    }

    let active = true
    void reportsApi.tableSchema(selectedTableId)
      .then((response) => {
        if (!active) return
        setTableSchema(response.data.data ?? null)
        setGlobalFilters([])
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить схему таблицы.')
      })

    return () => {
      active = false
    }
  }, [selectedTableId])

  async function loadDashboardPreview(dashboardId = selectedDashboardId, filters = globalFilters) {
    if (!dashboardId) {
      setDashboardData(null)
      setSelectedWidgetId('')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const response = await reportsApi.previewDashboard(dashboardId, {
        table_id: selectedTableId || null,
        filters,
      })
      const nextData = response.data.data ?? null
      setDashboardData(nextData)
      setSelectedWidgetId((current) => {
        if (!nextData) return ''
        if (current && nextData.dashboard.widgets.some((widget) => widget.id === current)) {
          return current
        }
        return nextData.dashboard.widgets[0]?.id ?? ''
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось пересчитать дашборд.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadDashboardPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDashboardId, selectedTableId, JSON.stringify(globalFilters), period])

  async function createStarterDashboard(dashboardId: string, tableId: string, schema: AnalyticsTableSchema | null) {
    const starterKinds: BuilderWidgetKind[] = ['metric', 'bar']
    if (schema?.default_time_column_id) starterKinds.push('line')
    starterKinds.push('table')

    let position = 0
    for (const kind of starterKinds) {
      await reportsApi.createWidget(dashboardId, {
        title: buildDefaultWidgetTitle(kind, schema),
        widget_type: kind,
        table_id: tableId,
        position,
        config: buildDefaultWidgetConfig(kind, schema),
      })
      position += 1
    }
  }

  async function handleCreateDashboard() {
    const name = newDashboardName.trim() || 'Новый дашборд'
    setBusy(true)
    setError(null)
    try {
      const created = await reportsApi.createDashboard({
        name,
        description: selectedTableId ? 'BI-дэшборд по таблице' : undefined,
      })
      const dashboard = created.data.data
      if (!dashboard) return

      if (selectedTableId) {
        await createStarterDashboard(dashboard.id, selectedTableId, tableSchema)
      }

      setDashboards((prev) => [dashboard, ...prev])
      setSelectedDashboardId(dashboard.id)
      setNewDashboardName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать дашборд.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddWidget(kind: BuilderWidgetKind) {
    if (!selectedDashboardId || !selectedTableId) {
      setError('Сначала выберите дашборд и таблицу.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const created = await reportsApi.createWidget(selectedDashboardId, {
        title: buildDefaultWidgetTitle(kind, tableSchema),
        widget_type: kind,
        table_id: selectedTableId,
        position: dashboardData?.dashboard.widgets.length ?? 0,
        config: buildDefaultWidgetConfig(kind, tableSchema),
      })
      await loadDashboardPreview(selectedDashboardId)
      if (created.data.data) setSelectedWidgetId(created.data.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить виджет.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSaveWidget(next: DashboardWidget) {
    if (!selectedDashboardId) return

    setBusy(true)
    setError(null)
    try {
      await reportsApi.updateWidget(selectedDashboardId, next.id, {
        title: next.title,
        widget_type: next.widget_type,
        table_id: next.table_id,
        config: normalizeConfig(next.config),
      })
      await loadDashboardPreview(selectedDashboardId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить виджет.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteWidget() {
    if (!selectedDashboardId || !selectedWidgetId) return

    setBusy(true)
    setError(null)
    try {
      await reportsApi.deleteWidget(selectedDashboardId, selectedWidgetId)
      await loadDashboardPreview(selectedDashboardId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить виджет.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className={`${REPORTS_SHELL} flex min-h-[360px] items-center justify-center`}>
          <Loader2 className="h-6 w-6 animate-spin text-[#8ea8cf]" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className={`${REPORTS_SHELL} overflow-hidden`}>
        <section className="border-b border-[#1b385f] bg-[#07172f] px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#22426d] bg-[#0b203d] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#8ea8cf]">
                <Sparkles className="h-3.5 w-3.5" />
                BI модуль
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-[#f4f8ff]">Аналитика</h1>
                <p className="mt-1 text-sm text-[#8ea8cf]">Единая панель метрик, воронки и сегментов</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setViewMode('dashboard')}
                className={`h-9 rounded-full border px-4 text-sm font-medium transition ${
                  viewMode === 'dashboard'
                    ? 'border-[#3a80ff] bg-[#1c6dff] text-white'
                    : 'border-[#234a75] bg-[#0a2241] text-[#b6c7e5] hover:bg-[#112b4c]'
                }`}
              >
                Дашборд
              </button>
              <button
                onClick={() => setViewMode('builder')}
                className={`h-9 rounded-full border px-4 text-sm font-medium transition ${
                  viewMode === 'builder'
                    ? 'border-[#3a80ff] bg-[#1c6dff] text-white'
                    : 'border-[#234a75] bg-[#0a2241] text-[#b6c7e5] hover:bg-[#112b4c]'
                }`}
              >
                Конструктор
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { key: 'today', label: 'Сегодня' },
              { key: '7d', label: '7 дней' },
              { key: '30d', label: '30 дней' },
            ].map((chip) => (
              <button
                key={chip.key}
                onClick={() => setPeriod(chip.key as ReportsPeriod)}
                className={`h-8 rounded-full border px-3 text-xs font-medium transition ${
                  period === chip.key
                    ? 'border-[#3a80ff] bg-[#1c6dff] text-white'
                    : 'border-[#234a75] bg-[#0a2241] text-[#9db4d8] hover:bg-[#122f52]'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-[#7f2d36] bg-[#3a1418] px-4 py-3 text-sm text-[#ff9ca7]">
              {error}
            </div>
          )}
        </section>

        <div className="space-y-4 p-4 md:space-y-6 md:p-6">
          {viewMode === 'dashboard' ? (
            <>
              <WorkspaceToolbar
                tables={tables}
                dashboards={dashboards}
                selectedTableId={selectedTableId}
                selectedDashboardId={selectedDashboardId}
                newDashboardName={newDashboardName}
                busy={busy}
                showWidgetPresets={false}
                onRefresh={() => void loadTablesAndDashboards()}
                onSelectTable={setSelectedTableId}
                onSelectDashboard={setSelectedDashboardId}
                onNewDashboardNameChange={setNewDashboardName}
                onCreateDashboard={() => void handleCreateDashboard()}
                onAddWidget={(kind) => void handleAddWidget(kind)}
              />

              <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                {(metricItems.length > 0 ? metricItems.slice(0, 4) : Array.from({ length: 4 }, (_, idx) => null)).map((item, index) => (
                  <button
                    key={item?.widget.id ?? `metric-fallback-${index}`}
                    onClick={() => item && setSelectedWidgetId(item.widget.id)}
                    disabled={!item}
                    className={`${REPORTS_CARD} min-h-[126px] px-5 py-4 text-left ${
                      item && selectedWidgetId === item.widget.id ? 'ring-2 ring-[#2d8cff]' : ''
                    } ${item ? 'transition hover:bg-[#102b4f]' : 'opacity-70'}`}
                  >
                    <div className={`text-xs font-medium ${REPORTS_MUTED_TEXT}`}>
                      {item?.widget.title ?? ['Выручка', 'Лиды', 'Конверсия', 'Цикл сделки'][index]}
                    </div>
                    <div className="mt-2 text-4xl font-bold text-[#f4f8ff]">{item ? toMetricValue(item) : '—'}</div>
                    <div className="mt-3 text-xs text-[#44d9ac]">{item ? toMetricHint(item) : 'Ожидаем данные'}</div>
                  </button>
                ))}
              </section>

              <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <button
                  onClick={() => primaryChartItem && setSelectedWidgetId(primaryChartItem.widget.id)}
                  className={`${REPORTS_CARD} min-h-[360px] p-4 text-left ${
                    primaryChartItem && selectedWidgetId === primaryChartItem.widget.id ? 'ring-2 ring-[#2d8cff]' : ''
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-[#f4f8ff]">{primaryChartItem?.widget.title ?? 'Динамика'}</div>
                      <div className={`text-xs ${REPORTS_MUTED_TEXT}`}>Последние 30 дней</div>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full border border-[#214267] bg-[#0b2342] px-2 py-1 text-xs text-[#aecaef]">
                      <BarChart3 className="h-3 w-3" />
                      График
                    </div>
                  </div>

                  {primaryChartItem ? (
                    <ChartCard item={primaryChartItem} />
                  ) : (
                    <div className="flex min-h-[250px] items-center justify-center rounded-xl border border-dashed border-[#275084] text-sm text-[#8ea8cf]">
                      Добавьте виджет «Динамика» или «Сравнение»
                    </div>
                  )}
                </button>

                <div className={`${REPORTS_CARD} min-h-[360px] p-4`}>
                  <div className="text-lg font-semibold text-[#f4f8ff]">AI-инсайты</div>
                  <div className="mt-4 space-y-2">
                    {insights.map((insight) => (
                      <div
                        key={insight.label}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#234a75] bg-[#0c2546] px-3 py-2 text-sm"
                      >
                        <span className="text-[#b7cae8]">{insight.label}</span>
                        <span className="font-semibold text-[#f4f8ff]">{insight.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-3">
                <div className={`${REPORTS_CARD} min-h-[280px] p-4`}>
                  <div className="text-lg font-semibold text-[#f4f8ff]">Воронка продаж</div>
                  <div className="mt-4 space-y-2">
                    {funnelPoints.length === 0 && <div className={`text-sm ${REPORTS_MUTED_TEXT}`}>Нет данных для воронки</div>}
                    {funnelPoints.map((point) => (
                      <div key={`funnel-${point.x}`} className="rounded-xl border border-[#234a75] bg-[#0c2546] px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[#c2d4ef]">{point.x}</span>
                          <span className="font-semibold text-[#f4f8ff]">{formatValue(point.y)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => secondaryChartItem && setSelectedWidgetId(secondaryChartItem.widget.id)}
                  className={`${REPORTS_CARD} min-h-[280px] p-4 text-left ${
                    secondaryChartItem && selectedWidgetId === secondaryChartItem.widget.id ? 'ring-2 ring-[#2d8cff]' : ''
                  }`}
                >
                  <div className="text-lg font-semibold text-[#f4f8ff]">Топ каналы</div>
                  <div className="mt-4 space-y-2">
                    {topChartPoints.length === 0 && <div className={`text-sm ${REPORTS_MUTED_TEXT}`}>Нет данных</div>}
                    {topChartPoints.map((point) => (
                      <div key={`channel-${point.x}`} className="rounded-xl border border-[#234a75] bg-[#0c2546] px-3 py-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[#c2d4ef]">{point.x}</span>
                          <span className="font-semibold text-[#f4f8ff]">{formatValue(point.y)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </button>

                <button
                  onClick={() => tableWidgetItem && setSelectedWidgetId(tableWidgetItem.widget.id)}
                  className={`${REPORTS_CARD} min-h-[280px] p-4 text-left ${
                    tableWidgetItem && selectedWidgetId === tableWidgetItem.widget.id ? 'ring-2 ring-[#2d8cff]' : ''
                  }`}
                >
                  <div className="text-lg font-semibold text-[#f4f8ff]">Сегменты клиентов</div>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-[#234a75] bg-[#0c2546]">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#22466f] text-left text-xs text-[#8ea8cf]">
                          {(tableShape.header.slice(0, 3).length > 0 ? tableShape.header.slice(0, 3) : ['Сегмент', 'Показатель', 'Значение']).map((head) => (
                            <th key={head} className="px-3 py-2 font-medium">{head}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(tableShape.rows.slice(0, 5).length > 0 ? tableShape.rows.slice(0, 5) : [['Нет данных', '—', '—']]).map((row, rowIndex) => (
                          <tr key={`segment-${rowIndex}`} className="border-b border-[#1d3e64]/60 last:border-b-0">
                            {row.slice(0, 3).map((cell, cellIndex) => (
                              <td key={`segment-${rowIndex}-${cellIndex}`} className="px-3 py-2 text-[#d6e3f7]">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </button>
              </section>

              <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <FiltersSidebar
                  selectedTable={selectedTable}
                  tableSchema={tableSchema}
                  globalFilters={globalFilters}
                  onChangeFilters={setGlobalFilters}
                />

                <InspectorPanel
                  selectedWidget={selectedWidget}
                  selectedWidgetId={selectedWidgetId}
                  dashboardData={dashboardData}
                  tables={tables}
                  onClearSelection={() => setSelectedWidgetId('')}
                  onSave={handleSaveWidget}
                  onDelete={handleDeleteWidget}
                />
              </section>
            </>
          ) : (
            <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
              <aside className="space-y-4">
                <div className={`${REPORTS_CARD} p-4`}>
                  <div className="mb-3 text-base font-semibold text-[#f4f8ff]">Библиотека виджетов</div>
                  <div className="space-y-2">
                    {BUILDER_WIDGETS.map((preset) => {
                      const Icon = preset.icon
                      return (
                        <button
                          key={preset.kind}
                          onClick={() => void handleAddWidget(preset.kind)}
                          disabled={!selectedDashboardId || !selectedTableId || busy}
                          className="flex w-full items-start gap-3 rounded-xl border border-[#24496f] bg-[#0c2546] px-3 py-2.5 text-left transition hover:bg-[#113055] disabled:opacity-50"
                        >
                          <span className="mt-0.5 rounded-md bg-[#143764] p-1.5 text-[#60a8ff]">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span>
                            <span className="block text-sm font-medium text-[#f4f8ff]">{preset.title}</span>
                            <span className="block text-xs text-[#8ea8cf]">{preset.hint}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <FiltersSidebar
                  selectedTable={selectedTable}
                  tableSchema={tableSchema}
                  globalFilters={globalFilters}
                  onChangeFilters={setGlobalFilters}
                />
              </aside>

              <div className="space-y-4">
                <WorkspaceToolbar
                  tables={tables}
                  dashboards={dashboards}
                  selectedTableId={selectedTableId}
                  selectedDashboardId={selectedDashboardId}
                  newDashboardName={newDashboardName}
                  busy={busy}
                  showWidgetPresets={false}
                  onRefresh={() => void loadTablesAndDashboards()}
                  onSelectTable={setSelectedTableId}
                  onSelectDashboard={setSelectedDashboardId}
                  onNewDashboardNameChange={setNewDashboardName}
                  onCreateDashboard={() => void handleCreateDashboard()}
                  onAddWidget={(kind) => void handleAddWidget(kind)}
                />

                <DashboardCanvas
                  dashboardData={dashboardData}
                  busy={busy}
                  selectedDashboardId={selectedDashboardId}
                  selectedWidgetId={selectedWidgetId}
                  showInspector={showInspector}
                  onSelectWidget={setSelectedWidgetId}
                  onCloseInspector={() => setSelectedWidgetId('')}
                />
              </div>

              <div className="space-y-4">
                <div className={`${REPORTS_CARD} p-4`}>
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-[#b7cae8]">
                    <WandSparkles className="h-4 w-4 text-[#60a8ff]" />
                    Быстрые подсказки
                  </div>
                  <p className="mt-2 text-sm text-[#8ea8cf]">
                    Выберите виджет в центре и отредактируйте параметры справа. Изменения применяются к текущему дашборду.
                  </p>
                </div>

                <InspectorPanel
                  selectedWidget={selectedWidget}
                  selectedWidgetId={selectedWidgetId}
                  dashboardData={dashboardData}
                  tables={tables}
                  onClearSelection={() => setSelectedWidgetId('')}
                  onSave={handleSaveWidget}
                  onDelete={handleDeleteWidget}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
