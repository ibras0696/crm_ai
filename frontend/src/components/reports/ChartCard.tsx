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
      <div className="rounded-xl border border-[#7f2d36] bg-[#3a1418] p-5">
        <p className="text-sm font-medium text-[#ffd7dd]">{item.widget.title}</p>
        <p className="mt-3 text-sm text-[#ff9ca7]">{d.error}</p>
      </div>
    )
  }

  if (type === 'metric') {
    return (
      <div className="rounded-xl border border-[#274b76] bg-[#0b2446] p-5">
        <p className="text-sm text-[#8ea8cf]">{item.widget.title}</p>
        <p className="mt-1 text-3xl font-bold text-[#f4f8ff]">{String((d.value as number | string | null) ?? '—')}</p>
      </div>
    )
  }

  if (type === 'table') {
    const header = Array.isArray(d.header) ? (d.header as string[]) : []
    const rows = Array.isArray(d.rows) ? (d.rows as string[][]) : []
    return (
      <div className="overflow-hidden rounded-xl border border-[#274b76] bg-[#0b2446]">
        <div className="border-b border-[#22466f] px-4 py-3 text-sm font-medium text-[#f4f8ff]">{item.widget.title}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0a1f3d]">
              <tr>
                {header.map((h) => <th key={h} className="px-3 py-2 text-left text-[#8ea8cf]">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-[#1f4067]">
                  {row.map((cell, idx) => <td key={idx} className="px-3 py-2 text-[#d8e5f8]">{cell || '—'}</td>)}
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
    <div className="rounded-xl border border-[#274b76] bg-[#0b2446] p-4">
      <p className="mb-3 text-sm font-medium text-[#f4f8ff]">{item.widget.title}</p>
      <ResponsiveContainer width="100%" height={260}>
        {type === 'line' ? (
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" stroke="#24466f" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8ea8cf' }} />
            <YAxis tick={{ fontSize: 11, fill: '#8ea8cf' }} />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#24466f" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8ea8cf' }} />
            <YAxis tick={{ fontSize: 11, fill: '#8ea8cf' }} />
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
            <CartesianGrid strokeDasharray="3 3" stroke="#24466f" />
            <XAxis dataKey="x" tick={{ fontSize: 11, fill: '#8ea8cf' }} />
            <YAxis tick={{ fontSize: 11, fill: '#8ea8cf' }} />
            <Tooltip />
            <Bar dataKey="y" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
