import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Loader2 } from 'lucide-react'

import { CHART_COLORS } from '@/lib/constants'

export interface AnalyticsWidgetPreview {
  id: string
  title: string
  widgetType: 'metric' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'table'
  data: Record<string, unknown> | null
  loading?: boolean
  error?: string | null
}

function toPoints(data: Record<string, unknown> | null): Array<{ x: string; y: number }> {
  if (!data || !Array.isArray(data.points)) return []
  return data.points
    .map((point) => {
      if (!point || typeof point !== 'object') return null
      const record = point as Record<string, unknown>
      const xRaw = record.x
      const yRaw = record.y
      const x = typeof xRaw === 'string' || typeof xRaw === 'number' ? String(xRaw) : ''
      const y = typeof yRaw === 'number' ? yRaw : Number(yRaw)
      if (!x || !Number.isFinite(y)) return null
      return { x, y }
    })
    .filter((point): point is { x: string; y: number } => Boolean(point))
}

export default function AnalyticsWidgetCardV2({ widget }: { widget: AnalyticsWidgetPreview }) {
  const points = toPoints(widget.data)
  const tableHeader = Array.isArray(widget.data?.header)
    ? (widget.data?.header as Array<string | number>).map((item) => String(item))
    : []
  const tableRows = Array.isArray(widget.data?.rows)
    ? (widget.data?.rows as Array<Array<string | number | null>>).map((row) => row.map((cell) => String(cell ?? '—')))
    : []

  return (
    <article className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="truncate text-sm font-semibold text-foreground">{widget.title}</h3>
      </header>

      <div className="p-4">
        {widget.loading && (
          <div className="flex h-52 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Обновляем данные...
          </div>
        )}

        {!widget.loading && widget.error && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {widget.error}
          </div>
        )}

        {!widget.loading && !widget.error && widget.widgetType === 'metric' && (
          <div className="space-y-2">
            <p className="text-4xl font-semibold text-foreground">{String(widget.data?.value ?? '—')}</p>
            <p className="text-xs text-muted-foreground">{String(widget.data?.label ?? 'Текущее значение')}</p>
          </div>
        )}

        {!widget.loading && !widget.error && widget.widgetType === 'table' && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {tableHeader.map((cell) => (
                    <th key={cell} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-t border-border">
                    {row.map((cell, colIdx) => (
                      <td key={`${rowIdx}-${colIdx}`} className="px-3 py-2 text-foreground">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!widget.loading && !widget.error && !['metric', 'table'].includes(widget.widgetType) && (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              {widget.widgetType === 'line' ? (
                <LineChart data={points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="y" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                </LineChart>
              ) : widget.widgetType === 'area' ? (
                <AreaChart data={points}>
                  <defs>
                    <linearGradient id={`gradient-${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="y" stroke={CHART_COLORS[0]} fill={`url(#gradient-${widget.id})`} strokeWidth={2} />
                </AreaChart>
              ) : widget.widgetType === 'pie' || widget.widgetType === 'donut' ? (
                <PieChart>
                  <Pie
                    data={points}
                    dataKey="y"
                    nameKey="x"
                    innerRadius={widget.widgetType === 'donut' ? 58 : 0}
                    outerRadius={90}
                    labelLine={false}
                  >
                    {points.map((_, idx) => (
                      <Cell key={`${widget.id}-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              ) : (
                <BarChart data={points}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip />
                  <Bar dataKey="y" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </article>
  )
}
