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
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-[#2a507d] bg-[#091a33] px-6 text-center">
        <div className="space-y-2">
          <div className="text-lg font-semibold text-[#f4f8ff]">Выберите виджет на дашборде</div>
          <div className="text-sm text-[#8ea8cf]">
            Настройки откроются здесь снизу, отдельно от самого полотна дашборда.
          </div>
        </div>
      </div>
    )
  }

  const currentItem = dashboardData?.items.find((item) => item.widget.id === selectedWidgetId)

  return (
    <>
      <div className="rounded-2xl border border-[#1f406a] bg-[#091a33] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-[#8ea8cf]">Настройки виджета</div>
            <div className="mt-1 text-lg font-semibold text-[#f4f8ff]">{selectedWidget.title}</div>
          </div>
          <button
            onClick={onClearSelection}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#2a507d] bg-[#0b2446] text-[#d2e1f7] hover:bg-[#123157]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[#274c78] bg-[#0b2446] p-4 text-sm">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#8ea8cf]">Тип</span>
              <span className="font-medium text-[#f4f8ff]">{selectedWidget.widget_type}</span>
            </div>
            {currentItem && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#8ea8cf]">После фильтра</span>
                <span className="font-medium text-[#f4f8ff]">
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
