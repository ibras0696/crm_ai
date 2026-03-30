import type { DashboardInfo, TableInfo } from '@/lib/api'
import { Database, LayoutDashboard, Loader2, Plus, RefreshCw } from 'lucide-react'

import { BUILDER_WIDGETS, type BuilderWidgetKind } from './helpers'

interface WorkspaceToolbarProps {
  tables: TableInfo[]
  dashboards: DashboardInfo[]
  selectedTableId: string
  selectedDashboardId: string
  newDashboardName: string
  busy: boolean
  showWidgetPresets?: boolean
  onRefresh: () => void
  onSelectTable: (value: string) => void
  onSelectDashboard: (value: string) => void
  onNewDashboardNameChange: (value: string) => void
  onCreateDashboard: () => void
  onAddWidget: (kind: BuilderWidgetKind) => void
}

export default function WorkspaceToolbar({
  tables,
  dashboards,
  selectedTableId,
  selectedDashboardId,
  newDashboardName,
  busy,
  showWidgetPresets = true,
  onRefresh,
  onSelectTable,
  onSelectDashboard,
  onNewDashboardNameChange,
  onCreateDashboard,
  onAddWidget,
}: WorkspaceToolbarProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#1f406a] bg-[#091a33] shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
      <div className="border-b border-[#214267] bg-[#0a1e39] px-5 py-4">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="grid gap-3 lg:grid-cols-2 2xl:flex 2xl:items-center">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#274d79] bg-[#0b2446] px-3 py-2">
              <Database className="h-4 w-4 text-[#8ea8cf]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#8ea8cf]">Таблица</div>
                <select
                  value={selectedTableId}
                  onChange={(e) => onSelectTable(e.target.value)}
                  className="mt-1 h-8 w-full bg-transparent text-sm text-[#f4f8ff] outline-none"
                >
                  <option value="">Выберите таблицу</option>
                  {tables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[#274d79] bg-[#0b2446] px-3 py-2">
              <LayoutDashboard className="h-4 w-4 text-[#8ea8cf]" />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#8ea8cf]">Дашборд</div>
                <select
                  value={selectedDashboardId}
                  onChange={(e) => onSelectDashboard(e.target.value)}
                  className="mt-1 h-8 w-full bg-transparent text-sm text-[#f4f8ff] outline-none"
                >
                  <option value="">Выберите дашборд</option>
                  {dashboards.map((dashboard) => (
                    <option key={dashboard.id} value={dashboard.id}>
                      {dashboard.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[auto_minmax(240px,1fr)_auto] 2xl:w-[520px]">
            <button
              onClick={onRefresh}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#2a507d] bg-[#0b2446] px-4 text-sm font-medium text-[#d1e0f7] hover:bg-[#123157]"
            >
              <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Обновить
            </button>
            <input
              value={newDashboardName}
              onChange={(e) => onNewDashboardNameChange(e.target.value)}
              className="h-11 min-w-0 rounded-2xl border border-[#2a507d] bg-[#0b2446] px-4 text-sm text-[#f4f8ff] placeholder:text-[#7f9ec7]"
              placeholder="Название нового дашборда"
            />
            <button
              onClick={onCreateDashboard}
              disabled={busy || !selectedTableId}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#1c6dff] px-5 text-sm font-medium text-white transition hover:bg-[#2d7aff] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Создать
            </button>
          </div>
        </div>

        {showWidgetPresets && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {BUILDER_WIDGETS.map((preset) => {
              const Icon = preset.icon
              return (
                <button
                  key={preset.kind}
                  onClick={() => onAddWidget(preset.kind)}
                  disabled={!selectedDashboardId || !selectedTableId || busy}
                  className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[#284f7a] bg-[#0b2446] px-4 py-2.5 text-sm font-medium text-[#d2e1f7] transition hover:bg-[#123157] disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 text-[#60a8ff]" />
                  {preset.title}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
