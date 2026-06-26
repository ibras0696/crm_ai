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
import {
  ArrowClockwise,
  ChartBar,
  ChartDonut,
  ChartLine,
  ChartLineUp,
  ChartPie,
  Hash,
  SlidersHorizontal,
  Table,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'

import { CHART_COLORS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { AnalyticsSemanticSchema } from '@/lib/api'

// ---------------------------------------------------------------------------
// Types (exported so ReportsV2Page can use ChartConfig)
// ---------------------------------------------------------------------------

export interface ChartConfig {
  id: string
  title: string
  widgetType: 'metric' | 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'table'
  xMode: 'group' | 'time'
  xColumnId: string | null
  dateBucket: 'day' | 'week' | 'month'
  yAggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  yColumnId: string | null
  limit: number
  sortDir: 'asc' | 'desc'
  data: Record<string, unknown> | null
  loading: boolean
  error: string | null
  isConfigOpen: boolean
}

// Backward compat: keep the old name exported so any other file importing it still compiles
export type AnalyticsWidgetPreview = ChartConfig

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_TYPES = [
  { type: 'bar' as const, icon: ChartBar, label: 'Столбцы' },
  { type: 'line' as const, icon: ChartLine, label: 'Линия' },
  { type: 'area' as const, icon: ChartLineUp, label: 'Область' },
  { type: 'pie' as const, icon: ChartPie, label: 'Пирог' },
  { type: 'donut' as const, icon: ChartDonut, label: 'Бублик' },
  { type: 'table' as const, icon: Table, label: 'Таблица' },
  { type: 'metric' as const, icon: Hash, label: 'Число' },
] as const

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'hsl(var(--foreground))',
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'hsl(var(--muted)/0.4)' },
}

function tooltipFormatter(v: number | string | undefined): [string, string] {
  return [fmtNumber(v), 'Значение']
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function toPoints(data: Record<string, unknown> | null): Array<{ x: string; y: number }> {
  if (!data || !Array.isArray(data.points)) return []
  return data.points
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const rec = p as Record<string, unknown>
      const xRaw = rec.x
      const yRaw = rec.y
      const x = typeof xRaw === 'string' || typeof xRaw === 'number' ? String(xRaw) : ''
      const y = typeof yRaw === 'number' ? yRaw : Number(yRaw)
      if (!x || !Number.isFinite(y)) return null
      return { x, y }
    })
    .filter((p): p is { x: string; y: number } => Boolean(p))
}

function fmtNumber(val: unknown): string {
  const n = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(n)) return String(val ?? '—')
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  if (Number.isInteger(n)) return n.toLocaleString('ru-RU')
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton({ widgetType }: { widgetType: ChartConfig['widgetType'] }) {
  if (widgetType === 'metric') {
    return (
      <div className="flex items-center gap-4 py-2">
        <div className="h-12 w-1 rounded-full bg-muted animate-pulse" />
        <div className="space-y-2">
          <div className="h-9 w-28 rounded-lg bg-muted animate-pulse" />
          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
        </div>
      </div>
    )
  }
  return <div className="h-52 rounded-xl bg-muted animate-pulse" />
}

function MetricWidget({ data, title }: { data: Record<string, unknown> | null; title: string }) {
  const value = data?.value
  const label = String(data?.label ?? title)
  return (
    <div className="flex items-center gap-4 py-2">
      <div className="h-12 w-1 rounded-full bg-primary shrink-0" />
      <div className="min-w-0">
        <p className="text-4xl font-black tracking-tight leading-none text-foreground">
          {fmtNumber(value)}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5 truncate">{label}</p>
      </div>
    </div>
  )
}

function BarWidget({ points, chartId }: { points: Array<{ x: string; y: number }>; chartId: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtNumber}
        />
        <Tooltip {...TOOLTIP_STYLE} formatter={tooltipFormatter} />
        <Bar
          dataKey="y"
          fill={`url(#bar-gradient-${chartId})`}
          radius={[6, 6, 0, 0]}
          maxBarSize={48}
        >
          <defs>
            <linearGradient id={`bar-gradient-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.65} />
            </linearGradient>
          </defs>
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function LineWidget({ points }: { points: Array<{ x: string; y: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtNumber}
        />
        <Tooltip {...TOOLTIP_STYLE} formatter={tooltipFormatter} />
        <Line
          type="monotone"
          dataKey="y"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function AreaWidget({ points, chartId }: { points: Array<{ x: string; y: number }>; chartId: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
        <defs>
          <linearGradient id={`area-gradient-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="x"
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={fmtNumber}
        />
        <Tooltip {...TOOLTIP_STYLE} formatter={tooltipFormatter} />
        <Area
          type="monotone"
          dataKey="y"
          stroke="hsl(var(--primary))"
          fill={`url(#area-gradient-${chartId})`}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: 'hsl(var(--primary))' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function PieWidget({ points, isDonut }: { points: Array<{ x: string; y: number }>; isDonut: boolean }) {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1" style={{ minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={points}
              dataKey="y"
              nameKey="x"
              innerRadius={isDonut ? 52 : 0}
              outerRadius={76}
              paddingAngle={isDonut ? 3 : 1}
              labelLine={false}
            >
              {points.map((_, idx) => (
                <Cell
                  key={`cell-${idx}`}
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={tooltipFormatter}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* Custom legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 pb-1">
        {points.slice(0, 8).map((p, i) => (
          <div key={p.x} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
            />
            <span className="truncate max-w-[80px]">{p.x}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TableWidget({ data }: { data: Record<string, unknown> | null }) {
  const tableHeader = Array.isArray(data?.header)
    ? (data!.header as Array<string | number>).map((h) => String(h))
    : []
  const tableRows = Array.isArray(data?.rows)
    ? (data!.rows as unknown[]).map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '—')) : [],
      )
    : []

  if (!tableHeader.length && !tableRows.length) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Нет данных</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60">
      <table className="w-full min-w-[400px] text-sm">
        <thead>
          <tr className="bg-muted/40 border-b border-border/60">
            {tableHeader.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
            >
              {row.map((cell, ci) => (
                <td key={`${ri}-${ci}`} className="px-3 py-2 text-foreground text-xs">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center">
        <ChartBar className="h-4 w-4 text-muted-foreground/40" weight="thin" />
      </div>
      <p className="text-xs text-muted-foreground">{title}: нет данных для отображения</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main ChartCard component
// ---------------------------------------------------------------------------

interface ChartCardProps {
  chart: ChartConfig
  schema: AnalyticsSemanticSchema | null
  onUpdate: (updates: Partial<ChartConfig>) => void
  onDelete: () => void
  onRefresh: () => void
}

export default function ChartCard({ chart, schema, onUpdate, onDelete, onRefresh }: ChartCardProps) {
  const data = chart.data
  const points = toPoints(data)

  const isChartEmpty =
    !chart.loading &&
    !chart.error &&
    !['metric', 'table'].includes(chart.widgetType) &&
    points.length === 0

  return (
    <article className="flex flex-col rounded-2xl border border-border/70 bg-card shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden h-full">

      {/* ---- Card Header ---- */}
      <header className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border/60 shrink-0">
        <span className="flex-1 text-sm font-semibold truncate text-foreground">{chart.title}</span>

        {/* Chart type switcher */}
        <div className="flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
          {CHART_TYPES.map(({ type, icon: Icon, label }) => (
            <button
              key={type}
              type="button"
              title={label}
              onClick={() => onUpdate({ widgetType: type })}
              className={cn(
                'h-6 w-6 rounded-md flex items-center justify-center transition-all duration-150',
                chart.widgetType === type
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon
                className="h-3.5 w-3.5"
                weight={chart.widgetType === type ? 'fill' : 'regular'}
              />
            </button>
          ))}
        </div>

        {/* Config toggle */}
        <button
          type="button"
          onClick={() => onUpdate({ isConfigOpen: !chart.isConfigOpen })}
          className={cn(
            'h-7 w-7 rounded-lg flex items-center justify-center transition-colors',
            chart.isConfigOpen
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary',
          )}
          title="Настроить"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
          title="Обновить"
        >
          <ArrowClockwise className={cn('h-3.5 w-3.5', chart.loading && 'animate-spin')} />
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          title="Удалить"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* ---- Inline Config Panel ---- */}
      <AnimatePresence initial={false}>
        {chart.isConfigOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden shrink-0"
          >
            <div className="px-3 py-3 bg-secondary/20 border-b border-border/60 grid grid-cols-2 gap-2">

              {/* Title */}
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                  Название
                </label>
                <input
                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
                  value={chart.title}
                  onChange={(e) => onUpdate({ title: e.target.value })}
                />
              </div>

              {/* X axis */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                  Ось X
                </label>
                <select
                  className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                  value={chart.xColumnId ?? ''}
                  onChange={(e) => {
                    const f = schema?.fields.find((sf) => sf.id === e.target.value)
                    onUpdate({
                      xColumnId: e.target.value || null,
                      xMode: f?.analytics_type === 'date' ? 'time' : 'group',
                    })
                  }}
                >
                  <option value="">Нет</option>
                  {schema?.fields
                    .filter((f) => ['dimension', 'time'].includes(f.semantic_role))
                    .map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
              </div>

              {/* Y aggregation */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                  Агрегация Y
                </label>
                <select
                  className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                  value={chart.yAggregation}
                  onChange={(e) => onUpdate({ yAggregation: e.target.value as ChartConfig['yAggregation'] })}
                >
                  <option value="count">Количество</option>
                  <option value="sum">Сумма</option>
                  <option value="avg">Среднее</option>
                  <option value="min">Минимум</option>
                  <option value="max">Максимум</option>
                </select>
              </div>

              {/* Y column (only when not count) */}
              {chart.yAggregation !== 'count' && (
                <div className="col-span-2">
                  <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                    Поле Y
                  </label>
                  <select
                    className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                    value={chart.yColumnId ?? ''}
                    onChange={(e) => onUpdate({ yColumnId: e.target.value || null })}
                  >
                    <option value="">Выбрать поле</option>
                    {schema?.fields
                      .filter((f) => f.analytics_type === 'number')
                      .map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                  </select>
                </div>
              )}

              {/* Date bucket (only in time mode) */}
              {chart.xMode === 'time' && (
                <div>
                  <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                    Период
                  </label>
                  <select
                    className="w-full h-8 rounded-lg border border-border bg-background px-2 text-sm focus:outline-none focus:border-primary transition-colors"
                    value={chart.dateBucket}
                    onChange={(e) => onUpdate({ dateBucket: e.target.value as ChartConfig['dateBucket'] })}
                  >
                    <option value="day">По дням</option>
                    <option value="week">По неделям</option>
                    <option value="month">По месяцам</option>
                  </select>
                </div>
              )}

              {/* Limit */}
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                  Лимит
                </label>
                <input
                  type="number"
                  min={5}
                  max={100}
                  step={5}
                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:border-primary transition-colors"
                  value={chart.limit}
                  onChange={(e) => onUpdate({ limit: Number(e.target.value) })}
                />
              </div>

              {/* Sort direction */}
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                  Сортировка
                </label>
                <div className="flex gap-1">
                  {(['desc', 'asc'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => onUpdate({ sortDir: dir })}
                      className={cn(
                        'flex-1 h-8 rounded-lg text-xs font-medium transition-colors',
                        chart.sortDir === dir
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background border border-border text-muted-foreground hover:bg-secondary',
                      )}
                    >
                      {dir === 'desc' ? 'По убыванию' : 'По возрастанию'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Chart Body ---- */}
      <div
        className={cn(
          'p-4 flex-1',
          chart.widgetType === 'metric' ? 'min-h-[120px]' : 'min-h-[220px]',
          chart.widgetType === 'table' && 'p-0 pt-0',
        )}
      >
        {/* Loading */}
        {chart.loading && <LoadingSkeleton widgetType={chart.widgetType} />}

        {/* Error */}
        {!chart.loading && chart.error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/8 p-3 text-xs text-destructive">
            {chart.error}
          </div>
        )}

        {/* Empty */}
        {!chart.loading && !chart.error && isChartEmpty && (
          <EmptyState title={chart.title} />
        )}

        {/* Metric */}
        {!chart.loading && !chart.error && chart.widgetType === 'metric' && (
          <MetricWidget data={data} title={chart.title} />
        )}

        {/* Table */}
        {!chart.loading && !chart.error && chart.widgetType === 'table' && (
          <div className="p-3">
            <TableWidget data={data} />
          </div>
        )}

        {/* Charts */}
        {!chart.loading && !chart.error && !isChartEmpty && !['metric', 'table'].includes(chart.widgetType) && (
          <div className="h-56 w-full">
            {chart.widgetType === 'bar' && (
              <BarWidget points={points} chartId={chart.id} />
            )}
            {chart.widgetType === 'line' && (
              <LineWidget points={points} />
            )}
            {chart.widgetType === 'area' && (
              <AreaWidget points={points} chartId={chart.id} />
            )}
            {(chart.widgetType === 'pie' || chart.widgetType === 'donut') && (
              <PieWidget points={points} isDonut={chart.widgetType === 'donut'} />
            )}
          </div>
        )}
      </div>
    </article>
  )
}
