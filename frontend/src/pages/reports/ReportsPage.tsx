import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react'
import {
  aiApi,
  reportsApi,
  tablesApi,
  type DashboardDataResponse,
  type DashboardInfo,
  type DashboardWidget,
  type DashboardWidgetConfig,
  type FolderInfo,
  type TableAggResponse,
  type TableInfo,
} from '@/lib/api'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  Copy,
  Donut,
  LayoutDashboard,
  LineChart,
  Loader2,
  PieChart,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
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

const REPORTS_SURFACE_CLASS =
  'rounded-[30px] border border-border bg-card shadow-sm'

const REPORTS_PANEL_CLASS =
  'rounded-[26px] border border-border bg-card shadow-sm'

type QuickTemplateDraft = {
  id: string
  title: string
  description: string
  summary: string
  icon: ComponentType<{ className?: string }>
  tone: string
  previewKind: WidgetKind
  aiPrompt: string
  widgets: Array<{
    title: string
    widget_type: WidgetKind
    table_id: string | null
    config: Partial<DashboardWidgetConfig>
  }>
}

const TEXT_LIKE_TYPES = new Set(['text', 'select', 'multi_select', 'email', 'phone', 'url'])
const NUMBER_LIKE_TYPES = new Set(['number', 'formula'])
const DATE_LIKE_TYPES = new Set(['date', 'datetime'])

function normalizeSemanticText(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function isTextLike(fieldType: string) {
  return TEXT_LIKE_TYPES.has(String(fieldType || '').toLowerCase())
}

function isNumberLike(fieldType: string) {
  return NUMBER_LIKE_TYPES.has(String(fieldType || '').toLowerCase())
}

function isDateLike(fieldType: string) {
  return DATE_LIKE_TYPES.has(String(fieldType || '').toLowerCase())
}

function pickColumnByHints(
  table: TableInfo,
  hints: string[],
  matcher: (fieldType: string) => boolean,
) {
  return table.columns.find((column) => {
    if (!matcher(column.field_type)) return false
    const normalized = normalizeSemanticText(column.name)
    return hints.some((hint) => normalized.includes(hint))
  }) ?? null
}

function buildQuickTemplates(table: TableInfo | null): QuickTemplateDraft[] {
  if (!table) return []

  const primaryColumn = table.columns.find(column => column.is_primary) ?? table.columns[0] ?? null
  const numericColumn =
    pickColumnByHints(table, ['выруч', 'доход', 'сумм', 'total', 'amount', 'оплат', 'стоим'], isNumberLike) ??
    table.columns.find(column => isNumberLike(column.field_type)) ??
    null
  const dateColumn =
    pickColumnByHints(table, ['дат', 'time', 'created', 'время', 'оплат'], isDateLike) ??
    table.columns.find(column => isDateLike(column.field_type)) ??
    null
  const statusColumn =
    pickColumnByHints(table, ['статус', 'state', 'stage', 'этап'], isTextLike) ??
    null
  const categoryColumn =
    statusColumn ??
    pickColumnByHints(table, ['катег', 'тип', 'канал', 'источник', 'менедж', 'отдел', 'client', 'курс'], isTextLike) ??
    table.columns.find(column => !column.is_primary && isTextLike(column.field_type)) ??
    primaryColumn

  const templates: QuickTemplateDraft[] = []

  const overviewWidgets: QuickTemplateDraft['widgets'] = [
    {
      title: 'Всего записей',
      widget_type: 'metric',
      table_id: table.id,
      config: { aggregation: 'count', limit: 1 },
    },
  ]
  if (numericColumn) {
    overviewWidgets.push({
      title: `Сумма по ${numericColumn.name}`,
      widget_type: 'metric',
      table_id: table.id,
      config: { aggregation: 'sum', value_column_id: numericColumn.id, limit: 1 },
    })
  }
  if (categoryColumn) {
    overviewWidgets.push({
      title: categoryColumn === statusColumn ? 'Распределение по статусам' : `Разрез по ${categoryColumn.name}`,
      widget_type: 'bar',
      table_id: table.id,
      config: {
        aggregation: numericColumn ? 'sum' : 'count',
        value_column_id: numericColumn?.id ?? null,
        group_by_column_id: categoryColumn.id,
        limit: 10,
      },
    })
  }
  templates.push({
    id: 'overview',
    title: 'Общая картина',
    description: 'Быстрый старт: главное число и базовый разрез по данным.',
    summary: `${overviewWidgets.length} виджета: итог, сумма и ключевой разрез.`,
    icon: LayoutDashboard,
    tone: 'text-cyan-500',
    previewKind: 'metric',
    aiPrompt: `Собери обзорный дашборд по таблице "${table.name}" с главным числом, базовым разрезом и короткими подписями без лишней воды.`,
    widgets: overviewWidgets,
  })

  if (categoryColumn) {
    const statusWidgets: QuickTemplateDraft['widgets'] = [
      {
        title: categoryColumn === statusColumn ? 'Статусы' : `${categoryColumn.name}: структура`,
        widget_type: statusColumn ? 'pie' : 'bar',
        table_id: table.id,
        config: {
          aggregation: 'count',
          group_by_column_id: categoryColumn.id,
          limit: 12,
        },
      },
      {
        title: categoryColumn === statusColumn ? 'Статусы по объёму' : `Топ по ${categoryColumn.name}`,
        widget_type: 'bar',
        table_id: table.id,
        config: {
          aggregation: numericColumn ? 'sum' : 'count',
          value_column_id: numericColumn?.id ?? null,
          group_by_column_id: categoryColumn.id,
          limit: 12,
        },
      },
    ]
    templates.push({
      id: 'breakdown',
      title: 'Структура и статусы',
      description: 'Показывает, как распределяются записи по статусам, этапам или категориям.',
      summary: `${statusWidgets.length} виджета: структура и сравнение по группам.`,
      icon: PieChart,
      tone: 'text-emerald-500',
      previewKind: statusColumn ? 'pie' : 'bar',
      aiPrompt: `Собери дашборд по таблице "${table.name}", чтобы было видно распределение по статусам или категориям и где сосредоточен основной объём.`,
      widgets: statusWidgets,
    })
  }

  if (dateColumn) {
    const trendWidgets: QuickTemplateDraft['widgets'] = [
      {
        title: 'Динамика по времени',
        widget_type: 'line',
        table_id: table.id,
        config: {
          aggregation: numericColumn ? 'sum' : 'count',
          value_column_id: numericColumn?.id ?? null,
          time_column_id: dateColumn.id,
          time_granularity: 'month',
          limit: 24,
        },
      },
    ]
    if (numericColumn) {
      trendWidgets.unshift({
        title: `Итог по ${numericColumn.name}`,
        widget_type: 'metric',
        table_id: table.id,
        config: {
          aggregation: 'sum',
          value_column_id: numericColumn.id,
          limit: 1,
        },
      })
    }
    templates.push({
      id: 'trend',
      title: 'Динамика',
      description: 'Подходит, когда важно увидеть рост, спад и сезонность во времени.',
      summary: `${trendWidgets.length} виджета: итог и движение по датам.`,
      icon: LineChart,
      tone: 'text-violet-500',
      previewKind: 'line',
      aiPrompt: `Собери дашборд по таблице "${table.name}" с акцентом на динамику по времени, рост, спад и ключевые отклонения.`,
      widgets: trendWidgets,
    })
  }

  if (primaryColumn || categoryColumn) {
    const listColumnIds = table.columns.slice(0, 6).map(column => column.id)
    const focusColumn = categoryColumn ?? primaryColumn
    const listWidgets: QuickTemplateDraft['widgets'] = []
    if (focusColumn) {
      listWidgets.push({
        title: `Топ по ${focusColumn.name}`,
        widget_type: numericColumn ? 'bar' : 'table',
        table_id: table.id,
        config: numericColumn
          ? {
              aggregation: 'sum',
              value_column_id: numericColumn.id,
              group_by_column_id: focusColumn.id,
              limit: 10,
            }
          : {
              selected_column_ids: listColumnIds,
              limit: 12,
            },
      })
    }
    listWidgets.push({
      title: 'Список записей',
      widget_type: 'table',
      table_id: table.id,
      config: {
        selected_column_ids: listColumnIds,
        limit: 12,
      },
    })
    templates.push({
      id: 'list',
      title: 'Топ и список',
      description: 'Чтобы быстро увидеть лидеров и сразу провалиться в конкретные записи.',
      summary: `${listWidgets.length} виджета: топ и табличный список.`,
      icon: Table2,
      tone: 'text-amber-500',
      previewKind: numericColumn ? 'bar' : 'table',
      aiPrompt: `Собери практичный дашборд по таблице "${table.name}", где сверху будут лидеры, а ниже понятный список записей для работы руками.`,
      widgets: listWidgets,
    })
  }

  return templates
}

function renderGoalPreview(kind: WidgetKind) {
  if (kind === 'metric') {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Итог</div>
        <div className="mt-2 text-3xl font-semibold tracking-tight">128</div>
        <div className="mt-1 text-xs text-emerald-400">+12% к прошлому периоду</div>
      </div>
    )
  }
  if (kind === 'bar') {
    return (
      <div className="flex h-24 items-end gap-2 rounded-2xl border border-border bg-muted/20 px-4 py-3">
        {[34, 58, 46, 76, 63].map((value, index) => (
          <div key={index} className="flex-1 rounded-t-xl bg-gradient-to-t from-primary to-primary/20" style={{ height: `${value}%` }} />
        ))}
      </div>
    )
  }
  if (kind === 'line') {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
        <svg viewBox="0 0 160 70" className="h-24 w-full">
          <path d="M8 58 C28 38, 38 44, 58 30 S92 10, 114 24 S138 40, 152 14" fill="none" stroke="#1d9bff" strokeWidth="4" strokeLinecap="round" />
          <path d="M8 58 C28 38, 38 44, 58 30 S92 10, 114 24 S138 40, 152 14" fill="url(#trendFill)" opacity="0.28" />
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d9bff" />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    )
  }
  return (
    <div className="relative flex items-center justify-center rounded-2xl border border-border bg-muted/20 px-4 py-3">
      <div className="relative h-24 w-24 rounded-full border-[12px] border-primary/20 border-t-primary border-r-primary/70" />
      <div className="absolute text-sm font-medium">68%</div>
    </div>
  )
}

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
  const [selectedTableAnalytics, setSelectedTableAnalytics] = useState<TableAggResponse | null>(null)

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
  const [uiMode, setUiMode] = useState<'simple' | 'advanced'>('simple')
  const [pendingDashboardReveal, setPendingDashboardReveal] = useState(false)
  const dashboardResultRef = useRef<HTMLDivElement | null>(null)

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
  const quickTemplates = useMemo(
    () => buildQuickTemplates(selectedTableForCreate),
    [selectedTableForCreate],
  )
  const recentDashboards = useMemo(
    () => dashboards.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6),
    [dashboards],
  )
  const selectedTableStats = useMemo(() => {
    if (!selectedTableForCreate) return null
    const numericColumns = selectedTableForCreate.columns.filter(column => isNumberLike(column.field_type)).length
    const dateColumns = selectedTableForCreate.columns.filter(column => isDateLike(column.field_type)).length
    const textColumns = selectedTableForCreate.columns.filter(column => isTextLike(column.field_type)).length
    return {
      rows: selectedTableAnalytics?.total_records ?? null,
      columns: selectedTableForCreate.columns.length,
      numericColumns,
      dateColumns,
      textColumns,
    }
  }, [selectedTableAnalytics, selectedTableForCreate])

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

  useEffect(() => {
    if (!selectedTableIdForCreate) {
      setSelectedTableAnalytics(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await reportsApi.tableAnalytics(selectedTableIdForCreate)
        if (!cancelled) {
          setSelectedTableAnalytics(response.data.ok ? (response.data.data ?? null) : null)
        }
      } catch {
        if (!cancelled) setSelectedTableAnalytics(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedTableIdForCreate])

  useEffect(() => {
    if (!pendingDashboardReveal || !selectedDashboardId || !dashboardData) return
    dashboardResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setPendingDashboardReveal(false)
  }, [pendingDashboardReveal, selectedDashboardId, dashboardData])

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
        setPendingDashboardReveal(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const createDashboardRecord = async (name: string, description?: string) => {
    const response = await reportsApi.createDashboard({ name, description })
    if (response.data.ok && response.data.data) {
      return response.data.data
    }
    throw new Error(response.data.error?.message || 'Не удалось создать дашборд')
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

  const ensureDashboardTarget = async (nameHint?: string) => {
    if (selectedDashboardId) return selectedDashboardId
    const created = await createDashboardRecord(
      (nameHint?.trim() || `${selectedTableForCreate?.name || 'Новый'} дашборд`).slice(0, 255),
    )
    await loadDashboardsAndTables(true)
    setSelectedDashboardId(created.id)
    return created.id
  }

  const duplicateSelectedDashboard = async () => {
    if (!selectedDashboard || !dashboardData) return
    setBusy(true)
    try {
      const created = await createDashboardRecord(`${selectedDashboard.name} копия`, selectedDashboard.description || undefined)
      const widgets = dashboardData.dashboard.widgets.slice().sort((a, b) => a.position - b.position)
      for (const [index, widget] of widgets.entries()) {
        await reportsApi.createWidget(created.id, {
          title: widget.title,
          widget_type: widget.widget_type,
          table_id: widget.table_id,
          config: normalizeConfig(widget.config),
          position: index,
        })
      }
      await loadDashboardsAndTables(true)
      setSelectedDashboardId(created.id)
      await loadSelectedData(created.id)
      setPendingDashboardReveal(true)
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
      setPendingDashboardReveal(true)
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

  const createTemplateWidgets = async (template: QuickTemplateDraft) => {
    if (template.widgets.length === 0) return
    setAiError('')
    setBusy(true)
    try {
      const targetId = await ensureDashboardTarget(`${selectedTableForCreate?.name || template.title} · ${template.title}`)
      const currentCount = targetId === selectedDashboardId ? (dashboardData?.dashboard.widgets.length ?? 0) : 0
      for (const [index, widget] of template.widgets.entries()) {
        await reportsApi.createWidget(targetId, {
          title: widget.title,
          widget_type: widget.widget_type,
          table_id: widget.table_id,
          config: widget.config,
          position: currentCount + index,
        })
      }
      if (targetId !== selectedDashboardId) {
        setSelectedDashboardId(targetId)
      }
      await loadSelectedData(targetId)
      setPendingDashboardReveal(true)
    } finally {
      setBusy(false)
    }
  }

  const createDashboardByAI = async (options?: { tableIds?: string[]; prompt?: string; widgetType?: WidgetKind | null }) => {
    setAiError('')
    if (aiLimitInfo && aiLimitInfo.dailyLimit > 0 && aiLimitInfo.dailyUsed >= aiLimitInfo.dailyLimit) {
      setAiError('Дневной лимит AI токенов исчерпан. Попробуйте завтра или увеличьте тариф.')
      return
    }
    const scopedTableIds = (options?.tableIds ?? aiSelectedTableIds).filter(id => tables.some(t => t.id === id))
    const scopedTables = tables.filter(t => scopedTableIds.includes(t.id))
    const scopedTableNames = scopedTables.map(t => t.name).filter(Boolean)
    const tableName = scopedTableNames[0]
    const promptBase = (options?.prompt || aiPrompt).trim() || 'Собери дашборд с основными метриками'
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
          ...(options?.widgetType ? { widget_type: options.widgetType } : {}),
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
        setPendingDashboardReveal(true)
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

  const createSimpleByAI = async (goal: QuickTemplateDraft) => {
    const scoped = selectedTableIdForCreate ? [selectedTableIdForCreate] : aiSelectedTableIds
    setAiPrompt(goal.aiPrompt)
    await createDashboardByAI({ tableIds: scoped, prompt: goal.aiPrompt, widgetType: null })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className={`${REPORTS_SURFACE_CLASS} overflow-hidden p-5 lg:p-7`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              <BarChart3 className="h-3.5 w-3.5" />
              Аналитика
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">Конструктор дашбордов</h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground lg:text-base">
                Соберите понятную аналитику без сложных настроек: выберите дашборд, укажите таблицу и выберите, какую картину хотите увидеть.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                { label: 'Дашбордов', value: dashboards.length, note: selectedDashboard ? 'Есть активный экран' : 'Можно создать новый' },
                { label: 'Таблиц для аналитики', value: tables.length, note: selectedTableForCreate?.name || 'Выберите источник данных' },
                { label: 'Виджетов в текущем', value: dashboardData?.dashboard.widgets.length ?? 0, note: selectedDashboard ? selectedDashboard.name : 'Дашборд не выбран' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight">{stat.value}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{stat.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <div className="inline-flex h-12 items-center rounded-full border border-border bg-muted/30 p-1">
              <button
                onClick={() => setUiMode('simple')}
                className={`h-10 rounded-full px-5 text-sm font-medium transition-all ${
                  uiMode === 'simple'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Просто
              </button>
              <button
                onClick={() => setUiMode('advanced')}
                className={`h-10 rounded-full px-5 text-sm font-medium transition-all ${
                  uiMode === 'advanced'
                    ? 'bg-primary text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Продвинуто
              </button>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing || busy}
              className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-muted/30 px-5 text-sm font-medium transition-all hover:border-primary/30 hover:bg-muted/50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${(refreshing || busy) ? 'animate-spin' : ''}`} />
              Обновить
            </button>
          </div>
        </div>
      </div>

      {uiMode === 'simple' ? (
        <div className="space-y-5">
          <div className={`${REPORTS_PANEL_CLASS} p-5 lg:p-6`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold">Соберите аналитику за 3 шага</p>
                <p className="mt-1 text-sm text-muted-foreground">Дашборд, таблица, результат.</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[540px]">
                {[
                  { step: '1', title: 'Дашборд', text: 'Куда сохранить результат' },
                  { step: '2', title: 'Таблица', text: 'Откуда брать данные' },
                  { step: '3', title: 'Результат', text: 'Что именно показать' },
                ].map((item) => (
                  <div key={item.step} className="min-w-[160px] rounded-2xl border border-border bg-muted/20 p-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                      {item.step}
                    </div>
                    <div className="mt-3 text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.95fr_1.1fr]">
            <div className={`${REPORTS_PANEL_CLASS} p-5 lg:p-6 space-y-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Шаг 1</p>
                  <h2 className="text-xl font-semibold">Куда сохраняем</h2>
                </div>
                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                  {dashboards.length} дашб.
                </div>
              </div>
              <select
                value={selectedDashboardId}
                onChange={async (e) => {
                  const id = e.target.value
                  setSelectedDashboardId(id)
                  await loadSelectedData(id)
                }}
                className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm"
              >
                <option value="">Создать новый дашборд автоматически</option>
                {dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {recentDashboards.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Недавние</div>
                  <div className="grid grid-cols-1 gap-2">
                    {recentDashboards.map((dashboard) => {
                      const active = dashboard.id === selectedDashboardId
                      return (
                        <button
                          key={dashboard.id}
                          onClick={async () => {
                            setSelectedDashboardId(dashboard.id)
                            await loadSelectedData(dashboard.id)
                          }}
                          className={`rounded-xl border px-3 py-3 text-left transition-all ${
                            active
                              ? 'border-primary/35 bg-primary/5'
                              : 'border-border bg-background hover:border-primary/20 hover:bg-muted/15'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{dashboard.name}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {new Date(dashboard.created_at).toLocaleDateString('ru-RU')}
                              </div>
                            </div>
                            <div className={`rounded-full px-2 py-1 text-[11px] font-medium ${active ? 'bg-primary text-white' : 'border border-border text-muted-foreground'}`}>
                              {active ? 'Выбран' : 'Открыть'}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Текущий дашборд</div>
                    <div className="mt-1 text-base font-medium">{selectedDashboard?.name || 'Новый дашборд будет создан автоматически'}</div>
                  </div>
                  <div className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {dashboardData?.dashboard.widgets.length ?? 0} видж.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={newDashName}
                  onChange={(e) => setNewDashName(e.target.value)}
                  className="h-10 min-w-0 rounded-lg border border-input bg-background px-3.5 text-sm"
                  placeholder="Название нового дашборда"
                />
                <button
                  onClick={createDashboard}
                  disabled={busy || !newDashName.trim()}
                  className="inline-flex h-10 w-fit justify-self-start items-center justify-center gap-2 rounded-lg border border-primary/25 bg-background px-3.5 text-sm font-medium text-primary transition-all hover:bg-primary/10 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Создать
                </button>
              </div>
              {selectedDashboard && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void duplicateSelectedDashboard()}
                    disabled={busy || !dashboardData}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium transition-all hover:bg-muted/20 disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                    Дублировать
                  </button>
                  <button
                    onClick={() => setDashboardToDelete(selectedDashboard)}
                    disabled={busy}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-background px-3 text-xs font-medium text-destructive transition-all hover:bg-destructive/5 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    Удалить
                  </button>
                </div>
              )}
            </div>

            <div className={`${REPORTS_PANEL_CLASS} p-5 lg:p-6 space-y-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Шаг 2</p>
                  <h2 className="text-xl font-semibold">Откуда берём данные</h2>
                </div>
                <div className="rounded-full border border-border bg-muted/20 px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  {tables.length} таблиц
                </div>
              </div>
              <select
                value={selectedTableIdForCreate}
                onChange={(e) => setSelectedTableIdForCreate(e.target.value)}
                className="h-10 w-full rounded-xl border border-input bg-background px-3.5 text-sm"
              >
                <option value="">Выберите таблицу</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Сейчас выбрано</div>
                <div className="mt-1 text-base font-medium">{selectedTableForCreate?.name || 'Пока ничего не выбрано'}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {selectedTableForCreate
                    ? 'Ниже появятся шаблоны, которые подходят именно этой таблице.'
                    : 'Сначала выберите таблицу, и система предложит готовые варианты аналитики.'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    label: 'Строк',
                    value: selectedTableStats?.rows != null ? selectedTableStats.rows.toLocaleString('ru-RU') : '—',
                  },
                  {
                    label: 'Колонок',
                    value: selectedTableStats?.columns ?? '—',
                  },
                  {
                    label: 'Числовых',
                    value: selectedTableStats?.numericColumns ?? '—',
                  },
                  {
                    label: 'Дат',
                    value: selectedTableStats?.dateColumns ?? '—',
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{item.label}:</span> {item.value}
                  </div>
                ))}
              </div>
              {selectedTableForCreate && (
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="text-sm font-medium">Что можно построить по этой таблице</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      selectedTableStats?.numericColumns ? 'Суммы и метрики' : null,
                      selectedTableStats?.dateColumns ? 'Динамика по времени' : null,
                      selectedTableStats?.textColumns ? 'Сравнение по категориям' : null,
                    ].filter(Boolean).map((item) => (
                      <div key={item} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className={`${REPORTS_PANEL_CLASS} p-5 lg:p-6 space-y-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Шаг 3</p>
                  <h2 className="text-xl font-semibold">Что строим</h2>
                </div>
                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                  Шаблоны и AI
                </div>
              </div>

              {!selectedTableForCreate ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/10 p-8 text-center">
                  <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <div className="mt-3 text-base font-medium">Сначала выберите таблицу</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Тогда здесь появятся готовые сценарии именно под её структуру.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {quickTemplates.map((template) => (
                    <div key={template.id} className="rounded-2xl border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="inline-flex items-center gap-2">
                            <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ${template.tone}`}>
                              <template.icon className="h-4.5 w-4.5" />
                            </div>
                            <p className="text-base font-semibold">{template.title}</p>
                          </div>
                          <p className="mt-3 text-sm text-muted-foreground">{template.description}</p>
                        </div>
                        <div className="rounded-full border border-border bg-muted/20 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                          {template.widgets.length} видж.
                        </div>
                      </div>
                      <div className={`mt-4 ${template.tone}`}>
                        {renderGoalPreview(template.previewKind)}
                      </div>
                      <div className="mt-4 rounded-xl border border-border bg-muted/15 px-3 py-2 text-sm text-muted-foreground">
                        {template.summary}
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          onClick={() => void createTemplateWidgets(template)}
                          disabled={busy}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium transition-all hover:border-primary/25 hover:bg-muted/20 disabled:opacity-50"
                        >
                          {selectedDashboardId ? 'Добавить в текущий дашборд' : 'Создать готовый дашборд'}
                        </button>
                        <button
                          onClick={() => void createSimpleByAI(template)}
                          disabled={busy}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-50"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          AI соберёт целиком
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {aiError && (
            <div className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {aiError}
            </div>
          )}

          {!selectedDashboardId || !dashboardData ? (
            <div className={`${REPORTS_PANEL_CLASS} border-dashed p-14 text-center`}>
              <LayoutDashboard className="mx-auto h-12 w-12 opacity-30" />
              <p className="mt-4 text-lg font-medium">{selectedDashboardId ? 'Загружаю дашборд' : 'Выберите дашборд'}</p>
              <p className="mt-2 text-sm text-muted-foreground">Здесь появится готовая аналитика.</p>
            </div>
          ) : (
            <div ref={dashboardResultRef} className="space-y-4">
              <div className={`${REPORTS_PANEL_CLASS} flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6`}>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Текущий дашборд</p>
                  <h2 className="mt-2 text-2xl font-semibold">{dashboardData.dashboard.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Виджетов: {dashboardData.dashboard.widgets.length}. Ниже уже показан готовый результат.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <div className="inline-flex h-10 items-center rounded-xl border border-border bg-muted/20 px-4 text-sm text-muted-foreground">
                    Детальная настройка нужна только если хотите вручную менять виджеты.
                  </div>
                  <button
                    onClick={() => setUiMode('advanced')}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 px-4 text-sm font-medium text-primary transition-all hover:bg-primary/15"
                  >
                    Открыть продвинутый режим
                  </button>
                </div>
              </div>
              {dashboardData.dashboard.widgets
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((widget) => {
                  const item = itemsByWidgetId.get(widget.id)
                  return (
                    <div key={widget.id} className={`${REPORTS_PANEL_CLASS} p-4 lg:p-5`}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold">{widget.title}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            {WIDGET_PRESETS.find((x) => x.kind === widget.widget_type)?.title || widget.widget_type}
                          </div>
                        </div>
                      </div>
                      {item ? (
                        <ChartCard item={item} />
                      ) : (
                        <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                          Данные виджета пока не готовы.
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4">
        <div className="space-y-4 xl:sticky xl:top-6 h-fit">
          <div className={`${REPORTS_PANEL_CLASS} p-4 space-y-3`}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Дашборды</p>
            <p className="text-sm text-muted-foreground">
              Здесь выбирается сам экран аналитики: существующий или новый.
            </p>

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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={newDashName}
                onChange={e => setNewDashName(e.target.value)}
                className="h-9 min-w-0 flex-1 px-3 rounded-lg border border-input bg-background text-sm"
                placeholder="Название нового дашборда"
              />
              <button
                onClick={createDashboard}
                disabled={busy || !newDashName.trim()}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-3 text-sm whitespace-nowrap hover:bg-secondary disabled:opacity-50"
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

          <div className={`${REPORTS_PANEL_CLASS} p-4 space-y-3`}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Быстро добавить виджет</p>
            <p className="text-sm text-muted-foreground">
              Этот блок нужен, если вы хотите вручную добавить один новый виджет в текущий дашборд.
            </p>

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

          <div className={`${REPORTS_PANEL_CLASS} p-4 space-y-3`}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">AI-конструктор</p>
            <p className="text-sm text-muted-foreground">
              Если не хотите собирать всё вручную, выберите тип результата, укажите запрос и дайте AI собрать дашборд целиком.
            </p>

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
              placeholder="Например: продажи по месяцам, воронка по статусам, общая картина по сделкам"
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

        <div ref={dashboardResultRef} className="space-y-4">
          {!selectedDashboardId ? (
            <div className={`${REPORTS_PANEL_CLASS} border-dashed p-16 text-center text-muted-foreground space-y-2`}>
              <LayoutDashboard className="h-14 w-14 mx-auto opacity-30" />
              <p className="font-medium text-lg">Сначала выберите дашборд</p>
              <p className="text-sm">Слева можно выбрать существующий дашборд или создать новый. После этого здесь появится результат и настройки.</p>
            </div>
          ) : !dashboardData ? (
            <div className={`${REPORTS_PANEL_CLASS} p-10 text-center text-muted-foreground`}>
              Загружаю данные дашборда...
            </div>
          ) : (
            <>
              <div className={`${REPORTS_PANEL_CLASS} flex items-center justify-between gap-3 flex-wrap p-5`}>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Текущий дашборд</p>
                  <h2 className="text-xl font-semibold">{dashboardData.dashboard.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Виджетов: {dashboardData.dashboard.widgets.length}. Ниже можно менять порядок, удалять и редактировать каждый блок.
                  </p>
                </div>
                <div className="rounded-full border border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
                  <Settings2 className="h-3.5 w-3.5" />
                  Порядок меняется кнопками вверх и вниз
                </div>
              </div>

              {dashboardData.dashboard.widgets.length === 0 ? (
                <div className={`${REPORTS_PANEL_CLASS} border-dashed p-16 text-center text-muted-foreground space-y-3`}>
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
                        <div key={widget.id} className={`${REPORTS_PANEL_CLASS} p-4 space-y-3`}>
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
                              Изменить этот виджет
                              <span className="text-xs text-muted-foreground">Открыть настройки</span>
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
      )}

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
                  void createDashboardByAI({ tableIds: aiSelectedTableIds, widgetType: aiWidgetType })
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
