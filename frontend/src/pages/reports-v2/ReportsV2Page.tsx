import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowClockwise,
  FloppyDisk,
  Funnel,
  Plus,
  Robot,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  aiApi,
  reportsApi,
  tablesApi,
  type AnalyticsFilter,
  type AnalyticsQueryRequest,
  type AnalyticsSemanticField,
  type AnalyticsSemanticSchema,
  type TableInfo,
} from '@/lib/api'
import { FILTER_OPERATORS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import ChartCard from './AnalyticsWidgetCardV2'
import { buildWidgetPlans, type DashboardPreset, type WidgetPlan } from './presetBuilder'
import type { ChartConfig } from './AnalyticsWidgetCardV2'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_META: Array<{ key: DashboardPreset; label: string }> = [
  { key: 'executive', label: 'Руководитель' },
  { key: 'revenue', label: 'Выручка' },
  { key: 'ops', label: 'Операции' },
  { key: 'funnel', label: 'Воронка' },
  { key: 'marketing', label: 'Маркетинг' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DraftFilter = {
  column_id: string
  op: AnalyticsFilter['op']
  value: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function opLabel(op: AnalyticsFilter['op']): string {
  return FILTER_OPERATORS.find((item) => item.value === op)?.label ?? op
}

function parseDraftToFilter(draft: DraftFilter, field: AnalyticsSemanticField | null): AnalyticsFilter | null {
  if (!draft.column_id || !draft.op) return null

  if (draft.op === 'is_empty' || draft.op === 'not_empty') {
    return { column_id: draft.column_id, op: draft.op }
  }

  if (draft.op === 'between') {
    const [fromRaw, toRaw] = draft.value.split(',').map((s) => s.trim())
    if (!fromRaw || !toRaw) return null
    const fromValue = field?.analytics_type === 'number' ? Number(fromRaw) : fromRaw
    const toValue = field?.analytics_type === 'number' ? Number(toRaw) : toRaw
    if (field?.analytics_type === 'number' && (Number.isNaN(fromValue) || Number.isNaN(toValue))) return null
    return { column_id: draft.column_id, op: draft.op, from_value: fromValue, to_value: toValue }
  }

  if (draft.op === 'in' || draft.op === 'not_in') {
    const values = draft.value.split(',').map((s) => s.trim()).filter(Boolean)
    if (!values.length) return null
    return {
      column_id: draft.column_id,
      op: draft.op,
      values: field?.analytics_type === 'number' ? values.map(Number) : values,
    }
  }

  let value: string | number | boolean = draft.value
  if (field?.analytics_type === 'number') {
    const parsed = Number(draft.value)
    if (Number.isNaN(parsed)) return null
    value = parsed
  }
  if (field?.analytics_type === 'boolean') {
    const norm = draft.value.trim().toLowerCase()
    if (norm !== 'true' && norm !== 'false') return null
    value = norm === 'true'
  }

  return { column_id: draft.column_id, op: draft.op, value }
}

function buildQuery(c: ChartConfig, tableId: string, globalFilters: AnalyticsFilter[]): AnalyticsQueryRequest {
  return {
    table_id: tableId,
    widget_type: c.widgetType,
    title: c.title,
    metrics: [
      {
        key: 'y',
        aggregation: c.yAggregation,
        column_id: c.yAggregation === 'count' ? null : c.yColumnId,
        label: 'Значение',
      },
    ],
    group_by_column_id: c.xMode === 'group' ? c.xColumnId : null,
    time_column_id: c.xMode === 'time' ? c.xColumnId : null,
    date_bucket: c.dateBucket,
    filters: globalFilters,
    limit: c.limit,
    sort: { by: 'metric', metric_key: 'y', direction: c.sortDir },
  }
}

function planToConfig(plan: WidgetPlan): ChartConfig {
  const q = plan.query
  const m = q.metrics[0]
  const xIsTime = Boolean(q.time_column_id)
  return {
    id: plan.id,
    title: plan.title,
    widgetType: plan.widget_type,
    xMode: xIsTime ? 'time' : 'group',
    xColumnId: xIsTime ? (q.time_column_id ?? null) : (q.group_by_column_id ?? null),
    dateBucket: q.date_bucket ?? 'month',
    yAggregation: m?.aggregation ?? 'count',
    yColumnId: m?.column_id ?? null,
    limit: q.limit ?? 12,
    sortDir: q.sort?.direction ?? 'desc',
    data: null,
    loading: true,
    error: null,
    isConfigOpen: false,
  }
}

function extractQueryData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const query = root.query
  if (!query || typeof query !== 'object') return null
  const data = (query as Record<string, unknown>).data
  if (!data || typeof data !== 'object') return null
  return data as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReportsV2Page() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Core state
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTableId, setSelectedTableId] = useState('')
  const [schema, setSchema] = useState<AnalyticsSemanticSchema | null>(null)
  const [preset, setPreset] = useState<DashboardPreset>('executive')
  const [charts, setCharts] = useState<ChartConfig[]>([])
  const [filters, setFilters] = useState<AnalyticsFilter[]>([])

  // UI state
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filter draft
  const [draftFilter, setDraftFilter] = useState<DraftFilter>({ column_id: '', op: 'eq', value: '' })

  // AI state
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  // Ref for filter button positioning
  const filterBtnRef = useRef<HTMLDivElement>(null)

  const selectedField = useMemo(
    () => schema?.fields.find((f) => f.id === draftFilter.column_id) ?? null,
    [schema?.fields, draftFilter.column_id],
  )

  // Helpers
  const updateChart = useCallback((id: string, updates: Partial<ChartConfig>) => {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
  }, [])

  const deleteChart = useCallback((id: string) => {
    setCharts((prev) => prev.filter((c) => c.id !== id))
  }, [])

  // Load single chart data
  const loadChartData = useCallback(
    async (chart: ChartConfig, tableId: string, globalFilters: AnalyticsFilter[]) => {
      if (!tableId) return
      updateChart(chart.id, { loading: true, error: null })
      try {
        const q = buildQuery(chart, tableId, globalFilters)
        const res = await reportsApi.unifiedPreviewV2({ mode: 'query', query: q })
        const raw = extractQueryData(res.data?.data)
        updateChart(chart.id, { data: raw ?? null, loading: false })
      } catch (e) {
        updateChart(chart.id, {
          error: e instanceof Error ? e.message : 'Ошибка загрузки',
          loading: false,
        })
      }
    },
    [updateChart],
  )

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Init: read URL params
  useEffect(() => {
    const presetParam = searchParams.get('preset')
    if (presetParam && PRESET_META.some((p) => p.key === presetParam)) {
      setPreset(presetParam as DashboardPreset)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load tables
  useEffect(() => {
    let active = true
    setLoadingInit(true)
    setError(null)

    void tablesApi
      .list()
      .then((res) => {
        if (!active) return
        const items = res.data.data ?? []
        setTables(items)
        const urlTable = searchParams.get('table')
        const defaultTable = items.find((t) => t.id === urlTable)?.id ?? items[0]?.id ?? ''
        setSelectedTableId(defaultTable)

        // Try restore saved view
        if (defaultTable) {
          const saved = localStorage.getItem(`analytics-v2:view:${defaultTable}`)
          if (saved) {
            try {
              const parsed = JSON.parse(saved) as { preset?: DashboardPreset; filters?: AnalyticsFilter[] }
              if (parsed.preset && PRESET_META.some((p) => p.key === parsed.preset)) setPreset(parsed.preset)
              if (Array.isArray(parsed.filters)) setFilters(parsed.filters)
            } catch {
              // ignore
            }
          }
        }
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Не удалось загрузить таблицы')
      })
      .finally(() => {
        if (!active) return
        setLoadingInit(false)
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load schema when table changes
  useEffect(() => {
    if (!selectedTableId) {
      setSchema(null)
      return
    }

    let active = true
    setLoadingSchema(true)
    setError(null)

    void reportsApi
      .semanticSchemaV2(selectedTableId)
      .then((res) => {
        if (!active) return
        setSchema(res.data.data ?? null)
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Не удалось загрузить схему')
      })
      .finally(() => {
        if (!active) return
        setLoadingSchema(false)
      })

    return () => {
      active = false
    }
  }, [selectedTableId])

  // Build charts when schema/preset changes
  useEffect(() => {
    if (!selectedTableId || !schema) {
      setCharts([])
      return
    }

    const plans = buildWidgetPlans({ tableId: selectedTableId, schema, preset, filters })
    const newCharts = plans.map(planToConfig)
    setCharts(newCharts)

    // Fetch data for each chart
    let active = true
    void Promise.all(
      newCharts.map(async (c) => {
        if (!active) return
        await loadChartData(c, selectedTableId, filters)
      }),
    )

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId, schema, preset, filters])

  // Sync URL params
  useEffect(() => {
    const next = new URLSearchParams()
    if (selectedTableId) next.set('table', selectedTableId)
    next.set('preset', preset)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId, preset])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  function addChart() {
    const id = `custom-${Date.now()}`
    const defaultX = schema?.dimensions[0] ?? schema?.time_dimensions[0] ?? null
    const xIsTime = defaultX ? schema?.fields.find((f) => f.id === defaultX)?.analytics_type === 'date' : false
    const newChart: ChartConfig = {
      id,
      title: 'Новый график',
      widgetType: 'bar',
      xMode: xIsTime ? 'time' : 'group',
      xColumnId: defaultX ?? null,
      dateBucket: 'month',
      yAggregation: 'count',
      yColumnId: null,
      limit: 10,
      sortDir: 'desc',
      data: null,
      loading: true,
      error: null,
      isConfigOpen: true,
    }
    setCharts((prev) => [...prev, newChart])
    if (selectedTableId) {
      void loadChartData(newChart, selectedTableId, filters)
    }
  }

  function onAddFilter() {
    const next = parseDraftToFilter(draftFilter, selectedField)
    if (!next) {
      setError('Фильтр заполнен некорректно. Проверьте поле и значение.')
      return
    }
    setFilters((prev) => [...prev, next])
    setDraftFilter({ column_id: '', op: 'eq', value: '' })
    setError(null)
  }

  function onSaveView() {
    if (!selectedTableId) return
    const storageKey = `analytics-v2:view:${selectedTableId}`
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        preset,
        filters,
        charts: charts.map((c) => ({ ...c, data: null, loading: false })),
      }),
    )
  }

  async function onAskAI() {
    const question = aiQuestion.trim()
    if (!question) return
    setAiBusy(true)
    setAiError(null)
    try {
      const ctx = {
        table: schema?.table_name,
        preset,
        filters,
        charts: charts.map((c) => c.title),
      }
      const res = await aiApi.chat({
        include_context: false,
        system_prompt:
          'Ты аналитик CRM. Работаешь только в read-only режиме. Дай краткие выводы, риски и что проверить дополнительно.',
        message: `${question}\n\nКонтекст:\n${JSON.stringify(ctx, null, 2)}`,
      })
      if (!res.data.ok || !res.data.data?.reply) {
        setAiError(res.data.error?.message ?? 'Не удалось получить ответ AI')
        return
      }
      setAiAnswer(res.data.data.reply)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI временно недоступен')
    } finally {
      setAiBusy(false)
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isLoading = loadingInit || loadingSchema

  return (
    <div className="flex flex-col min-h-full pb-24 md:pb-6">

      {/* ---- Sticky Toolbar ---- */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border/60">
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">

          {/* Table selector */}
          <select
            className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm max-w-[180px] text-foreground focus:outline-none focus:border-primary transition-colors"
            value={selectedTableId}
            onChange={(e) => setSelectedTableId(e.target.value)}
            disabled={loadingInit}
          >
            {tables.length === 0 && <option value="">Загрузка...</option>}
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {/* Preset pills */}
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {PRESET_META.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 whitespace-nowrap',
                  preset === p.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Filter button */}
          <div className="relative" ref={filterBtnRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                'h-8 px-3 rounded-lg border border-border bg-background text-sm flex items-center gap-1.5 hover:bg-secondary transition-colors',
                filterOpen && 'bg-secondary',
              )}
            >
              <Funnel
                weight={filters.length > 0 ? 'fill' : 'regular'}
                className={cn('h-3.5 w-3.5', filters.length > 0 && 'text-primary')}
              />
              <span>Фильтры</span>
              {filters.length > 0 && (
                <span className="h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center font-semibold">
                  {filters.length}
                </span>
              )}
            </button>

            {/* Filter popover */}
            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.97 }}
                  transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                  className="absolute top-full right-0 mt-1.5 w-72 bg-card border border-border/80 rounded-xl shadow-xl z-30 p-3 space-y-2.5"
                >
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Добавить фильтр</p>

                  <select
                    className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                    value={draftFilter.column_id}
                    onChange={(e) => setDraftFilter((d) => ({ ...d, column_id: e.target.value }))}
                  >
                    <option value="">Поле</option>
                    {schema?.fields.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>

                  <select
                    className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                    value={draftFilter.op}
                    onChange={(e) => setDraftFilter((d) => ({ ...d, op: e.target.value as AnalyticsFilter['op'] }))}
                  >
                    {(selectedField?.supported_filter_ops ?? FILTER_OPERATORS.map((o) => o.value)).map((op) => (
                      <option key={op} value={op}>{opLabel(op as AnalyticsFilter['op'])}</option>
                    ))}
                  </select>

                  {!['is_empty', 'not_empty'].includes(draftFilter.op) && (
                    <input
                      className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
                      placeholder={
                        draftFilter.op === 'between'
                          ? 'от,до'
                          : draftFilter.op === 'in' || draftFilter.op === 'not_in'
                          ? 'v1,v2,v3'
                          : 'значение'
                      }
                      value={draftFilter.value}
                      onChange={(e) => setDraftFilter((d) => ({ ...d, value: e.target.value }))}
                    />
                  )}

                  {error && (
                    <p className="text-xs text-destructive">{error}</p>
                  )}

                  <button
                    type="button"
                    onClick={onAddFilter}
                    className="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    Применить фильтр
                  </button>

                  {/* Active filters */}
                  {filters.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-border/60">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Активные</p>
                      {filters.map((f, idx) => (
                        <div
                          key={`${f.column_id}-${f.op}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5"
                        >
                          <span className="text-xs text-muted-foreground truncate">
                            {schema?.fields.find((sf) => sf.id === f.column_id)?.name ?? f.column_id}
                            {' '}
                            <span className="text-foreground/60">{opLabel(f.op)}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setFilters((prev) => prev.filter((_, i) => i !== idx))}
                            className="ml-2 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setFilterOpen(false)}
                    className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                  >
                    Закрыть
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Add chart */}
          <button
            type="button"
            onClick={addChart}
            disabled={!schema}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" weight="bold" />
            <span className="hidden sm:inline">График</span>
          </button>

          {/* AI */}
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-secondary transition-colors"
            title="AI Аналитик"
          >
            <Robot className="h-4 w-4 text-primary" />
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={onSaveView}
            className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-secondary transition-colors"
            title="Сохранить вид"
          >
            <FloppyDisk className="h-4 w-4 text-muted-foreground" />
          </button>

          {/* Refresh all */}
          <button
            type="button"
            onClick={() => {
              if (!selectedTableId) return
              charts.forEach((c) => void loadChartData(c, selectedTableId, filters))
            }}
            className="h-8 w-8 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-secondary transition-colors"
            title="Обновить все"
          >
            <ArrowClockwise className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ---- Main Content ---- */}
      <div className="p-4 md:p-6">

        {/* Error banner */}
        {error && !filterOpen && (
          <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/8 px-4 py-2.5 text-sm text-destructive flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-3 opacity-60 hover:opacity-100 transition-opacity">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'h-48 rounded-2xl bg-card border border-border/60 animate-pulse',
                  i === 0 || i === 1 ? 'col-span-1' : i >= 4 ? 'col-span-full' : 'col-span-1 sm:col-span-1 lg:col-span-2',
                )}
              />
            ))}
          </div>
        )}

        {/* No schema */}
        {!isLoading && !schema && selectedTableId && (
          <div className="rounded-2xl border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
            Для выбранной таблицы не удалось построить аналитическую схему.
          </div>
        )}

        {/* No table selected */}
        {!isLoading && !selectedTableId && (
          <div className="rounded-2xl border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">
            Выберите таблицу для начала работы.
          </div>
        )}

        {/* Dashboard grid */}
        {!isLoading && schema && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-auto">
            <AnimatePresence initial={false}>
              {charts.map((chart) => (
                <motion.div
                  key={chart.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                  className={cn(
                    chart.widgetType === 'metric'
                      ? 'col-span-1'
                      : chart.widgetType === 'table'
                      ? 'col-span-full'
                      : chart.widgetType === 'line' || chart.widgetType === 'area'
                      ? 'col-span-full sm:col-span-2 lg:col-span-4'
                      : 'col-span-1 sm:col-span-1 lg:col-span-2',
                  )}
                >
                  <ChartCard
                    chart={chart}
                    schema={schema}
                    onUpdate={(updates) => {
                      updateChart(chart.id, updates)
                      // Refetch if config change affects data dimensions
                      const dataKeys: (keyof ChartConfig)[] = [
                        'widgetType', 'xColumnId', 'yAggregation', 'yColumnId',
                        'dateBucket', 'limit', 'sortDir',
                      ]
                      const needsRefetch = Object.keys(updates).some((k) => dataKeys.includes(k as keyof ChartConfig))
                      if (needsRefetch && selectedTableId) {
                        const updated = { ...chart, ...updates }
                        void loadChartData(updated, selectedTableId, filters)
                      }
                    }}
                    onDelete={() => deleteChart(chart.id)}
                    onRefresh={() => {
                      if (selectedTableId) void loadChartData(chart, selectedTableId, filters)
                    }}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add card placeholder */}
            <motion.button
              type="button"
              onClick={addChart}
              disabled={!schema}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              transition={{ duration: 0.15, ease: [0.32, 0.72, 0, 1] }}
              className="col-span-1 h-40 rounded-2xl border-2 border-dashed border-border/60 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all duration-200 group disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="h-7 w-7 group-hover:scale-110 transition-transform duration-200" />
              <span className="text-sm font-medium">Добавить график</span>
            </motion.button>
          </div>
        )}
      </div>

      {/* ---- AI Modal ---- */}
      <AnimatePresence>
        {aiOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setAiOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
                <span className="font-semibold text-sm flex items-center gap-2">
                  <Robot className="h-4 w-4 text-primary" />
                  AI Аналитик
                </span>
                <button
                  type="button"
                  onClick={() => setAiOpen(false)}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Modal body */}
              <div className="p-4 space-y-3">
                <textarea
                  className="w-full h-24 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/60"
                  placeholder="Например: где просадка и почему?"
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void onAskAI()
                  }}
                />
                <button
                  type="button"
                  onClick={() => void onAskAI()}
                  disabled={aiBusy || !aiQuestion.trim()}
                  className="w-full h-9 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiBusy ? (
                    <ArrowClockwise className="h-4 w-4 animate-spin" />
                  ) : (
                    <Robot className="h-4 w-4" />
                  )}
                  Получить анализ
                </button>

                {aiAnswer && (
                  <div className="text-xs text-muted-foreground whitespace-pre-wrap bg-secondary/30 rounded-xl p-3 max-h-48 overflow-y-auto leading-relaxed">
                    {aiAnswer}
                  </div>
                )}

                {aiError && (
                  <p className="text-xs text-destructive">{aiError}</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
