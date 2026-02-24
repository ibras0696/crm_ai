import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Bot, Database, FileText, HardDrive, Users } from 'lucide-react'

import type { SuperadminDashboard } from '@/lib/api'
import { PLAN_LABELS, formatBytes } from '../shared/constants'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  dashboard: SuperadminDashboard
}

const CHART_COLORS = ['#1d9bff', '#3eb4ff', '#7bc8ff', '#a7daff', '#cde9ff']

export function SuperadminDashboardView({ dashboard }: Props) {
  const [period, setPeriod] = useState<7 | 14 | 30>(30)
  const [planMode, setPlanMode] = useState<'count' | 'percent'>('count')

  const cards = [
    { label: 'Организаций', value: dashboard.totals.orgs, icon: BarChart3 },
    { label: 'Пользователей', value: dashboard.totals.users, icon: Users },
    { label: 'Таблиц', value: dashboard.totals.tables, icon: Database },
    { label: 'Записей', value: dashboard.totals.records, icon: FileText },
    { label: 'Файлов', value: dashboard.totals.files, icon: HardDrive },
    { label: 'AI токенов', value: dashboard.totals.ai_tokens, icon: Bot },
  ]

  const registrationData = useMemo(() => {
    const src = dashboard.registrations_timeline.slice(-period)
    return src.map((r) => ({
      date: r.date.slice(5),
      fullDate: r.date,
      registrations: Number(r.count || 0),
    }))
  }, [dashboard.registrations_timeline, period])

  const plansData = useMemo(() => {
    const total = Math.max(1, dashboard.orgs_by_plan.reduce((acc, p) => acc + Number(p.count || 0), 0))
    return dashboard.orgs_by_plan.map((p, i) => ({
      plan: PLAN_LABELS[p.plan] || p.plan,
      value: Number(p.count || 0),
      percent: Number((((Number(p.count || 0) / total) * 100).toFixed(1))),
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }))
  }, [dashboard.orgs_by_plan])

  const registrationsTotal = registrationData.reduce((acc, p) => acc + p.registrations, 0)
  const registrationsPeak = Math.max(...registrationData.map((p) => p.registrations), 0)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold leading-none">Дашборд платформы</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ключевые метрики, динамика регистраций и структура тарифов</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Хранилище</div>
            <div className="text-sm font-semibold">{formatBytes(dashboard.totals.storage_bytes || 0)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <c.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-semibold leading-none">{Number(c.value || 0).toLocaleString('ru-RU')}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Регистрации</h3>
            <div className="inline-flex rounded-lg border border-sidebar-border bg-sidebar-background p-1">
              {[7, 14, 30].map((n) => (
                <button
                  key={n}
                  onClick={() => setPeriod(n as 7 | 14 | 30)}
                  className={`h-8 px-3 rounded-md text-xs transition-colors ${
                    period === n ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-sidebar-accent'
                  }`}
                >
                  {n}д
                </button>
              ))}
            </div>
          </div>

          {registrationData.length === 0 ? (
            <SuperadminEmptyState icon={BarChart3} title="Нет данных регистраций" description="Пока нет событий в выбранном периоде." />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={registrationData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="regFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1d9bff" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#1d9bff" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(120,140,170,0.15)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fill: '#8fa0bb', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: '#8fa0bb', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--sidebar-border))',
                        borderRadius: 10,
                        color: 'hsl(var(--foreground))',
                      }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(v: any) => [Number(v).toLocaleString('ru-RU'), 'Регистрации']}
                      labelFormatter={(l: any) => `Дата: ${l}`}
                    />
                    <Area type="monotone" dataKey="registrations" stroke="#1d9bff" strokeWidth={2} fill="url(#regFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2">
                  Всего за период: <span className="font-semibold">{registrationsTotal.toLocaleString('ru-RU')}</span>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2">
                  Пиковый день: <span className="font-semibold">{registrationsPeak.toLocaleString('ru-RU')}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Организации по тарифам</h3>
            <div className="inline-flex rounded-lg border border-sidebar-border bg-sidebar-background p-1">
              <button
                onClick={() => setPlanMode('count')}
                className={`h-8 px-3 rounded-md text-xs transition-colors ${
                  planMode === 'count' ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-sidebar-accent'
                }`}
              >
                Кол-во
              </button>
              <button
                onClick={() => setPlanMode('percent')}
                className={`h-8 px-3 rounded-md text-xs transition-colors ${
                  planMode === 'percent' ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-sidebar-accent'
                }`}
              >
                %
              </button>
            </div>
          </div>

          {plansData.length === 0 ? (
            <SuperadminEmptyState icon={Database} title="Нет данных по тарифам" description="Организации еще не распределены по планам." />
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={plansData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(120,140,170,0.15)" strokeDasharray="3 3" />
                    <XAxis dataKey="plan" tick={{ fill: '#8fa0bb', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: '#8fa0bb', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--sidebar-border))',
                        borderRadius: 10,
                        color: 'hsl(var(--foreground))',
                      }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(v: any, _n: any, e: any) =>
                        planMode === 'count'
                          ? [Number(v).toLocaleString('ru-RU'), 'Организаций']
                          : [`${e?.payload?.percent ?? 0}%`, 'Доля']
                      }
                    />
                    <Bar dataKey={planMode === 'count' ? 'value' : 'percent'} radius={[6, 6, 0, 0]}>
                      {plansData.map((entry) => (
                        <Cell key={`bar-${entry.plan}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--sidebar-border))',
                        borderRadius: 10,
                        color: 'hsl(var(--foreground))',
                      }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      formatter={(v: any, _n: any, e: any) => [`${Number(v).toLocaleString('ru-RU')} орг.`, e?.payload?.plan || '']}
                    />
                    <Pie data={plansData} dataKey="value" nameKey="plan" innerRadius={45} outerRadius={66} paddingAngle={3}>
                      {plansData.map((entry) => (
                        <Cell key={`pie-${entry.plan}`} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
