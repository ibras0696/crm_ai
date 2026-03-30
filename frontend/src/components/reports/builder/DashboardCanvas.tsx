import type { DashboardDataResponse } from '@/lib/api'
import { Database, X } from 'lucide-react'

import ChartCard from '@/components/reports/ChartCard'

interface DashboardCanvasProps {
  dashboardData: DashboardDataResponse | null
  busy: boolean
  selectedDashboardId: string
  selectedWidgetId: string
  onSelectWidget: (widgetId: string) => void
  onCloseInspector: () => void
  showInspector: boolean
}

export default function DashboardCanvas({
  dashboardData,
  busy,
  selectedDashboardId,
  selectedWidgetId,
  onSelectWidget,
  onCloseInspector,
  showInspector,
}: DashboardCanvasProps) {
  const metricItems = (dashboardData?.items ?? []).filter((item) => item.widget.widget_type === 'metric')
  const canvasItems = (dashboardData?.items ?? []).filter((item) => item.widget.widget_type !== 'metric')

  if (!selectedDashboardId) {
    return (
      <section className="flex min-h-[640px] items-center justify-center rounded-[28px] border border-dashed border-[#2a507d] bg-[#091a33] text-center">
        <div className="space-y-3 px-6">
          <Database className="mx-auto h-8 w-8 text-[#8ea8cf]" />
          <div className="text-xl font-semibold text-[#f4f8ff]">Создайте первый дашборд</div>
          <div className="text-sm text-[#8ea8cf]">
            После создания здесь появятся KPI, графики и таблицы по выбранной таблице.
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-[#1f406a] bg-[#091a33] px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#8ea8cf]">Дашборд</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-[#f4f8ff]">{dashboardData?.dashboard.name ?? 'Дашборд'}</div>
            <div className="mt-2 text-sm text-[#8ea8cf]">
              {busy ? 'Пересчитываем виджеты...' : 'Это отдельное полотно дашборда. Фильтры и настройки находятся ниже.'}
            </div>
          </div>
          {showInspector && (
            <button
              onClick={onCloseInspector}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#2a507d] bg-[#0b2446] px-4 text-sm text-[#d2e1f7] hover:bg-[#123157]"
            >
              <X className="h-4 w-4" />
              Закрыть настройки
            </button>
          )}
        </div>
      </section>

      {metricItems.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {metricItems.map((item) => (
            <button
              key={item.widget.id}
              onClick={() => onSelectWidget(item.widget.id)}
              className={`text-left transition ${selectedWidgetId === item.widget.id ? 'rounded-xl ring-2 ring-[#2d8cff]' : ''}`}
            >
              <ChartCard item={item} />
            </button>
          ))}
        </section>
      )}

      {canvasItems.length === 0 ? (
        <section className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-dashed border-[#2a507d] bg-[#091a33] px-6 py-12 text-center">
          <div className="space-y-3">
            <div className="text-lg font-semibold text-[#f4f8ff]">Добавьте первый виджет</div>
            <div className="text-sm text-[#8ea8cf]">
              Используйте кнопки вверху: KPI, сравнение, динамика, структура или таблица.
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-[28px] border border-[#1f406a] bg-[#091a33] p-5">
          <div className="grid auto-rows-[minmax(280px,auto)] gap-4 2xl:grid-cols-2">
            {canvasItems.map((item) => (
              <button
                key={item.widget.id}
                onClick={() => onSelectWidget(item.widget.id)}
                className={`min-w-0 text-left transition ${selectedWidgetId === item.widget.id ? 'rounded-xl ring-2 ring-[#2d8cff]' : ''}`}
              >
                <ChartCard item={item} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
