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
import { Activity, BarChart3, Bot, Database, FileText, HardDrive, ShieldAlert, TrendingUp, Users } from 'lucide-react'

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
  const [retentionLimit, setRetentionLimit] = useState<5 | 10>(10)

  const cards = [
    { label: 'Организаций', value: dashboard.totals.orgs, icon: BarChart3 },
    { label: 'Пользователей', value: dashboard.totals.users, icon: Users },
    { label: 'Таблиц', value: dashboard.totals.tables, icon: Database },
    { label: 'Записей', value: dashboard.totals.records, icon: FileText },
    { label: 'Файлов', value: dashboard.totals.files, icon: HardDrive },
    { label: 'AI токенов', value: dashboard.totals.ai_tokens, icon: Bot },
  ]
  const analytics = dashboard.analytics || {}
  const funnel = analytics.funnel || {}
  const retention = analytics.retention || {}
  const engagement = analytics.engagement || {}
  const churnRisk = analytics.churn_risk || {}
  const tariff = analytics.tariff_analytics || {}
  const limitsUsage = analytics.limits_usage || {}
  const security = analytics.security_anomalies || {}
  const dataQuality = analytics.data_quality || {}
  const aiAnalytics = analytics.ai_analytics || {}
  const exportImport = analytics.export_import || {}
  const geo = analytics.geo_timezones || {}
  const executive = analytics.executive_cards || {}
  const activityByRole = (analytics.activity_by_role || []) as Array<{ role: string; events_30d: number }>
  const activityByModule = (analytics.activity_by_module || []) as Array<{ module: string; events_30d: number }>
  const retentionCohorts = ((retention.cohorts || []) as Array<any>).slice(-retentionLimit)
  const topLimits = (limitsUsage.orgs || []) as Array<any>
  const topChurn = (churnRisk.top_orgs || []) as Array<any>
  const secTop = (security.top || []) as Array<any>
  const secIps = (security.top_ips_24h || []) as Array<any>

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
          <div className="text-xs text-muted-foreground">MRR-like proxy</div>
          <div className="text-xl font-semibold mt-1">{Number(executive.mrr_proxy || 0).toLocaleString('ru-RU')} $</div>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
          <div className="text-xs text-muted-foreground">Рост (30д)</div>
          <div className="text-xl font-semibold mt-1">{Number(executive.growth_rate_pct || 0).toLocaleString('ru-RU')}%</div>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
          <div className="text-xs text-muted-foreground">Net org growth</div>
          <div className="text-xl font-semibold mt-1">{Number(executive.net_org_growth_30d || 0).toLocaleString('ru-RU')}</div>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
          <div className="text-xs text-muted-foreground">Stickiness (DAU/MAU)</div>
          <div className="text-xl font-semibold mt-1">{Number(engagement.stickiness_pct || 0).toLocaleString('ru-RU')}%</div>
        </div>
      </div>

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
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Воронка: регистрация → активация → 1-я таблица → 1-я запись</h3>
          </div>
          {[
            { label: 'Регистрации (org)', value: Number(funnel.registered_orgs || 0), pct: 100 },
            { label: 'Активация', value: Number(funnel.activated_orgs || 0), pct: Number(funnel.activation_rate_pct || 0) },
            { label: '1-я таблица', value: Number(funnel.first_table_orgs || 0), pct: Number(funnel.table_conversion_pct || 0) },
            { label: '1-я запись', value: Number(funnel.first_record_orgs || 0), pct: Number(funnel.record_conversion_pct || 0) },
          ].map((row) => (
            <div key={row.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">
                  {row.value.toLocaleString('ru-RU')} · {row.pct.toLocaleString('ru-RU')}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-sidebar-accent overflow-hidden">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Активность: WAU/MAU, роли, модули</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">DAU</div>
              <div className="text-lg font-semibold">{Number(engagement.dau || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">WAU</div>
              <div className="text-lg font-semibold">{Number(engagement.wau || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">MAU</div>
              <div className="text-lg font-semibold">{Number(engagement.mau || 0).toLocaleString('ru-RU')}</div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-xs mb-2">По ролям</div>
              <div className="space-y-1.5">
                {activityByRole.slice(0, 4).map((r) => (
                  <div key={r.role} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{r.role}</span>
                    <span>{Number(r.events_30d || 0).toLocaleString('ru-RU')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-xs mb-2">По модулям</div>
              <div className="space-y-1.5">
                {activityByModule.slice(0, 4).map((m) => (
                  <div key={m.module} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate mr-2">{m.module}</span>
                    <span>{Number(m.events_30d || 0).toLocaleString('ru-RU')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Retention по когортам (org)</h3>
            <div className="inline-flex rounded-lg border border-sidebar-border bg-sidebar-background p-1">
              <button
                onClick={() => setRetentionLimit(5)}
                className={`h-7 px-3 rounded-md text-xs ${retentionLimit === 5 ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground'}`}
              >
                5
              </button>
              <button
                onClick={() => setRetentionLimit(10)}
                className={`h-7 px-3 rounded-md text-xs ${retentionLimit === 10 ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground'}`}
              >
                10
              </button>
            </div>
          </div>
          {retentionCohorts.length === 0 ? (
            <SuperadminEmptyState icon={Users} title="Нет когорт" description="Пока недостаточно данных для retention." />
          ) : (
            <div className="space-y-2">
              {retentionCohorts.map((c: any) => (
                <div key={String(c.cohort)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-muted-foreground">{String(c.cohort)}</span>
                    <span>Size: {Number(c.size || 0).toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>D1: <span className="font-semibold">{Number(c.d1_rate || 0)}%</span></div>
                    <div>D7: <span className="font-semibold">{Number(c.d7_rate || 0)}%</span></div>
                    <div>D30: <span className="font-semibold">{Number(c.d30_rate || 0)}%</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Security anomalies</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {secTop.map((a: any) => (
              <div key={String(a.action)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                <div className="text-xs text-muted-foreground">{String(a.action)}</div>
                <div className="text-lg font-semibold mt-1">{Number(a.last_24h || 0).toLocaleString('ru-RU')}</div>
                <div className="text-xs mt-1">Δ {Number(a.growth_pct || 0).toLocaleString('ru-RU')}%</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
            <div className="text-xs mb-2">Top IP (24h)</div>
            <div className="space-y-1">
              {secIps.slice(0, 5).map((ip: any) => (
                <div key={String(ip.ip)} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground">{String(ip.ip)}</span>
                  <span>{Number(ip.events || 0).toLocaleString('ru-RU')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <h3 className="font-semibold">Тарифы и лимиты</h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">free→team</div>
              <div className="text-lg font-semibold">{Number(tariff.free_to_team_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">free→business</div>
              <div className="text-lg font-semibold">{Number(tariff.free_to_business_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">TTU (дни)</div>
              <div className="text-lg font-semibold">{Number(tariff.median_time_to_upgrade_days || 0).toLocaleString('ru-RU')}</div>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
            <div className="text-xs mb-2">Кто близко к лимитам</div>
            <div className="space-y-2">
              {topLimits.slice(0, 5).map((o: any) => (
                <div key={String(o.org_id)} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground truncate mr-2">{String(o.org_name)}</span>
                    <span>{Number(o.eta_days_to_limit || 0).toLocaleString('ru-RU')} дн.</span>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.tables_usage_pct || 0))}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.records_usage_pct || 0))}%` }} />
                    </div>
                    <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.storage_usage_pct || 0))}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <h3 className="font-semibold">AI / Export / Data quality / SLA</h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">AI req/user (30д)</div>
              <div className="text-lg font-semibold">{Number(aiAnalytics.requests_per_user_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">AI tokens/request</div>
              <div className="text-lg font-semibold">{Number(aiAnalytics.avg_tokens_per_request_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">Export (30д)</div>
              <div className="text-lg font-semibold">{Number(exportImport.export_count_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">Import (30д)</div>
              <div className="text-lg font-semibold">{Number(exportImport.import_count_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">Пустые/невалидные поля</div>
              <div className="text-lg font-semibold">{Number(dataQuality.empty_or_invalid_rate_pct || 0).toLocaleString('ru-RU')}%</div>
            </div>
            <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
              <div className="text-[11px] text-muted-foreground">Duplicate groups</div>
              <div className="text-lg font-semibold">{Number(dataQuality.duplicate_groups || 0).toLocaleString('ru-RU')}</div>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2 text-xs text-muted-foreground">
            SLA backend: реальный p95/p99/error-rate включается после подключения Prometheus API в backend.
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
            <div className="text-xs mb-2">Timezone (top)</div>
            <div className="flex flex-wrap gap-1">
              {((geo.top_timezones || []) as Array<any>).slice(0, 8).map((tz) => (
                <span key={String(tz.timezone)} className="px-2 py-1 rounded-full border border-sidebar-border bg-sidebar-accent text-xs">
                  {String(tz.timezone)} · {Number(tz.users || 0).toLocaleString('ru-RU')}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
        <h3 className="font-semibold">Churn risk (top)</h3>
        {topChurn.length === 0 ? (
          <SuperadminEmptyState icon={ShieldAlert} title="Нет риск-организаций" description="Риски не выявлены по текущим правилам." />
        ) : (
          <div className="space-y-2">
            {topChurn.slice(0, 6).map((r: any) => (
              <div key={String(r.org_id)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{String(r.org_name)}</span>
                  <span className="text-primary">score {Number(r.score || 0)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{Array.isArray(r.reasons) ? r.reasons.join(' · ') : '-'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
