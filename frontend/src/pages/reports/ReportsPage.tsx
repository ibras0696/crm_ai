import { type ComponentType, useEffect, useMemo, useState } from 'react'
import {
  aiApi,
  reportsApi,
  tablesApi,
  type DashboardDataResponse,
  type DashboardInfo,
  type DashboardWidget,
  type DashboardWidgetConfig,
  type FolderInfo,
  type TableInfo,
} from '@/lib/api'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  Donut,
  LayoutDashboard,
  LineChart,
  Loader2,
  PieChart,
  Plus,
  RefreshCw,
  Settings2,
  Table2,
  Trash2,
} from 'lucide-react'
import ChartCard from '@/components/reports/ChartCard'
import WidgetEditor, { normalizeConfig } from '@/components/reports/WidgetEditor'
import TableFolderTreeSelect from '@/components/common/TableFolderTreeSelect'

type WidgetKind = 'metric' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'table'

const DEFAULT_CONFIG: DashboardWidgetConfig = {
  aggregation: 'count',
  value_column_id: null,
  group_by_column_id: null,
  time_column_id: null,
  time_granularity: 'day',
  filters: [],
  limit: 10,
  selected_column_ids: [],
}

const WIDGET_PRESETS: Array<{
  kind: WidgetKind
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
}> = [
  { kind: 'metric', title: 'Метрика', description: 'Одно главное число', icon: LayoutDashboard },
  { kind: 'bar', title: 'Гистограмма', description: 'Сравнение категорий', icon: BarChart3 },
  { kind: 'line', title: 'Линейный график', description: 'Динамика во времени', icon: LineChart },
  { kind: 'pie', title: 'Круговая', description: 'Доли по категориям', icon: PieChart },
  { kind: 'donut', title: 'Кольцевая', description: 'Доли в компактном виде', icon: Donut },
  { kind: 'table', title: 'Таблица', description: 'Список строк', icon: Table2 },
]

function buildConfigForWidget(kind: WidgetKind, table: TableInfo | null): DashboardWidgetConfig {
  if (!table) return { ...DEFAULT_CONFIG }

  const cols = table.columns
  const first = cols[0]
  const numeric = cols.find(c => c.field_type === 'number' || c.field_type === 'formula')
  const time = cols.find(c => c.field_type === 'date' || c.field_type === 'datetime')
  const categorical = cols.find(c => c.id !== time?.id)

  if (kind === 'metric') {
    return {
      ...DEFAULT_CONFIG,
      aggregation: numeric ? 'sum' : 'count',
      value_column_id: numeric?.id ?? null,
      limit: 1,
    }
  }

  if (kind === 'line' || kind === 'area') {
    return {
      ...DEFAULT_CONFIG,
      aggregation: numeric ? 'sum' : 'count',
      value_column_id: numeric?.id ?? null,
      time_column_id: time?.id ?? null,
      group_by_column_id: time ? null : categorical?.id ?? first?.id ?? null,
      time_granularity: 'day',
      limit: 30,
    }
  }

  if (kind === 'bar' || kind === 'pie' || kind === 'donut') {
    return {
      ...DEFAULT_CONFIG,
      aggregation: numeric ? 'sum' : 'count',
      value_column_id: numeric?.id ?? null,
      group_by_column_id: categorical?.id ?? first?.id ?? null,
      limit: 15,
    }
  }

  return {
    ...DEFAULT_CONFIG,
    selected_column_ids: first ? [first.id] : [],
    limit: 15,
  }
}

export default function ReportsPage() {
  const [dashboards, setDashboards] = useState<DashboardInfo[]>([])
  const [tables, setTables] = useState<TableInfo[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [selectedDashboardId, setSelectedDashboardId] = useState('')
  const [dashboardData, setDashboardData] = useState<DashboardDataResponse | null>(null)

  const [newDashName, setNewDashName] = useState('Новый дашборд')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)

  const [selectedTableIdForCreate, setSelectedTableIdForCreate] = useState('')
  const [aiWidgetType, setAiWidgetType] = useState<WidgetKind>('bar')
  const [aiPrompt, setAiPrompt] = useState('Собери понятный дашборд с ключевыми показателями')
  const [aiError, setAiError] = useState('')
  const [aiLimitInfo, setAiLimitInfo] = useState<{ dailyUsed: number; dailyLimit: number } | null>(null)
  const [isAiTableModalOpen, setIsAiTableModalOpen] = useState(false)
  const [aiSelectedTableIds, setAiSelectedTableIds] = useState<string[]>([])
  const [dashboardToDelete, setDashboardToDelete] = useState<DashboardInfo | null>(null)

  const selectedDashboard = useMemo(
    () => dashboards.find(d => d.id === selectedDashboardId) ?? null,
    [dashboards, selectedDashboardId],
  )
  const selectedTableForCreate = useMemo(
    () => tables.find(t => t.id === selectedTableIdForCreate) ?? null,
    [tables, selectedTableIdForCreate],
  )
  const aiSelectedTables = useMemo(
    () => tables.filter(t => aiSelectedTableIds.includes(t.id)),
    [tables, aiSelectedTableIds],
  )

  const itemsByWidgetId = useMemo(
    () => new Map((dashboardData?.items || []).map(i => [i.widget.id, i])),
    [dashboardData],
  )

  const loadDashboardsAndTables = async (preserveSelected = true) => {
    const [dashResp, tablesResp, foldersResp] = await Promise.all([
      reportsApi.listDashboards(),
      tablesApi.list(),
      tablesApi.listFolders(),
    ])

    const list = dashResp.data.ok && dashResp.data.data ? dashResp.data.data : []
    const tableList = tablesResp.data.ok && tablesResp.data.data ? tablesResp.data.data : []
    const folderList = foldersResp.data.ok && foldersResp.data.data ? foldersResp.data.data : []

    setDashboards(list)
    setTables(tableList)
    setFolders(folderList)

    if (!selectedTableIdForCreate && tableList[0]) {
      setSelectedTableIdForCreate(tableList[0].id)
    }

    if (!preserveSelected) {
      const firstId = list[0]?.id ?? ''
      setSelectedDashboardId(firstId)
      return firstId
    }

    if (!list.find(x => x.id === selectedDashboardId)) {
      const firstId = list[0]?.id ?? ''
      setSelectedDashboardId(firstId)
      return firstId
    }

    return selectedDashboardId
  }

  const loadSelectedData = async (dashboardId: string) => {
    if (!dashboardId) {
      setDashboardData(null)
      return
    }
    const d = await reportsApi.getDashboardData(dashboardId)
    if (d.data.ok && d.data.data) {
      setDashboardData(d.data.data)
    } else {
      setDashboardData(null)
    }
  }

  const initialLoad = async () => {
    setLoading(true)
    try {
      const nextId = await loadDashboardsAndTables(false)
      if (nextId) await loadSelectedData(nextId)
      try {
        const status = await aiApi.status()
        if (status.data.ok && status.data.data) {
          const limits = status.data.data.limits
          const today = status.data.data.today
          if (limits && today) {
            setAiLimitInfo({
              dailyUsed: Number(today.total_tokens || 0),
              dailyLimit: Number(limits.daily_tokens || 0),
            })
          } else {
            setAiLimitInfo(null)
          }
        }
      } catch {
        setAiLimitInfo(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void initialLoad()
  }, [])

  useEffect(() => {
    if (tables.length === 0) {
      setAiSelectedTableIds([])
      return
    }
    setAiSelectedTableIds(prev => {
      const valid = prev.filter(id => tables.some(t => t.id === id))
      if (valid.length > 0) return valid
      if (selectedTableIdForCreate && tables.some(t => t.id === selectedTableIdForCreate)) {
        return [selectedTableIdForCreate]
      }
      const firstTable = tables[0]
      return firstTable ? [firstTable.id] : []
    })
  }, [tables, selectedTableIdForCreate])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const nextId = await loadDashboardsAndTables(true)
      if (nextId) await loadSelectedData(nextId)
    } finally {
      setRefreshing(false)
    }
  }

  const createDashboard = async () => {
    const name = newDashName.trim()
    if (!name) return
    setBusy(true)
    try {
      const r = await reportsApi.createDashboard({ name })
      if (r.data.ok && r.data.data) {
        setNewDashName('Новый дашборд')
        await loadDashboardsAndTables(true)
        setSelectedDashboardId(r.data.data.id)
        await loadSelectedData(r.data.data.id)
      }
    } finally {
      setBusy(false)
    }
  }

  const removeDashboard = async (id: string) => {
    setBusy(true)
    try {
      await reportsApi.deleteDashboard(id)
      const nextId = await loadDashboardsAndTables(false)
      if (nextId) await loadSelectedData(nextId)
      else setDashboardData(null)
    } finally {
      setBusy(false)
    }
  }

  const createWidget = async (kind: WidgetKind) => {
    if (!selectedDashboardId) return
    const table = selectedTableForCreate
    const config = buildConfigForWidget(kind, table)
    setBusy(true)
    try {
      await reportsApi.createWidget(selectedDashboardId, {
        title: `${WIDGET_PRESETS.find(w => w.kind === kind)?.title || 'Виджет'} ${dashboardData?.dashboard.widgets.length ? dashboardData.dashboard.widgets.length + 1 : 1}`,
        widget_type: kind,
        table_id: table?.id ?? null,
        config,
        position: dashboardData?.dashboard.widgets.length ?? 0,
      })
      await loadSelectedData(selectedDashboardId)
    } finally {
      setBusy(false)
    }
  }

  const saveWidget = async (next: DashboardWidget) => {
    if (!selectedDashboardId) return
    setBusy(true)
    try {
      await reportsApi.updateWidget(selectedDashboardId, next.id, {
        title: next.title,
        widget_type: next.widget_type,
        table_id: next.table_id,
        config: normalizeConfig(next.config),
        position: next.position,
      })
      await loadSelectedData(selectedDashboardId)
    } finally {
      setBusy(false)
    }
  }

  const deleteWidget = async (widgetId: string) => {
    if (!selectedDashboardId) return
    setBusy(true)
    try {
      await reportsApi.deleteWidget(selectedDashboardId, widgetId)
      await loadSelectedData(selectedDashboardId)
    } finally {
      setBusy(false)
    }
  }

  const moveWidget = async (widgetId: string, direction: 'up' | 'down') => {
    if (!selectedDashboardId || !dashboardData) return
    const widgets = [...dashboardData.dashboard.widgets].sort((a, b) => a.position - b.position)
    const idx = widgets.findIndex(w => w.id === widgetId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= widgets.length) return

    const next = [...widgets]
    const current = next[idx]
    const target = next[swapIdx]
    if (!current || !target) return
    next[idx] = target
    next[swapIdx] = current

    setBusy(true)
    try {
      await Promise.all(
        next.map((w, i) => reportsApi.updateWidget(selectedDashboardId, w.id, { position: i })),
      )
      await loadSelectedData(selectedDashboardId)
    } finally {
      setBusy(false)
    }
  }

  const mapAiError = (code?: string, message?: string) => {
    const c = String(code || '').toUpperCase()
    if (c === 'AI_DAILY_LIMIT' || c === 'AI_TOKEN_LIMIT_EXCEEDED') return 'Лимит AI токенов исчерпан. Купите пакет токенов или дождитесь нового расчетного месяца.'
    if (c === 'AI_RATE_LIMIT') return 'Слишком много запросов к AI. Подождите немного и повторите.'
    if (c === 'AI_DISABLED') return 'AI отключен для вашей организации.'
    if (c === 'AI_NOT_CONFIGURED') return 'AI не настроен на сервере.'
    if (c === 'TABLE_LIMIT_REACHED' || c === 'TABLE_LIMIT_REACHED') return 'Нельзя создать дашборд/таблицу: достигнут лимит тарифа.'
    if (message) return message
    return 'Не удалось создать дашборд через AI. Попробуйте позже.'
  }

  const createDashboardByAI = async (tableIds?: string[]) => {
    setAiError('')
    if (aiLimitInfo && aiLimitInfo.dailyLimit > 0 && aiLimitInfo.dailyUsed >= aiLimitInfo.dailyLimit) {
      setAiError('Дневной лимит AI токенов исчерпан. Попробуйте завтра или увеличьте тариф.')
      return
    }
    const scopedTableIds = (tableIds ?? aiSelectedTableIds).filter(id => tables.some(t => t.id === id))
    const scopedTables = tables.filter(t => scopedTableIds.includes(t.id))
    const scopedTableNames = scopedTables.map(t => t.name).filter(Boolean)
    const tableName = scopedTableNames[0]
    const promptBase = aiPrompt.trim() || 'Собери дашборд с основными метриками'
    const promptWithScope = scopedTableNames.length > 0
      ? `${promptBase}\n\nИспользуй только эти таблицы: ${scopedTableNames.join(', ')}.`
      : promptBase
    setBusy(true)
    try {
      const response = await aiApi.chat({
        message: promptWithScope,
        include_context: true,
        ui_intent: 'create_dashboard',
        ui_intent_params: {
          widget_type: aiWidgetType,
          ...(scopedTableNames.length ? { table_names: scopedTableNames } : {}),
          ...(tableName ? { table_name: tableName } : {}),
        },
      })

      if (!response.data.ok) {
        setAiError(mapAiError(response.data.error?.code, response.data.error?.message))
        return
      }

      const actionResult = (response.data.data?.action_result as { ok?: boolean; error?: string; dashboard?: { id?: string } } | undefined)
      if (actionResult && actionResult.ok === false) {
        if (actionResult.error === 'table_limit_reached') {
          setAiError('Достигнут лимит тарифа. Освободите ресурсы или смените тариф.')
        } else {
          setAiError('AI не смог выполнить действие. Уточните запрос и попробуйте снова.')
        }
        return
      }

      const dashboardId = String(actionResult?.dashboard?.id || '')
      await loadDashboardsAndTables(true)
      if (dashboardId) {
        setSelectedDashboardId(dashboardId)
        await loadSelectedData(dashboardId)
      } else {
        setAiError('AI ответил без создания дашборда. Уточните запрос и повторите.')
        await refresh()
      }
    } catch (e: any) {
      const code = e?.response?.data?.error?.code
      const message = e?.response?.data?.error?.message
      setAiError(mapAiError(code, message))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Конструктор дашбордов</h1>
          <p className="text-sm text-muted-foreground">Собери понятные графики и таблицы по своим данным</p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing || busy}
          className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${(refreshing || busy) ? 'animate-spin' : ''}`} />
          Обновить
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="space-y-4 xl:sticky xl:top-6 h-fit">
          <div className="rounded-xl border border-border bg-card p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Дашборды</p>

            <select
              value={selectedDashboardId}
              onChange={async (e) => {
                const id = e.target.value
                setSelectedDashboardId(id)
                await loadSelectedData(id)
              }}
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Выбери дашборд</option>
              {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>

            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={newDashName}
                onChange={e => setNewDashName(e.target.value)}
                className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
                placeholder="Название нового дашборда"
              />
              <button
                onClick={createDashboard}
                disabled={busy || !newDashName.trim()}
                className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary disabled:opacity-50 flex items-center gap-1"
              >
                <Plus className="h-4 w-4" /> Создать
              </button>
            </div>

            {selectedDashboard && (
              <button
                onClick={() => setDashboardToDelete(selectedDashboard)}
                disabled={busy}
                className="w-full h-9 rounded-lg border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Удалить текущий дашборд
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Быстро добавить виджет</p>

            <select
              value={selectedTableIdForCreate}
              onChange={e => setSelectedTableIdForCreate(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Таблица (опционально)</option>
              {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            <div className="grid grid-cols-2 gap-2">
              {WIDGET_PRESETS.map(p => {
                const Icon = p.icon
                return (
                  <button
                    key={p.kind}
                    onClick={() => void createWidget(p.kind)}
                    disabled={!selectedDashboardId || busy}
                    className="rounded-lg border border-border p-2 text-left hover:bg-secondary/30 disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{p.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{p.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 space-y-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">AI-конструктор</p>
            <p className="text-xs text-muted-foreground">AI сам создаст дашборд и виджеты на основе контекста и выбранной таблицы</p>

            <select
              value={aiWidgetType}
              onChange={e => setAiWidgetType(e.target.value as WidgetKind)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              {WIDGET_PRESETS.map(p => <option key={p.kind} value={p.kind}>{p.title}</option>)}
            </select>

            <input
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Что построить в дашборде"
            />

            <button
              onClick={() => setIsAiTableModalOpen(true)}
              disabled={busy || !!(aiLimitInfo && aiLimitInfo.dailyLimit > 0 && aiLimitInfo.dailyUsed >= aiLimitInfo.dailyLimit)}
              className="w-full h-9 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <Bot className="h-4 w-4" /> Выбрать таблицы и создать
            </button>
            <p className="text-xs text-muted-foreground">
              Выбрано таблиц: {aiSelectedTables.length}
            </p>
            {aiLimitInfo && aiLimitInfo.dailyLimit > 0 && (
              <p className="text-xs text-muted-foreground">
                AI токены за день: {aiLimitInfo.dailyUsed.toLocaleString('ru-RU')} / {aiLimitInfo.dailyLimit.toLocaleString('ru-RU')}
              </p>
            )}
            {aiError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {aiError}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {!selectedDashboardId ? (
            <div className="rounded-xl border border-dashed border-border p-16 text-center text-muted-foreground space-y-2">
              <LayoutDashboard className="h-14 w-14 mx-auto opacity-30" />
              <p className="font-medium text-lg">Сначала выбери или создай дашборд</p>
              <p className="text-sm">Дальше добавляй виджеты: метрики, графики, таблицы</p>
            </div>
          ) : !dashboardData ? (
            <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground">
              Загружаю данные дашборда...
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Текущий дашборд</p>
                  <h2 className="text-xl font-semibold">{dashboardData.dashboard.name}</h2>
                  <p className="text-xs text-muted-foreground mt-1">Виджетов: {dashboardData.dashboard.widgets.length}</p>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Settings2 className="h-3.5 w-3.5" />
                  Порядок можно менять кнопками вверх/вниз
                </div>
              </div>

              {dashboardData.dashboard.widgets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-16 text-center text-muted-foreground space-y-3">
                  <BarChart3 className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-medium">Дашборд пустой</p>
                  <p className="text-sm">Выбери тип виджета слева, чтобы быстро начать</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dashboardData.dashboard.widgets
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((widget, index, arr) => {
                      const item = itemsByWidgetId.get(widget.id)
                      return (
                        <div key={widget.id} className="rounded-xl border border-border bg-card p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{widget.title}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                                {WIDGET_PRESETS.find(x => x.kind === widget.widget_type)?.title || widget.widget_type}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => void moveWidget(widget.id, 'up')}
                                disabled={index === 0 || busy}
                                className="h-8 w-8 rounded-md border border-border hover:bg-secondary disabled:opacity-40 flex items-center justify-center"
                                title="Вверх"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void moveWidget(widget.id, 'down')}
                                disabled={index === arr.length - 1 || busy}
                                className="h-8 w-8 rounded-md border border-border hover:bg-secondary disabled:opacity-40 flex items-center justify-center"
                                title="Вниз"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => void deleteWidget(widget.id)}
                                disabled={busy}
                                className="h-8 px-2 rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-40 flex items-center gap-1"
                                title="Удалить"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          {item ? (
                            <ChartCard item={item} />
                          ) : (
                            <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                              Данные виджета не рассчитаны. Открой настройки и сохрани.
                            </div>
                          )}

                          <details className="rounded-lg border border-border/70 bg-background/20">
                            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium flex items-center justify-between">
                              Настройки виджета
                              <span className="text-xs text-muted-foreground">Открыть/скрыть</span>
                            </summary>
                            <div className="px-3 pb-3">
                              <WidgetEditor
                                widget={widget}
                                tables={tables}
                                onSave={saveWidget}
                                onDelete={async () => deleteWidget(widget.id)}
                              />
                            </div>
                          </details>
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {dashboardToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !busy && setDashboardToDelete(null)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold leading-tight">Удалить дашборд?</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Дашборд <span className="font-medium text-foreground">"{dashboardToDelete.name}"</span> будет удален без возможности восстановления.
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setDashboardToDelete(null)}
                disabled={busy}
                className="h-10 rounded-lg border border-border text-sm hover:bg-secondary disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  const target = dashboardToDelete
                  if (!target) return
                  await removeDashboard(target.id)
                  setDashboardToDelete(null)
                }}
                disabled={busy}
                className="h-10 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {isAiTableModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !busy && setIsAiTableModalOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-semibold leading-tight">Выбор таблиц для AI</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Отметь таблицы, на основе которых AI соберет дашборд.
              </p>
            </div>

            {tables.length === 0 ? (
              <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">
                Таблиц пока нет. Создай таблицу и попробуй снова.
              </div>
            ) : (
              <TableFolderTreeSelect
                tables={tables.map(t => ({ id: t.id, name: t.name, folder_id: t.folder_id }))}
                folders={folders}
                selectedIds={aiSelectedTableIds}
                onSelectedIdsChange={setAiSelectedTableIds}
                emptyText="Нет таблиц"
                heightClassName="max-h-[320px]"
              />
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsAiTableModalOpen(false)}
                disabled={busy}
                className="h-10 rounded-lg border border-border text-sm hover:bg-secondary disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  setIsAiTableModalOpen(false)
                  void createDashboardByAI(aiSelectedTableIds)
                }}
                disabled={busy || tables.length > 0 && aiSelectedTableIds.length === 0}
                className="h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
