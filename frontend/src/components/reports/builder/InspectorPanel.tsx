import type { DashboardDataResponse, DashboardWidget, TableInfo } from '@/lib/api'
import { X } from 'lucide-react'

import WidgetEditor from '@/components/reports/WidgetEditor'

import { formatValue } from './helpers'

interface InspectorPanelProps {
  selectedWidget: DashboardWidget | null
  selectedWidgetId: string
  dashboardData: DashboardDataResponse | null
  tables: TableInfo[]
  onClearSelection: () => void
  onSave: (next: DashboardWidget) => Promise<void>
  onDelete: () => Promise<void>
}

export default function InspectorPanel({
  selectedWidget,
  selectedWidgetId,
  dashboardData,
  tables,
  onClearSelection,
  onSave,
  onDelete,
}: InspectorPanelProps) {
  if (!selectedWidget) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-border bg-background px-6 text-center">
        <div className="space-y-2">
          <div className="text-lg font-semibold">Выберите виджет на дашборде</div>
          <div className="text-sm text-muted-foreground">
            Настройки откроются здесь снизу, отдельно от самого полотна дашборда.
          </div>
        </div>
      </div>
    )
  }

  const currentItem = dashboardData?.items.find((item) => item.widget.id === selectedWidgetId)

  return (
    <>
      <div className="rounded-2xl border border-border bg-background px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Настройки виджета</div>
            <div className="mt-1 text-lg font-semibold">{selectedWidget.title}</div>
          </div>
          <button
            onClick={onClearSelection}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-muted/20 p-4 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Тип</span>
              <span className="font-medium">{selectedWidget.widget_type}</span>
            </div>
            {currentItem && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">После фильтра</span>
                <span className="font-medium">
                  {formatValue(currentItem.data.total_records ?? currentItem.data.total ?? '—')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <WidgetEditor widget={selectedWidget} tables={tables} onSave={onSave} onDelete={onDelete} />
    </>
  )
}
