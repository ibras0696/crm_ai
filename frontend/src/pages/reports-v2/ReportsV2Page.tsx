import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bot,
  Brain,
  Copy,
  Filter,
  LayoutDashboard,
  Loader2,
  RefreshCcw,
  Save,
} from 'lucide-react'

import {
  aiApi,
  reportsApi,
  tablesApi,
  type AnalyticsFilter,
  type AnalyticsSemanticField,
  type AnalyticsSemanticSchema,
  type TableInfo,
} from '@/lib/api'
import { FILTER_OPERATORS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import AnalyticsWidgetCardV2, { type AnalyticsWidgetPreview } from './AnalyticsWidgetCardV2'
import { buildWidgetPlans, type DashboardPreset } from './presetBuilder'

const PRESET_META: Array<{ key: DashboardPreset; label: string; description: string }> = [
  { key: 'executive', label: 'Руководитель', description: 'Ключевые KPI и общий тренд' },
  { key: 'revenue', label: 'Выручка', description: 'Деньги, источники и динамика' },
  { key: 'ops', label: 'Операции', description: 'Операционные метрики и стабильность' },
  { key: 'funnel', label: 'Воронка', description: 'Этапы и конверсия воронки' },
  { key: 'marketing', label: 'Маркетинг', description: 'Каналы, доли и эффективность' },
]

type DraftFilter = {
  column_id: string
  op: AnalyticsFilter['op']
  value: string
}

function opLabel(op: AnalyticsFilter['op']): string {
  return FILTER_OPERATORS.find((item) => item.value === op)?.label ?? op
}

function parseDraftToFilter(draft: DraftFilter, field: AnalyticsSemanticField | null): AnalyticsFilter | null {
  if (!draft.column_id || !draft.op) return null

  if (draft.op === 'is_empty' || draft.op === 'not_empty') {
    return { column_id: draft.column_id, op: draft.op }
  }

  if (draft.op === 'between') {
    const [fromRaw, toRaw] = draft.value.split(',').map((item) => item.trim())
    if (!fromRaw || !toRaw) return null
    const fromValue = field?.analytics_type === 'number' ? Number(fromRaw) : fromRaw
    const toValue = field?.analytics_type === 'number' ? Number(toRaw) : toRaw
    if (field?.analytics_type === 'number' && (Number.isNaN(fromValue) || Number.isNaN(toValue))) return null
    return {
      column_id: draft.column_id,
      op: draft.op,
      from_value: fromValue,
      to_value: toValue,
    }
  }

  if (draft.op === 'in' || draft.op === 'not_in') {
    const values = draft.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (!values.length) return null
    return {
      column_id: draft.column_id,
      op: draft.op,
      values: field?.analytics_type === 'number' ? values.map((item) => Number(item)) : values,
    }
  }

  let value: string | number | boolean = draft.value
  if (field?.analytics_type === 'number') {
    const parsed = Number(draft.value)
    if (Number.isNaN(parsed)) return null
    value = parsed
  }
  if (field?.analytics_type === 'boolean') {
    const normalized = draft.value.trim().toLowerCase()
    if (normalized !== 'true' && normalized !== 'false') return null
    value = normalized === 'true'
  }

  return {
    column_id: draft.column_id,
    op: draft.op,
    value,
  }
}

function summarizeWidget(widget: AnalyticsWidgetPreview): string {
  if (!widget.data) return `${widget.title}: нет данных`
  if (widget.widgetType === 'metric') return `${widget.title}: ${String(widget.data.value ?? '—')}`
  if (Array.isArray(widget.data.points)) {
    const first = widget.data.points[0] as { x?: unknown; y?: unknown } | undefined
    if (first) return `${widget.title}: ${String(first.x ?? '—')} -> ${String(first.y ?? '—')}`
  }
  return `${widget.title}: обновлено`
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

export default function ReportsV2Page() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedTableId, setSelectedTableId] = useState('')
  const [schema, setSchema] = useState<AnalyticsSemanticSchema | null>(null)
  const [preset, setPreset] = useState<DashboardPreset>('executive')
  const [widgets, setWidgets] = useState<AnalyticsWidgetPreview[]>([])
  const [filters, setFilters] = useState<AnalyticsFilter[]>([])
  const [draftFilter, setDraftFilter] = useState<DraftFilter>({ column_id: '', op: 'eq', value: '' })
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [loadingWidgets, setLoadingWidgets] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)

  const selectedField = useMemo(
    () => schema?.fields.find((field) => field.id === draftFilter.column_id) ?? null,
    [schema?.fields, draftFilter.column_id],
  )

  useEffect(() => {
    const presetParam = searchParams.get('preset')
    if (presetParam && PRESET_META.some((item) => item.key === presetParam)) {
      setPreset(presetParam as DashboardPreset)
    }
  }, [])

  useEffect(() => {
    let active = true
    setLoadingInit(true)
    setError(null)

    void tablesApi.list()
      .then((response) => {
        if (!active) return
        const items = response.data.data ?? []
        setTables(items)
        const urlTable = searchParams.get('table')
        const defaultTable = items.find((item) => item.id === urlTable)?.id ?? items[0]?.id ?? ''
        setSelectedTableId(defaultTable)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить список таблиц')
      })
      .finally(() => {
        if (!active) return
        setLoadingInit(false)
      })

    return () => {
      active = false
    }
  }, [searchParams])

  useEffect(() => {
    if (!selectedTableId) {
      setSchema(null)
      return
    }

    let active = true
    setLoadingSchema(true)
    setError(null)

    void reportsApi.semanticSchemaV2(selectedTableId)
      .then((response) => {
        if (!active) return
        setSchema(response.data.data ?? null)
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить semantic schema')
      })
      .finally(() => {
        if (!active) return
        setLoadingSchema(false)
      })

    return () => {
      active = false
    }
  }, [selectedTableId])

  useEffect(() => {
    if (!selectedTableId || !schema) {
      setWidgets([])
      return
    }

    const plans = buildWidgetPlans({
      tableId: selectedTableId,
      schema,
      preset,
      filters,
    })

    setWidgets(
      plans.map((plan) => ({
        id: plan.id,
        title: plan.title,
        widgetType: plan.widget_type,
        data: null,
        loading: true,
      })),
    )

    let active = true
    setLoadingWidgets(true)
    setError(null)

    void Promise.all(
      plans.map(async (plan) => {
        try {
          const response = await reportsApi.unifiedPreviewV2({ mode: 'query', query: plan.query })
          const payload = response.data
          const queryData = extractQueryData(payload.data)
          if (!payload.ok || !queryData) {
            return {
              id: plan.id,
              title: plan.title,
              widgetType: plan.widget_type,
              data: null,
              loading: false,
              error: payload.error?.message ?? 'Не удалось загрузить виджет',
            } satisfies AnalyticsWidgetPreview
          }
          return {
            id: plan.id,
            title: plan.title,
            widgetType: plan.widget_type,
            data: queryData,
            loading: false,
            error: null,
          } satisfies AnalyticsWidgetPreview
        } catch (err) {
          return {
            id: plan.id,
            title: plan.title,
            widgetType: plan.widget_type,
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Ошибка превью',
          } satisfies AnalyticsWidgetPreview
        }
      }),
    )
      .then((items) => {
        if (!active) return
        setWidgets(items)
      })
      .finally(() => {
        if (!active) return
        setLoadingWidgets(false)
      })

    return () => {
      active = false
    }
  }, [selectedTableId, schema, preset, filters])

  useEffect(() => {
    const next = new URLSearchParams()
    if (selectedTableId) next.set('table', selectedTableId)
    next.set('preset', preset)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTableId, preset])

  function onAddFilter() {
    const field = schema?.fields.find((item) => item.id === draftFilter.column_id) ?? null
    const next = parseDraftToFilter(draftFilter, field)
    if (!next) {
      setError('Фильтр заполнен некорректно. Проверьте поле и значение.')
      return
    }
    setFilters((current) => [...current, next])
    setDraftFilter({ column_id: '', op: 'eq', value: '' })
    setError(null)
  }

  function onSaveView() {
    if (!selectedTableId) return
    const storageKey = `reports-v2:view:${selectedTableId}`
    localStorage.setItem(storageKey, JSON.stringify({ preset, filters }))
  }

  function onLoadView() {
    if (!selectedTableId) return
    const storageKey = `reports-v2:view:${selectedTableId}`
    const raw = localStorage.getItem(storageKey)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { preset?: DashboardPreset; filters?: AnalyticsFilter[] }
      if (parsed.preset && PRESET_META.some((item) => item.key === parsed.preset)) {
        setPreset(parsed.preset)
      }
      if (Array.isArray(parsed.filters)) {
        setFilters(parsed.filters)
      }
    } catch {
      // ignore invalid cached state
    }
  }

  async function onCopySnapshot() {
    const snapshot = {
      table: selectedTableId,
      preset,
      filters,
      generated_at: new Date().toISOString(),
    }
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
  }

  async function onAskAI() {
    const question = aiQuestion.trim()
    if (!question) return

    setAiBusy(true)
    setAiError(null)
    try {
      const compactContext = {
        table: schema?.table_name,
        preset,
        filters,
        widgets: widgets.map(summarizeWidget),
      }
      const response = await aiApi.chat({
        include_context: false,
        system_prompt:
          'Ты аналитик CRM. Работаешь только в read-only режиме. Дай краткие выводы, риски и что проверить дополнительно.',
        message: `${question}\n\nКонтекст:\n${JSON.stringify(compactContext, null, 2)}`,
      })
      if (!response.data.ok || !response.data.data?.reply) {
        setAiError(response.data.error?.message ?? 'Не удалось получить ответ AI')
        return
      }
      setAiAnswer(response.data.data.reply)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI временно недоступен')
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="space-y-5 pb-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Аналитика V2
          </h1>
          <p className="text-sm text-muted-foreground">
            Универсальный слой аналитики для любых таблиц + единый контракт запросов
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted"
            onClick={onSaveView}
          >
            <Save className="h-4 w-4" />
            Сохранить вид
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted"
            onClick={onLoadView}
          >
            <RefreshCcw className="h-4 w-4" />
            Загрузить вид
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted"
            onClick={() => void onCopySnapshot()}
          >
            <Copy className="h-4 w-4" />
            Снимок
          </button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-12">
        <aside className="space-y-4 lg:col-span-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Таблица</label>
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              value={selectedTableId}
              onChange={(event) => setSelectedTableId(event.target.value)}
              disabled={loadingInit}
            >
              {tables.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-border/80 bg-muted/30 p-2">
                <p className="text-muted-foreground">Измерения</p>
                <p className="text-foreground">{schema?.dimensions.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/30 p-2">
                <p className="text-muted-foreground">Метрики</p>
                <p className="text-foreground">{schema?.measures.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/30 p-2">
                <p className="text-muted-foreground">Время</p>
                <p className="text-foreground">{schema?.time_dimensions.length ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Шаблоны раскладки</p>
            <div className="space-y-2">
              {PRESET_META.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setPreset(item.key)}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                    preset === item.key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground hover:bg-muted',
                  )}
                >
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Filter className="h-4 w-4" />
              Глобальные фильтры
            </p>

            <div className="space-y-2">
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={draftFilter.column_id}
                onChange={(event) => setDraftFilter((current) => ({ ...current, column_id: event.target.value }))}
              >
                <option value="">Поле</option>
                {schema?.fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>

              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={draftFilter.op}
                onChange={(event) => setDraftFilter((current) => ({ ...current, op: event.target.value as AnalyticsFilter['op'] }))}
              >
                {(selectedField?.supported_filter_ops ?? FILTER_OPERATORS.map((item) => item.value)).map((op) => (
                  <option key={op} value={op}>
                    {opLabel(op as AnalyticsFilter['op'])}
                  </option>
                ))}
              </select>

              {!['is_empty', 'not_empty'].includes(draftFilter.op) && (
                <input
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder={draftFilter.op === 'between' ? 'from,to' : draftFilter.op === 'in' || draftFilter.op === 'not_in' ? 'v1,v2,v3' : 'значение'}
                  value={draftFilter.value}
                  onChange={(event) => setDraftFilter((current) => ({ ...current, value: event.target.value }))}
                />
              )}

              <button
                type="button"
                className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                onClick={onAddFilter}
              >
                Добавить фильтр
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {filters.map((filter, idx) => (
                <div key={`${filter.column_id}-${filter.op}-${idx}`} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {schema?.fields.find((f) => f.id === filter.column_id)?.name ?? filter.column_id} · {opLabel(filter.op)}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => setFilters((current) => current.filter((_, currentIdx) => currentIdx !== idx))}
                  >
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Brain className="h-4 w-4" />
              AI Analyst (read-only)
            </p>
            <textarea
              className="h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Например: где просадка и почему?"
              value={aiQuestion}
              onChange={(event) => setAiQuestion(event.target.value)}
            />
            <button
              type="button"
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              onClick={() => void onAskAI()}
              disabled={aiBusy}
            >
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Получить анализ
            </button>
            {aiError && <p className="mt-2 text-xs text-destructive">{aiError}</p>}
            {aiAnswer && <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">{aiAnswer}</p>}
          </div>
        </aside>

        <main className="space-y-4 lg:col-span-8">
          {error && (
            <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {(loadingInit || loadingSchema) && (
            <div className="flex h-36 items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Готовим semantic schema...
            </div>
          )}

          {!loadingInit && !loadingSchema && schema && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {widgets.map((widget) => (
                <div key={widget.id} className={cn(widget.widgetType === 'table' || widget.widgetType === 'line' || widget.widgetType === 'area' ? 'xl:col-span-2' : '')}>
                  <AnalyticsWidgetCardV2 widget={widget} />
                </div>
              ))}
            </div>
          )}

          {!loadingInit && !loadingSchema && !schema && (
            <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
              Для выбранной таблицы не удалось построить semantic schema.
            </div>
          )}

          {loadingWidgets && (
            <p className="text-xs text-muted-foreground">Обновление виджетов по единому превью...</p>
          )}
        </main>
      </section>
    </div>
  )
}
