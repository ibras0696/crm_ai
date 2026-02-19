import { useState, useEffect } from 'react'
import { reportsApi, type TableAggResponse, type TimeSeriesPoint } from '@/lib/api'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area } from 'recharts'
import { BarChart3, Table2, FileText, Columns3, TrendingUp, RefreshCw, Search, ChevronDown, ChevronUp, Hash, Calendar } from 'lucide-react'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#14b8a6']

interface Summary {
  tables_count: number
  records_count: number
  columns_count: number
  tables: { id: string; name: string; records_count: number; columns_count: number }[]
}

export default function ReportsPage() {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState<'overview' | 'detail' | 'timeline'>('overview')
  const [selectedTable, setSelectedTable] = useState<string>('')
  const [tableAgg, setTableAgg] = useState<TableAggResponse | null>(null)
  const [aggLoading, setAggLoading] = useState(false)
  const [timeline, setTimeline] = useState<TimeSeriesPoint[]>([])
  const [timelineDays, setTimelineDays] = useState(30)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [expandedCol, setExpandedCol] = useState<string | null>(null)

  const load = async () => {
    try {
      const r = await reportsApi.summary()
      if (r.data.ok && r.data.data) setData(r.data.data as Summary)
    } catch { /* ignore */ }
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  const refresh = () => { setRefreshing(true); load() }

  const loadTableAgg = async (tableId: string) => {
    if (!tableId) { setTableAgg(null); return }
    setAggLoading(true)
    try {
      const r = await reportsApi.tableAnalytics(tableId)
      if (r.data.ok && r.data.data) setTableAgg(r.data.data as TableAggResponse)
    } catch { /* ignore */ }
    setAggLoading(false)
  }

  const loadTimeline = async (days: number) => {
    setTimelineLoading(true)
    try {
      const r = await reportsApi.timeline(days)
      if (r.data.ok && r.data.data) setTimeline(r.data.data as TimeSeriesPoint[])
    } catch { /* ignore */ }
    setTimelineLoading(false)
  }

  useEffect(() => { if (tab === 'timeline') loadTimeline(timelineDays) }, [tab, timelineDays])

  useEffect(() => { if (selectedTable) loadTableAgg(selectedTable) }, [selectedTable])

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )

  const tableBarData = (data?.tables || []).map(t => ({ name: t.name.length > 12 ? t.name.slice(0, 12) + '…' : t.name, Записи: t.records_count, Поля: t.columns_count }))
  const pieData = (data?.tables || []).filter(t => t.records_count > 0).map(t => ({ name: t.name, value: t.records_count }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Отчёты и аналитика</h1>
          <p className="text-muted-foreground text-sm mt-1">Сводная статистика по организации</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5 bg-secondary/30">
            {([['overview', 'Обзор'], ['detail', 'Детализация'], ['timeline', 'Динамика']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={refresh} disabled={refreshing} className="flex items-center gap-2 h-9 px-4 rounded-md border border-border text-sm hover:bg-secondary transition-colors disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Обновить
          </button>
        </div>
      </div>

      {/* KPI Cards — always visible */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Таблиц', value: data?.tables_count ?? 0, icon: Table2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Записей', value: data?.records_count ?? 0, icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Полей', value: data?.columns_count ?? 0, icon: Columns3, color: 'text-violet-500', bg: 'bg-violet-500/10' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-5 flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl ${card.bg} flex items-center justify-center shrink-0`}>
              <card.icon className={`h-6 w-6 ${card.color}`} />
            </div>
            <div>
              <p className="text-3xl font-bold">{card.value.toLocaleString('ru')}</p>
              <p className="text-sm text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* === OVERVIEW TAB === */}
      {tab === 'overview' && (
        <>
          {tableBarData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Записи и поля по таблицам</h2>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={tableBarData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey="Записи" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Поля" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {pieData.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Распределение записей</h2>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-2 min-w-[160px]">
                  {pieData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-sm">
                      <span className="h-3 w-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto font-medium">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(data?.tables || []).length > 0 && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="font-semibold">Детализация по таблицам</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30">
                    <tr>
                      {['Таблица', 'Записей', 'Полей', 'Записей/поле'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.tables || []).map((t, i) => (
                      <tr key={t.id} className={`border-t border-border/50 hover:bg-secondary/10 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-secondary/5'}`}
                        onClick={() => { setSelectedTable(t.id); setTab('detail') }}>
                        <td className="px-4 py-3 font-medium text-primary">{t.name}</td>
                        <td className="px-4 py-3">{t.records_count.toLocaleString('ru')}</td>
                        <td className="px-4 py-3">{t.columns_count}</td>
                        <td className="px-4 py-3 text-muted-foreground">{t.columns_count > 0 ? (t.records_count / t.columns_count).toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* === DETAIL TAB === */}
      {tab === 'detail' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium">Таблица:</label>
              <select
                value={selectedTable}
                onChange={e => setSelectedTable(e.target.value)}
                className="h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary min-w-[200px]"
              >
                <option value="">— Выберите таблицу —</option>
                {(data?.tables || []).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.records_count} записей)</option>
                ))}
              </select>
              {aggLoading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
            </div>
          </div>

          {tableAgg && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center"><Table2 className="h-5 w-5 text-blue-500" /></div>
                  <div><p className="text-xl font-bold">{tableAgg.table_name}</p><p className="text-xs text-muted-foreground">Таблица</p></div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center"><FileText className="h-5 w-5 text-emerald-500" /></div>
                  <div><p className="text-xl font-bold">{tableAgg.total_records.toLocaleString('ru')}</p><p className="text-xs text-muted-foreground">Записей</p></div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center"><Columns3 className="h-5 w-5 text-violet-500" /></div>
                  <div><p className="text-xl font-bold">{tableAgg.columns.length}</p><p className="text-xs text-muted-foreground">Полей анализировано</p></div>
                </div>
              </div>

              {/* Per-column analytics */}
              <div className="space-y-3">
                {tableAgg.columns.map(col => {
                  const isExpanded = expandedCol === col.column_id
                  const fillPct = col.count > 0 ? Math.round((col.non_empty / col.count) * 100) : 0
                  const topVals = col.top_values || []
                  const barData = topVals.slice(0, 8).map(v => ({ name: String(v.value).length > 15 ? String(v.value).slice(0, 15) + '…' : v.value, Кол: v.count }))

                  return (
                    <div key={col.column_id} className="rounded-xl border border-border bg-card overflow-hidden">
                      <button onClick={() => setExpandedCol(isExpanded ? null : col.column_id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors text-left">
                        <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-sm">{col.column_name}</span>
                          <span className="text-xs text-muted-foreground ml-2">({col.field_type})</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                          <span>Заполнено: {fillPct}%</span>
                          {col.sum !== null && <span>Σ {col.sum.toLocaleString('ru')}</span>}
                          {col.avg !== null && <span>μ {col.avg.toLocaleString('ru')}</span>}
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                          {/* Stats grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                            {[
                              { label: 'Всего', value: col.count },
                              { label: 'Заполнено', value: col.non_empty },
                              { label: 'Пусто', value: col.count - col.non_empty },
                              ...(col.sum !== null ? [{ label: 'Сумма', value: col.sum }] : []),
                              ...(col.avg !== null ? [{ label: 'Среднее', value: col.avg }] : []),
                              ...(col.min_val !== null ? [{ label: 'Мин', value: col.min_val }] : []),
                              ...(col.max_val !== null ? [{ label: 'Макс', value: col.max_val }] : []),
                            ].map((s, i) => (
                              <div key={i} className="rounded-lg bg-secondary/30 px-3 py-2">
                                <p className="text-xs text-muted-foreground">{s.label}</p>
                                <p className="text-sm font-semibold truncate">{typeof s.value === 'number' ? s.value.toLocaleString('ru') : s.value}</p>
                              </div>
                            ))}
                          </div>

                          {/* Fill bar */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground w-20">Заполнение</span>
                            <div className="flex-1 bg-secondary/50 rounded-full h-2.5 overflow-hidden">
                              <div className="h-2.5 rounded-full bg-primary transition-all" style={{ width: `${fillPct}%` }} />
                            </div>
                            <span className="text-xs font-medium w-10 text-right">{fillPct}%</span>
                          </div>

                          {/* Value distribution chart */}
                          {barData.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">Топ значений</p>
                              <ResponsiveContainer width="100%" height={140}>
                                <BarChart data={barData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={30} />
                                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                                  <Bar dataKey="Кол" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {!selectedTable && (
            <div className="text-center py-16 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Выберите таблицу для детальной аналитики</p>
            </div>
          )}
        </div>
      )}

      {/* === TIMELINE TAB === */}
      {tab === 'timeline' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3 flex-wrap">
            <Calendar className="h-4 w-4 text-primary" />
            <label className="text-sm font-medium">Период:</label>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => setTimelineDays(d)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${timelineDays === d ? 'bg-primary text-white' : 'border border-border hover:bg-secondary'}`}>
                {d} дн.
              </button>
            ))}
            {timelineLoading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
          </div>

          {timeline.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Создание записей по дням</h2>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={timeline} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 13 }} />
                  <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} name="Записей" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : !timelineLoading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Нет данных за выбранный период</p>
            </div>
          ) : null}
        </div>
      )}

      {(!data || data.tables_count === 0) && tab === 'overview' && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Нет данных для отчёта. Создайте таблицы и добавьте записи.</p>
        </div>
      )}
    </div>
  )
}
