import { useEffect, useState } from 'react'
import {
  reportsApi,
  tablesApi,
  type DashboardDataResponse,
  type DashboardInfo,
  type DashboardWidget,
  type DashboardWidgetConfig,
  type TableInfo,
} from '@/lib/api'
import { BarChart3, Plus, Trash2, RefreshCw, LayoutDashboard, ChevronDown } from 'lucide-react'
import ChartCard from '@/components/reports/ChartCard'
import WidgetEditor, { normalizeConfig } from '@/components/reports/WidgetEditor'

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

export default function ReportsPage() {
  const [dashboards, setDashboards] = useState<DashboardInfo[]>([])
  const [tables, setTables] = useState<TableInfo[]>([])
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>('')
  const [dashboardData, setDashboardData] = useState<DashboardDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [newDashName, setNewDashName] = useState('Новый дашборд')
  const [refreshing, setRefreshing] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

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

      {/* Сворачиваемая инструкция */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setShowGuide((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-secondary/30 transition-colors"
        >
          <span>Как собрать дашборд</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showGuide ? 'rotate-180' : ''}`} />
        </button>
        {showGuide && (
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-sm text-muted-foreground border-t border-border pt-3">
            <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">1.</span> Создай дашборд</div>
            <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">2.</span> Добавь виджет и таблицу</div>
            <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">3.</span> Настрой расчет и фильтры</div>
            <div className="rounded-lg border border-border/70 bg-background/30 p-3"><span className="text-foreground font-medium">4.</span> Сохрани и проверь результат</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[300px_1fr] gap-4">
        {/* Sidebar дашбордов */}
        <div className="rounded-xl border border-border bg-card p-3 space-y-3 h-fit xl:sticky xl:top-6">
          <div className="flex items-center justify-between px-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Дашборды</div>
            <div className="text-xs text-muted-foreground">{dashboards.length}</div>
          </div>

          {/* Горизонтальный скролл на мобилке */}
          <div className="flex xl:flex-col gap-1.5 overflow-x-auto xl:overflow-x-visible pb-1 xl:pb-0">
            {dashboards.map((d) => (
              <div
                key={d.id}
                className={`shrink-0 xl:shrink rounded-lg text-sm transition-colors flex items-center gap-1.5 p-1.5 ${selectedDashboardId === d.id ? 'bg-primary text-white' : 'hover:bg-secondary'}`}
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
                  className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors shrink-0 ${selectedDashboardId === d.id ? 'hover:bg-white/15 text-white/90' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'}`}
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

        {/* Основная область */}
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
                        <BarChart3 className="h-4 w-4" /> Данные виджета ещё не загружены. Сохраните настройки виджета.
                      </div>
                    )}
                  </div>
                )
              })}

              {dashboardData.dashboard.widgets.length === 0 && (
                <div className="rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground space-y-3">
                  <BarChart3 className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-medium">Дашборд пустой</p>
                  <p className="text-sm">Добавь первый виджет и выбери таблицу и поля</p>
                  <button onClick={addWidget} className="mx-auto h-9 px-4 rounded-lg bg-primary text-white text-sm hover:bg-primary/90">
                    Добавить виджет
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-16 text-center text-muted-foreground space-y-3">
              <LayoutDashboard className="h-16 w-16 mx-auto opacity-20" />
              <p className="font-medium text-lg">Выбери дашборд слева</p>
              <p className="text-sm">или создай новый</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-4">
        <p className="text-sm font-semibold mb-2">Пример настройки</p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Виджет: <span className="text-foreground">Выручка по источникам</span></p>
          <p>Тип: <span className="text-foreground">Гистограмма</span></p>
          <p>Таблица: <span className="text-foreground">Сделки</span></p>
          <p>Агрегация: <span className="text-foreground">Сумма</span>, Поле значения: <span className="text-foreground">Сумма сделки</span></p>
          <p>Группировка: <span className="text-foreground">Источник</span></p>
          <p>Фильтр: <span className="text-foreground">Статус — Равно — Успешно</span></p>
        </div>
      </div>
    </div>
  )
}
