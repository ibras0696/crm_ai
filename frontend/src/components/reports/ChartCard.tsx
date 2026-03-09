import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import type { DashboardDataItem } from '@/lib/api'
import { CHART_COLORS } from '@/lib/constants'

export default function ChartCard({ item }: { item: DashboardDataItem }) {
  const d = item.data
  const type = String(d.type ?? item.widget.widget_type)

  if (typeof d.error === 'string' && d.error) {
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-5">
        <p className="text-sm font-medium">{item.widget.title}</p>
        <p className="mt-3 text-sm text-destructive">{d.error}</p>
      </div>
    )
  }

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
            <Line type="monotone" dataKey="y" stroke={CHART_COLORS[0]} strokeWidth={2} />
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={points}>
            <defs>
              <linearGradient id={`area-${item.widget.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.55} />
                <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="y" stroke={CHART_COLORS[0]} fill={`url(#area-${item.widget.id})`} strokeWidth={2} />
          </AreaChart>
        ) : type === 'pie' ? (
          <PieChart>
            <Pie data={points} dataKey="y" nameKey="x" outerRadius={90} labelLine={false}>
              {points.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : type === 'donut' ? (
          <PieChart>
            <Pie data={points} dataKey="y" nameKey="x" innerRadius={55} outerRadius={90} paddingAngle={2} labelLine={false}>
              {points.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : (
          <BarChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="x" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="y" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
