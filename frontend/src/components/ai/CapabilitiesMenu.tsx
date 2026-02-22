import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart3, BookOpen, Calendar, LayoutGrid, Sparkles, Table2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AIContextSourceTable } from '@/lib/api'

type DashboardWidgetType = 'metric' | 'bar' | 'line' | 'pie' | 'table'
export type UiIntentType = 'create_table' | 'create_dashboard' | 'create_schedule_event' | 'create_kb_page'

function pickFirstSelectedTableName(tables: AIContextSourceTable[], selectedIds: string[]): string | undefined {
  if (!selectedIds?.length) return undefined
  const m = new Map(tables.map((t) => [t.id, t.name] as const))
  const name = m.get(selectedIds[0])
  return name || undefined
}

export default function CapabilitiesMenu(props: {
  includeContext: boolean
  disabled?: boolean
  tables: AIContextSourceTable[]
  selectedTableIds: string[]
  onSelect: (intent: { type: UiIntentType; params?: Record<string, unknown> }) => void
}) {
  const { includeContext, disabled, tables, selectedTableIds, onSelect } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedTableName = useMemo(
    () => pickFirstSelectedTableName(tables, selectedTableIds),
    [tables, selectedTableIds],
  )

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!includeContext) return null

  const select = (intent: { type: UiIntentType; params?: Record<string, unknown> }) => {
    onSelect(intent)
    setOpen(false)
  }

  const chooseCreateTable = () => select({ type: 'create_table' })

  const chooseCreateDashboard = (widgetType: DashboardWidgetType) =>
    select({ type: 'create_dashboard', params: { widget_type: widgetType, ...(selectedTableName ? { table_name: selectedTableName } : {}) } })

  const chooseCreateSchedule = () => select({ type: 'create_schedule_event' })

  const chooseCreateKb = () => select({ type: 'create_kb_page' })

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Возможности AI"
        className="h-8 w-8"
      >
        <Sparkles className="h-4 w-4" />
      </Button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[320px] max-w-[80vw] rounded-xl border border-border bg-card shadow-xl p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-sm font-semibold">Что AI может сделать</p>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} aria-label="Закрыть">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={chooseCreateTable}
              className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Table2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium">Создать таблицу</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Создаст таблицу с колонками. Данные можно добавить потом.</p>
            </button>

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium">Создать дашборд</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Выберите тип виджета:</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => chooseCreateDashboard('metric')} className="h-9 rounded-md border border-border hover:bg-secondary/50 text-xs">Метрика</button>
                <button type="button" onClick={() => chooseCreateDashboard('bar')} className="h-9 rounded-md border border-border hover:bg-secondary/50 text-xs">Бар</button>
                <button type="button" onClick={() => chooseCreateDashboard('line')} className="h-9 rounded-md border border-border hover:bg-secondary/50 text-xs">Линия</button>
                <button type="button" onClick={() => chooseCreateDashboard('pie')} className="h-9 rounded-md border border-border hover:bg-secondary/50 text-xs">Круг</button>
                <button type="button" onClick={() => chooseCreateDashboard('table')} className="h-9 rounded-md border border-border hover:bg-secondary/50 text-xs">Таблица</button>
                <div className="h-9 rounded-md border border-border/60 bg-secondary/20 text-xs flex items-center justify-center text-muted-foreground">
                  <BarChart3 className="h-4 w-4" />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={chooseCreateSchedule}
              className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium">Создать событие в расписании</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Сделает событие по указанным датам и времени.</p>
            </button>

            <button
              type="button"
              onClick={chooseCreateKb}
              className="w-full rounded-lg border border-border px-3 py-2 text-left hover:bg-secondary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-medium">Создать страницу базы знаний</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Добавит страницу в базу знаний организации.</p>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
