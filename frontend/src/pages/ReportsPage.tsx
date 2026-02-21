import { useEffect, useMemo, useState } from 'react'
import {
  reportsApi,
  tablesApi,
  type DashboardDataItem,
  type DashboardDataResponse,
  type DashboardFilter,
  type DashboardInfo,
  type DashboardWidget,
  type DashboardWidgetConfig,
  type TableInfo,
} from '@/lib/api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid, AreaChart, Area } from 'recharts'
import { BarChart3, Plus, Trash2, RefreshCw, Save, LayoutDashboard } from 'lucide-react'

const WIDGET_TYPES = [
  { value: 'metric', label: 'Метрика' },
  { value: 'bar', label: 'Гистограмма' },
  { value: 'line', label: 'Линия' },
  { value: 'area', label: 'Область' },
  { value: 'pie', label: 'Круговая' },
  { value: 'donut', label: 'Кольцевая' },
  { value: 'table', label: 'Таблица' },
] as const

const AGGREGATIONS = [
  { value: 'count', label: 'Количество' },
  { value: 'sum', label: 'Сумма' },
  { value: 'avg', label: 'Среднее' },
  { value: 'min', label: 'Минимум' },
  { value: 'max', label: 'Максимум' },
] as const

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316']

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

function normalizeConfig(config?: Partial<DashboardWidgetConfig> | null): DashboardWidgetConfig {
  return {
    aggregation: config?.aggregation ?? 'count',
    value_column_id: config?.value_column_id ?? null,
    group_by_column_id: config?.group_by_column_id ?? null,
    time_column_id: config?.time_column_id ?? null,
    time_granularity: config?.time_granularity ?? 'day',
    filters: Array.isArray(config?.filters) ? config!.filters : [],
    limit: typeof config?.limit === 'number' ? config.limit : 10,
    selected_column_ids: Array.isArray(config?.selected_column_ids) ? config!.selected_column_ids : [],
  }
}

function ChartCard({ item }: { item: DashboardDataItem }) {
  const d = item.data
  const type = String(d.type ?? item.widget.widget_type)

  if (type === 'metric') {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">{item.widget.title}</p>
        <p className="text-3xl font-bold mt-1">{String((d.value as number | string | null) ?? '—')}</p>
      </div>
    )
  }

  if (type === 'table') {
    const header = Array.isArray(d.header) ? (d.header as string[]) : []
    const rows = Array.isArray(d.rows) ? (d.rows as string[][]) : []
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">{item.widget.title}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30">
              <tr>
                {header.map((h) => <th key={h} className="px-3 py-2 text-left text-muted-foreground">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border/40">
                  {row.map((cell, idx) => <td key={idx} className="px-3 py-2">{cell || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const points = Array.isArray(d.points) ? (d.points as Array<{ x: string; y: number }>) : []

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium mb-3">{item.widget.title}</p>
      <ResponsiveContainer width="100%" height={260}>
        {type === 'line' ? (
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={2} />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={points}>
            <defs>
              <linearGradient id={`area-${item.widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="y" stroke="#3b82f6" fill={`url(#area-${item.widget.id})`} strokeWidth={2} />
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie data={points} dataKey="y" nameKey="x" outerRadius={90} labelLine={false}>
              {points.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : type === 'donut' ? (
          <PieChart>
            <Pie data={points} dataKey="y" nameKey="x" innerRadius={55} outerRadius={90} paddingAngle={2} labelLine={false}>
              {points.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : (
          <BarChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="y" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

function WidgetEditor({
  widget,
  tables,
  onSave,
  onDelete,
}: {
  widget: DashboardWidget
  tables: TableInfo[]
  onSave: (next: DashboardWidget) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<DashboardWidget>(widget)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(widget), [widget])

  const table = useMemo(() => tables.find((t) => t.id === draft.table_id) || null, [tables, draft.table_id])
  const columns = table?.columns || []
  const cfg = normalizeConfig(draft.config)

  const updateConfig = (patch: Partial<DashboardWidgetConfig>) => {
    setDraft((prev) => ({ ...prev, config: { ...normalizeConfig(prev.config), ...patch } }))
  }

  const save = async () => {
    setSaving(true)
    await onSave({ ...draft, config: normalizeConfig(draft.config) })
    setSaving(false)
  }

  const addFilter = () => {
    if (!columns[0]) return
    const next: DashboardFilter = { column_id: columns[0].id, op: 'eq', value: '' }
    updateConfig({ filters: [...cfg.filters, next] })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Основное</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            placeholder="Название виджета"
          />
          <select
            value={draft.widget_type}
            onChange={(e) => setDraft((p) => ({ ...p, widget_type: e.target.value as DashboardWidget['widget_type'] }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
          >
            {WIDGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select
            value={draft.table_id || ''}
            onChange={(e) => setDraft((p) => ({ ...p, table_id: e.target.value || null }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
          >
            <option value="">— Таблица —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary flex items-center gap-1.5 disabled:opacity-50">
              <Save className="h-4 w-4" /> Сохранить
            </button>
            <button onClick={onDelete} className="h-9 px-3 rounded-lg border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" /> Удалить
            </button>
          </div>
        </div>
      </div>

      {draft.widget_type !== 'table' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Расчет</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={cfg.aggregation}
              onChange={(e) => updateConfig({ aggregation: e.target.value as DashboardWidgetConfig['aggregation'] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              title="Тип расчета"
            >
              {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>

            <select
              value={cfg.value_column_id || ''}
              onChange={(e) => updateConfig({ value_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              title="Поле значения"
            >
              <option value="">Значение (поле)</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              value={cfg.group_by_column_id || ''}
              onChange={(e) => updateConfig({ group_by_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              disabled={draft.widget_type === 'metric' || Boolean(cfg.time_column_id)}
              title="Группировка"
            >
              <option value="">Группировка</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <input
              type="number"
              min={1}
              max={200}
              value={cfg.limit}
              onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Лимит"
              title="Лимит"
            />
          </div>
        </div>
      )}

      {draft.widget_type !== 'table' && draft.widget_type !== 'metric' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Время (для выручки по датам)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={cfg.time_column_id || ''}
              onChange={(e) => updateConfig({ time_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Ось времени (опционально)</option>
              {columns
                .filter((c) => c.field_type === 'date' || c.field_type === 'datetime')
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={cfg.time_granularity}
              onChange={(e) => updateConfig({ time_granularity: e.target.value as DashboardWidgetConfig['time_granularity'] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              disabled={!cfg.time_column_id}
            >
              <option value="day">По дням</option>
              <option value="week">По неделям</option>
              <option value="month">По месяцам</option>
            </select>
            <div className="sm:col-span-2 text-xs text-muted-foreground self-center px-1">
              Для графика выручки по датам: «Сумма» + поле суммы + поле даты.
            </div>
          </div>
        </div>
      )}

      {draft.widget_type === 'table' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Табличный вид</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={cfg.selected_column_ids[0] || ''}
              onChange={(e) => updateConfig({ selected_column_ids: e.target.value ? [e.target.value] : [] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Главная колонка</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              type="number"
              min={1}
              max={200}
              value={cfg.limit}
              onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Лимит строк"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Фильтры</span>
          <button onClick={addFilter} className="text-xs text-primary hover:underline">+ добавить</button>
        </div>
        {cfg.filters.length === 0 && <p className="text-xs text-muted-foreground">Фильтры не заданы.</p>}
        {cfg.filters.map((f, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={f.column_id}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, column_id: e.target.value }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
            >
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={f.op}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, op: e.target.value as DashboardFilter['op'] }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
            >
              <option value="eq">=</option>
              <option value="neq">!=</option>
              <option value="contains">contains</option>
              <option value="gt">&gt;</option>
              <option value="lt">&lt;</option>
              <option value="gte">&gt;=</option>
              <option value="lte">&lt;=</option>
            </select>
            <input
              value={String(f.value ?? '')}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, value: e.target.value }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
              placeholder="Значение"
            />
            <button
              onClick={() => updateConfig({ filters: cfg.filters.filter((_, idx) => idx !== i) })}
              className="h-8 px-2 rounded-md border border-destructive/40 text-destructive text-xs"
            >Удалить</button>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Текущая настройка: {draft.widget_type} • лимит {cfg.limit}{table ? ` • ${table.name}` : ''}
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [dashboards, setDashboards] = useState<DashboardInfo[]>([])
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>('')
  const [dashboardData, setDashboardData] = useState<DashboardDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newDashName, setNewDashName] = useState('Новый дашборд')
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = async () => {
    setLoading(true)
    try {
      const [dashResp, tablesResp] = await Promise.all([
        reportsApi.listDashboards(),
        tablesApi.list(),
      ])
      const list = (dashResp.data.ok && dashResp.data.data) ? dashResp.data.data : []
      setDashboards(list)
      if (tablesResp.data.ok && tablesResp.data.data) setTables(tablesResp.data.data)

      const nextId = selectedDashboardId || list[0]?.id || ''
      setSelectedDashboardId(nextId)
      if (nextId) {
        const d = await reportsApi.getDashboardData(nextId)
        if (d.data.ok && d.data.data) setDashboardData(d.data.data)
      } else {
        setDashboardData(null)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const refresh = async () => {
    setRefreshing(true)
    await loadAll()
  }

  const loadSelectedData = async (dashboardId: string) => {
    if (!dashboardId) {
      setDashboardData(null)
      return
    }
    const d = await reportsApi.getDashboardData(dashboardId)
    if (d.data.ok && d.data.data) setDashboardData(d.data.data)
  }

  const createDashboard = async () => {
    const name = newDashName.trim()
    if (!name) return
    const r = await reportsApi.createDashboard({ name })
    if (r.data.ok && r.data.data) {
      setNewDashName('Новый дашборд')
      await loadAll()
      setSelectedDashboardId(r.data.data.id)
      await loadSelectedData(r.data.data.id)
    }
  }

  const deleteDashboardById = async (dashboardId: string) => {
    if (!dashboardId) return
    if (!window.confirm('Удалить дашборд?')) return
    await reportsApi.deleteDashboard(dashboardId)
    if (selectedDashboardId === dashboardId) {
      setSelectedDashboardId('')
      setDashboardData(null)
    }
    await loadAll()
  }

  const addWidget = async () => {
    if (!selectedDashboardId) return
    await reportsApi.createWidget(selectedDashboardId, {
      title: 'Новый виджет',
      widget_type: 'metric',
      table_id: tables[0]?.id ?? null,
      config: DEFAULT_CONFIG,
      position: dashboardData?.dashboard.widgets.length ?? 0,
    })
    await loadSelectedData(selectedDashboardId)
  }

  const saveWidget = async (next: DashboardWidget) => {
    if (!selectedDashboardId) return
    await reportsApi.updateWidget(selectedDashboardId, next.id, {
      title: next.title,
      widget_type: next.widget_type,
      table_id: next.table_id,
      config: normalizeConfig(next.config),
      position: next.position,
    })
    await loadSelectedData(selectedDashboardId)
  }

  const removeWidget = async (widgetId: string) => {
    if (!selectedDashboardId) return
    await reportsApi.deleteWidget(selectedDashboardId, widgetId)
    await loadSelectedData(selectedDashboardId)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const itemsByWidgetId = new Map((dashboardData?.items || []).map((i) => [i.widget.id, i]))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Конструктор дашбордов</h1>
          <p className="text-sm text-muted-foreground">Собирай виджеты из своих таблиц, полей и фильтров</p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Обновить
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold mb-2">Пошагово</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-sm text-muted-foreground">
          <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">1.</span> Создай дашборд</div>
          <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">2.</span> Добавь виджет и таблицу</div>
          <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">3.</span> Настрой расчет и фильтры</div>
          <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">4.</span> Сохрани и проверь результат</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        <div className="rounded-xl border border-border bg-card p-3 space-y-3 h-fit xl:sticky xl:top-6">
          <div className="flex items-center justify-between px-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Дашборды</div>
            <div className="text-xs text-muted-foreground">{dashboards.length}</div>
          </div>
          <div className="space-y-1.5">
            {dashboards.map((d) => (
              <div
                key={d.id}
                className={`w-full rounded-lg text-sm transition-colors flex items-center gap-1.5 p-1.5 ${selectedDashboardId === d.id ? 'bg-primary text-white' : 'hover:bg-secondary'}`}
              >
                <button
                  onClick={async () => {
                    setSelectedDashboardId(d.id)
                    await loadSelectedData(d.id)
                  }}
                  className="flex-1 min-w-0 text-left px-1 py-1"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="truncate block">{d.name}</span>
                  </div>
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    await deleteDashboardById(d.id)
                  }}
                  className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${selectedDashboardId === d.id ? 'hover:bg-white/15 text-white/90' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'}`}
                  title="Удалить дашборд"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {dashboards.length === 0 && <p className="text-xs text-muted-foreground px-2">Пока пусто</p>}
          </div>

          <div className="pt-2 border-t border-border space-y-2">
            <input
              value={newDashName}
              onChange={(e) => setNewDashName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Название"
            />
            <button onClick={createDashboard} className="w-full h-9 rounded-lg border border-border text-sm hover:bg-secondary flex items-center justify-center gap-1.5">
              <Plus className="h-4 w-4" /> Создать
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {dashboardData ? (
            <>
              <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Дашборд</p>
                  <h2 className="text-xl font-semibold">{dashboardData.dashboard.name}</h2>
                </div>
                <button onClick={addWidget} className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary flex items-center gap-1.5">
                  <Plus className="h-4 w-4" /> Добавить виджет
                </button>
              </div>

              {(dashboardData.dashboard.widgets || []).map((widget) => {
                const item = itemsByWidgetId.get(widget.id)
                return (
                  <div key={widget.id} className="space-y-3">
                    <WidgetEditor
                      widget={widget}
                      tables={tables}
                      onSave={saveWidget}
                      onDelete={async () => removeWidget(widget.id)}
                    />
                    {item ? <ChartCard item={item} /> : (
                      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" /> Данные виджета еще не загружены
                      </div>
                    )}
                  </div>
                )
              })}

              {dashboardData.dashboard.widgets.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                  Добавь первый виджет и выбери таблицу/поля
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
              Создай дашборд слева
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-4">
        <p className="text-sm font-semibold mb-2">Пример настройки</p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Виджет: <span className="text-foreground">Выручка по источникам</span></p>
          <p>Тип: <span className="text-foreground">bar</span></p>
          <p>Таблица: <span className="text-foreground">Сделки</span></p>
          <p>Агрегация: <span className="text-foreground">sum</span>, Поле значения: <span className="text-foreground">Сумма</span></p>
          <p>Группировка: <span className="text-foreground">Источник</span></p>
          <p>Фильтр: <span className="text-foreground">Статус = Успешно</span></p>
        </div>
      </div>
    </div>
  )
}

