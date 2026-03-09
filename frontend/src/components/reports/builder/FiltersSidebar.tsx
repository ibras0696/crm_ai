import type { AnalyticsFilter, AnalyticsTableSchema, TableInfo } from '@/lib/api'
import { Plus } from 'lucide-react'

import FilterValueInput from './FilterValueInput'
import { defaultFilterForField } from './helpers'

interface FiltersSidebarProps {
  selectedTable: TableInfo | null
  tableSchema: AnalyticsTableSchema | null
  globalFilters: AnalyticsFilter[]
  onChangeFilters: (next: AnalyticsFilter[]) => void
}

export default function FiltersSidebar({
  selectedTable,
  tableSchema,
  globalFilters,
  onChangeFilters,
}: FiltersSidebarProps) {
  function setFilterAt(index: number, nextFilter: AnalyticsFilter) {
    const next = [...globalFilters]
    next[index] = nextFilter
    onChangeFilters(next)
  }

  return (
    <aside className="space-y-5">
      <div className="rounded-2xl border border-border bg-background px-4 py-4">
        <div className="text-sm font-semibold">Фильтры</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Ограничивают все виджеты дашборда по выбранной таблице.
        </p>
        <button
          onClick={() => {
            const firstField = tableSchema?.fields[0]
            if (!firstField) return
            onChangeFilters([...globalFilters, defaultFilterForField(firstField)])
          }}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-sm hover:bg-secondary"
        >
          <Plus className="h-4 w-4" />
          Добавить фильтр
        </button>

        <div className="mt-4 space-y-3">
          {globalFilters.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Пока без фильтров
            </div>
          )}
          {globalFilters.map((filter, index) => {
            const field = tableSchema?.fields.find((item) => item.id === filter.column_id)
            const supportedOps = field?.supported_filter_ops ?? ['eq']
            return (
              <div key={`${filter.column_id}-${index}`} className="space-y-2 rounded-2xl border border-border bg-background p-3">
                <select
                  value={filter.column_id}
                  onChange={(e) => {
                    const nextField = tableSchema?.fields.find((item) => item.id === e.target.value)
                    if (!nextField) return
                    setFilterAt(index, defaultFilterForField(nextField))
                  }}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {tableSchema?.fields.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filter.op}
                  onChange={(e) => setFilterAt(index, { ...filter, op: e.target.value as AnalyticsFilter['op'] })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  {supportedOps.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <FilterValueInput field={field} filter={filter} onChange={(nextFilter) => setFilterAt(index, nextFilter)} />
                <button
                  onClick={() => onChangeFilters(globalFilters.filter((_, itemIndex) => itemIndex !== index))}
                  className="h-9 w-full rounded-xl border border-destructive/30 px-3 text-sm text-destructive hover:bg-destructive/10"
                >
                  Удалить
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {selectedTable && (
        <div className="rounded-2xl border border-border bg-background px-4 py-4">
          <div className="text-sm font-semibold">{selectedTable.name}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {tableSchema?.total_records ?? 0} записей • {tableSchema?.fields.length ?? 0} полей
          </div>
          <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {tableSchema?.fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between rounded-xl border border-border/80 px-3 py-2 text-sm">
                <span className="truncate pr-3">{field.name}</span>
                <span className="shrink-0 text-xs uppercase tracking-[0.18em] text-muted-foreground">{field.analytics_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
