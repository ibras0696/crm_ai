import { useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import {
  reportsApi,
  tablesApi,
  type AnalyticsFilter,
  type AnalyticsTableSchema,
  type DashboardDataResponse,
  type DashboardInfo,
  type DashboardWidget,
  type TableInfo,
} from '@/lib/api'
import DashboardCanvas from '@/components/reports/builder/DashboardCanvas'
import FiltersSidebar from '@/components/reports/builder/FiltersSidebar'
import InspectorPanel from '@/components/reports/builder/InspectorPanel'
import WorkspaceToolbar from '@/components/reports/builder/WorkspaceToolbar'
import {
  buildDefaultWidgetConfig,
  buildDefaultWidgetTitle,
  defaultFilterForField,
  type BuilderWidgetKind,
} from '@/components/reports/builder/helpers'
import { normalizeConfig } from '@/components/reports/WidgetEditor'

const CARD_CLASS = 'rounded-3xl border border-border bg-card shadow-sm'

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

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) ?? null,
    [tables, selectedTableId],
  )
  const selectedWidget = useMemo(
    () => dashboardData?.dashboard.widgets.find((widget) => widget.id === selectedWidgetId) ?? null,
    [dashboardData, selectedWidgetId],
  )
  const showInspector = Boolean(selectedWidget)

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
  }, [selectedDashboardId, selectedTableId, JSON.stringify(globalFilters)])

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
      <div className="p-6">
        <div className={`${CARD_CLASS} flex min-h-[360px] items-center justify-center`}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <section className="flex flex-col gap-3">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            BI-конструктор
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Аналитика по вашим таблицам</h1>
            <p className="mt-2 max-w-4xl text-sm text-muted-foreground">
              Рабочее полотно для фильтров, KPI и виджетов. Выбираете таблицу, собираете дашборд и сразу видите результат на одном экране.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </section>

      <WorkspaceToolbar
        tables={tables}
        dashboards={dashboards}
        selectedTableId={selectedTableId}
        selectedDashboardId={selectedDashboardId}
        newDashboardName={newDashboardName}
        busy={busy}
        onRefresh={() => void loadTablesAndDashboards()}
        onSelectTable={setSelectedTableId}
        onSelectDashboard={setSelectedDashboardId}
        onNewDashboardNameChange={setNewDashboardName}
        onCreateDashboard={() => void handleCreateDashboard()}
        onAddWidget={(kind) => void handleAddWidget(kind)}
      />

      <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <FiltersSidebar
          selectedTable={selectedTable}
          tableSchema={tableSchema}
          globalFilters={globalFilters}
          onChangeFilters={setGlobalFilters}
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
      </section>

      <section className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-background px-4 py-4">
          <div className="text-sm font-semibold">Быстрые действия</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Сначала выберите таблицу и дашборд сверху, затем добавляйте виджеты и настраивайте их ниже.
          </p>
          {selectedTable && (
            <button
              onClick={() => setGlobalFilters((prev) => {
                const firstField = tableSchema?.fields[0]
                if (!firstField) return prev
                return [...prev, defaultFilterForField(firstField)]
              })}
              className="mt-4 inline-flex h-10 items-center rounded-xl border border-border px-4 text-sm hover:bg-secondary"
            >
              Добавить фильтр по таблице
            </button>
          )}
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
      </section>
    </div>
  )
}
