import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, BarChart3, Bot, Database, FileText, HardDrive, Plus, ShieldAlert, Trash2, TrendingUp, Users } from 'lucide-react'

import type { SuperadminDashboard } from '@/lib/api'
import { PLAN_LABELS, formatBytes } from '../shared/constants'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  dashboard: SuperadminDashboard
}

type ModuleKey = 'overview' | 'growth' | 'finance' | 'security'

type ExpenseRow = {
  id: number
  name: string
  amount: number
}

const CHART_COLORS = ['#1d9bff', '#3eb4ff', '#7bc8ff', '#a7daff', '#cde9ff']

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  readonly: 'Только чтение',
  superadmin: 'Суперадмин',
}

const MODULE_LABELS: Record<string, string> = {
  organization: 'Организации',
  org_plan: 'Тарифы',
  org_ai_settings: 'AI-настройки',
  org_ai_usage: 'AI-лимиты',
  user: 'Пользователи',
  table: 'Таблицы',
  record: 'Записи',
  file: 'Файлы',
  auth: 'Авторизация',
  security: 'Безопасность',
}

const SECURITY_EVENT_LABELS: Record<string, string> = {
  login_failed: 'Ошибки входа',
  access_denied: 'Запреты доступа',
  token_anomaly: 'Проблемы с токенами',
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-2xl font-semibold leading-none">{Number(value || 0).toLocaleString('ru-RU')}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </div>
  )
}

function ModuleTabs({ value, onChange }: { value: ModuleKey; onChange: (v: ModuleKey) => void }) {
  const tabs: Array<{ key: ModuleKey; label: string }> = [
    { key: 'overview', label: 'Обзор' },
    { key: 'growth', label: 'Рост' },
    { key: 'finance', label: 'Финансы' },
    { key: 'security', label: 'Безопасность' },
  ]

  return (
    <div className="inline-flex rounded-xl border border-sidebar-border bg-sidebar-background p-1 gap-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`h-9 px-4 rounded-lg text-sm transition-colors ${
            value === t.key ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground hover:bg-sidebar-accent'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function SuperadminDashboardView({ dashboard }: Props) {
  const [module, setModule] = useState<ModuleKey>('overview')
  const [period, setPeriod] = useState<7 | 14 | 30>(30)
  const [planMode, setPlanMode] = useState<'count' | 'percent'>('count')
  const [retentionLimit, setRetentionLimit] = useState<5 | 10>(10)
  const [calcMonths, setCalcMonths] = useState<1 | 3 | 6 | 12>(1)
  const [percentCosts, setPercentCosts] = useState(10)
  const [incomeSource, setIncomeSource] = useState<'date' | 'manual'>('date')
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [selectedDateTo, setSelectedDateTo] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [manualIncome, setManualIncome] = useState<number>(0)
  const [loadedIncomeByDateRange, setLoadedIncomeByDateRange] = useState<number>(0)
  const [financeError, setFinanceError] = useState('')
  const [expenses, setExpenses] = useState<ExpenseRow[]>([
    { id: 1, name: 'Расход 1', amount: 0 },
    { id: 2, name: 'Расход 2', amount: 0 },
    { id: 3, name: 'Расход 3', amount: 0 },
  ])

  const analytics = dashboard.analytics || {}
  const funnel = analytics.funnel || {}
  const retention = analytics.retention || {}
  const engagement = analytics.engagement || {}
  const churnRisk = analytics.churn_risk || {}
  const limitsUsage = analytics.limits_usage || {}
  const security = analytics.security_anomalies || {}
  const dataQuality = analytics.data_quality || {}
  const aiAnalytics = analytics.ai_analytics || {}
  const exportImport = analytics.export_import || {}
  const geo = analytics.geo_timezones || {}
  const executive = analytics.executive_cards || {}
  const revenueDetailed = (analytics.revenue_detailed || {}) as any

  const activityByRole = (analytics.activity_by_role || []) as Array<{ role: string; events_30d: number }>
  const activityByModule = (analytics.activity_by_module || []) as Array<{ module: string; events_30d: number }>
  const retentionCohorts = ((retention.cohorts || []) as Array<any>).slice(-retentionLimit)
  const topLimits = (limitsUsage.orgs || []) as Array<any>
  const topChurn = (churnRisk.top_orgs || []) as Array<any>
  const secTop = (security.top || []) as Array<any>
  const secIps = (security.top_ips_24h || []) as Array<any>
  const revenueByPlan = (revenueDetailed.by_plan || []) as Array<any>
  const avgRevenuePerPaidOrg =
    Number(revenueDetailed.paid_orgs || 0) > 0 ? Number(revenueDetailed.month_total || 0) / Number(revenueDetailed.paid_orgs || 1) : 0

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

  const expensesMonthTotal = expenses.reduce((acc, e) => acc + Number(e.amount || 0), 0)
  const incomeMonth = Number(revenueDetailed.month_total || executive.mrr_proxy || 0)
  const incomeForCalcMonth = incomeSource === 'manual' ? Number(manualIncome || 0) : Number(loadedIncomeByDateRange || incomeMonth || 0)
  const incomePeriodForCalc = incomeForCalcMonth * calcMonths
  const fixedCostsPeriod = expensesMonthTotal * calcMonths
  const percentCostsPeriod = (incomePeriodForCalc * Number(percentCosts || 0)) / 100
  const totalCostsPeriod = fixedCostsPeriod + percentCostsPeriod
  const netProfitPeriod = incomePeriodForCalc - totalCostsPeriod
  const marginPct = incomePeriodForCalc > 0 ? (netProfitPeriod / incomePeriodForCalc) * 100 : 0

  const addExpense = () => {
    const maxId = expenses.reduce((m, e) => Math.max(m, e.id), 0)
    setExpenses((prev) => [...prev, { id: maxId + 1, name: `Расход ${maxId + 1}`, amount: 0 }])
  }

  const updateExpense = (id: number, patch: Partial<ExpenseRow>) => {
    setExpenses((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const removeExpense = (id: number) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }

  const loadIncomeFromDateRange = () => {
    setFinanceError('')
    const today = new Date().toISOString().slice(0, 10)
    if (!selectedDateFrom || !selectedDateTo) {
      setFinanceError('Выбери даты "от" и "до".')
      return
    }
    if (selectedDateFrom > selectedDateTo) {
      setFinanceError('Дата "от" не может быть больше даты "до".')
      return
    }
    if (selectedDateTo > today) {
      setFinanceError('Дата "до" не может быть из будущего.')
      return
    }
    // В текущей версии бэка доход отдается как актуальный срез.
    // На выбранный диапазон подгружаем доступный срез и используем его в калькуляторе.
    setLoadedIncomeByDateRange(incomeMonth)

    const from = new Date(selectedDateFrom)
    const to = new Date(selectedDateTo)
    const diffDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1)
    const approxMonths = Math.max(1, Math.ceil(diffDays / 30))
    if (approxMonths <= 1) setCalcMonths(1)
    else if (approxMonths <= 3) setCalcMonths(3)
    else if (approxMonths <= 6) setCalcMonths(6)
    else setCalcMonths(12)
  }

  const validateFinanceInputs = () => {
    const errors: string[] = []
    if (incomeSource === 'date') {
      const today = new Date().toISOString().slice(0, 10)
      if (!selectedDateFrom || !selectedDateTo) errors.push('Выбери даты "от" и "до".')
      if (selectedDateFrom && selectedDateTo && selectedDateFrom > selectedDateTo) errors.push('Дата "от" не может быть больше даты "до".')
      if (selectedDateTo && selectedDateTo > today) errors.push('Дата "до" не может быть из будущего.')
    }
    if (incomeSource === 'manual') {
      if (!Number.isFinite(manualIncome) || manualIncome < 0) errors.push('Сумма дохода должна быть числом от 0 и выше.')
      if (manualIncome > 1_000_000_000_000) errors.push('Сумма дохода слишком большая.')
    }
    if (!Number.isFinite(percentCosts) || percentCosts < 0 || percentCosts > 100) {
      errors.push('Процентный расход должен быть от 0 до 100.')
    }
    for (const row of expenses) {
      if (!row.name.trim()) errors.push('Название расхода не должно быть пустым.')
      if (!Number.isFinite(row.amount) || row.amount < 0) errors.push(`Сумма "${row.name}" должна быть от 0 и выше.`)
      if (row.amount > 1_000_000_000_000) errors.push(`Сумма "${row.name}" слишком большая.`)
    }
    setFinanceError(errors[0] || '')
    return errors.length === 0
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-semibold leading-none">Дашборд платформы</h2>
            <p className="mt-1 text-sm text-muted-foreground">Понятная сводка по росту, деньгам и рискам</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Хранилище</div>
            <div className="text-sm font-semibold">{formatBytes(dashboard.totals.storage_bytes || 0)}</div>
          </div>
          <ModuleTabs value={module} onChange={setModule} />
        </div>
      </div>

      {module === 'overview' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
              <div className="text-xs text-muted-foreground">Оценка выручки</div>
              <div className="text-xl font-semibold mt-1">{incomeMonth.toLocaleString('ru-RU')} ₽/мес</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
              <div className="text-xs text-muted-foreground">Рост (30 дней)</div>
              <div className="text-xl font-semibold mt-1">{Number(executive.growth_rate_pct || 0).toLocaleString('ru-RU')}%</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
              <div className="text-xs text-muted-foreground">Прирост организаций</div>
              <div className="text-xl font-semibold mt-1">{Number(executive.net_org_growth_30d || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-3">
              <div className="text-xs text-muted-foreground">Активные день/месяц</div>
              <div className="text-xl font-semibold mt-1">{Number(engagement.stickiness_pct || 0).toLocaleString('ru-RU')}%</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cards.map((c) => <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} />)}
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
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 10 }}
                          formatter={(v: any) => [Number(v).toLocaleString('ru-RU'), 'Регистрации']}
                        />
                        <Area type="monotone" dataKey="registrations" stroke="#1d9bff" strokeWidth={2} fill="url(#regFill)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2">
                      Всего: <span className="font-semibold">{registrationsTotal.toLocaleString('ru-RU')}</span>
                    </div>
                    <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2">
                      Пик: <span className="font-semibold">{registrationsPeak.toLocaleString('ru-RU')}</span>
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
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 10 }}
                          formatter={(v: any) => (planMode === 'count' ? [Number(v).toLocaleString('ru-RU'), 'Организаций'] : [`${v}%`, 'Доля'])}
                        />
                        <Bar dataKey={planMode === 'count' ? 'value' : 'percent'} radius={[6, 6, 0, 0]}>
                          {plansData.map((entry) => <Cell key={`bar-${entry.plan}`} fill={entry.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Tooltip
                          contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--sidebar-border))', borderRadius: 10 }}
                          formatter={(v: any, _n: any, e: any) => [`${Number(v).toLocaleString('ru-RU')} орг.`, e?.payload?.plan || '']}
                        />
                        <Pie data={plansData} dataKey="value" nameKey="plan" innerRadius={45} outerRadius={66} paddingAngle={3}>
                          {plansData.map((entry) => <Cell key={`pie-${entry.plan}`} fill={entry.fill} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {module === 'growth' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Путь организаций</h3>
              </div>
              {[
                { label: 'Зарегистрировались', value: Number(funnel.registered_orgs || 0), pct: 100 },
                { label: 'Активация', value: Number(funnel.activated_orgs || 0), pct: Number(funnel.activation_rate_pct || 0) },
                { label: '1-я таблица', value: Number(funnel.first_table_orgs || 0), pct: Number(funnel.table_conversion_pct || 0) },
                { label: '1-я запись', value: Number(funnel.first_record_orgs || 0), pct: Number(funnel.record_conversion_pct || 0) },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium">{row.value.toLocaleString('ru-RU')} · {row.pct.toLocaleString('ru-RU')}%</span>
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
                <h3 className="font-semibold">Активность</h3>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">За день</div>
                  <div className="text-lg font-semibold">{Number(engagement.dau || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">За неделю</div>
                  <div className="text-lg font-semibold">{Number(engagement.wau || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">За месяц</div>
                  <div className="text-lg font-semibold">{Number(engagement.mau || 0).toLocaleString('ru-RU')}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-xs mb-2">По ролям</div>
                  <div className="space-y-1.5">
                    {activityByRole.slice(0, 5).map((r) => (
                      <div key={r.role} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{ROLE_LABELS[r.role] || r.role}</span>
                        <span>{Number(r.events_30d || 0).toLocaleString('ru-RU')}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-xs mb-2">По разделам</div>
                  <div className="space-y-1.5">
                    {activityByModule.slice(0, 5).map((m) => (
                      <div key={m.module} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate mr-2">{MODULE_LABELS[m.module] || m.module}</span>
                        <span>{Number(m.events_30d || 0).toLocaleString('ru-RU')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Возврат по группам</h3>
                <div className="inline-flex rounded-lg border border-sidebar-border bg-sidebar-background p-1">
                  <button onClick={() => setRetentionLimit(5)} className={`h-7 px-3 rounded-md text-xs ${retentionLimit === 5 ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground'}`}>5</button>
                  <button onClick={() => setRetentionLimit(10)} className={`h-7 px-3 rounded-md text-xs ${retentionLimit === 10 ? 'bg-primary/12 text-primary border border-primary/30' : 'text-muted-foreground'}`}>10</button>
                </div>
              </div>
              {retentionCohorts.length === 0 ? (
                <SuperadminEmptyState icon={Users} title="Нет групп" description="Пока недостаточно данных." />
              ) : (
                <div className="space-y-2">
                  {retentionCohorts.map((c: any) => (
                    <div key={String(c.cohort)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-muted-foreground">{String(c.cohort)}</span>
                        <span>Размер: {Number(c.size || 0).toLocaleString('ru-RU')}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>1 день: <span className="font-semibold">{Number(c.d1_rate || 0)}%</span></div>
                        <div>7 дней: <span className="font-semibold">{Number(c.d7_rate || 0)}%</span></div>
                        <div>30 дней: <span className="font-semibold">{Number(c.d30_rate || 0)}%</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <h3 className="font-semibold">Организации с риском оттока</h3>
              {topChurn.length === 0 ? (
                <SuperadminEmptyState icon={ShieldAlert} title="Нет риск-организаций" description="Сейчас критичных рисков не видно." />
              ) : (
                <div className="space-y-2">
                  {topChurn.slice(0, 8).map((r: any) => (
                    <div key={String(r.org_id)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{String(r.org_name)}</span>
                        <span className="text-primary">Риск: {Number(r.score || 0)} / 100</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{Array.isArray(r.reasons) ? r.reasons.join(' · ') : '-'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {module === 'finance' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <h3 className="font-semibold">Доходы по тарифам</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-muted-foreground">В месяц</div>
                  <div className="text-base font-semibold mt-1">{Number(revenueDetailed.month_total || 0).toLocaleString('ru-RU')} ₽</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-muted-foreground">В год</div>
                  <div className="text-base font-semibold mt-1">{Number(revenueDetailed.year_total || 0).toLocaleString('ru-RU')} ₽</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-muted-foreground">Платящих</div>
                  <div className="text-base font-semibold mt-1">{Number(revenueDetailed.paid_orgs || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-muted-foreground">Средний доход/платящую орг</div>
                  <div className="text-base font-semibold mt-1">{avgRevenuePerPaidOrg.toLocaleString('ru-RU')} ₽</div>
                </div>
              </div>

              <div className="rounded-lg border border-sidebar-border bg-sidebar-background overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 text-xs text-muted-foreground border-b border-sidebar-border">
                  <div>Тариф</div>
                  <div>Орг.</div>
                  <div>Цена/мес</div>
                  <div>Доход/мес</div>
                </div>
                {(revenueByPlan.length ? revenueByPlan : []).map((row) => (
                  <div key={String(row.plan)} className="grid grid-cols-4 gap-2 px-3 py-2 text-sm border-b border-sidebar-border last:border-b-0">
                    <div>{PLAN_LABELS[String(row.plan)] || String(row.plan)}</div>
                    <div>{Number(row.orgs || 0).toLocaleString('ru-RU')}</div>
                    <div>{(Number(row.price_monthly || 0) / 100).toLocaleString('ru-RU')} ₽</div>
                    <div>{(Number(row.month_revenue || 0) / 100).toLocaleString('ru-RU')} ₽</div>
                  </div>
                ))}
                {revenueByPlan.length === 0 && <div className="p-4 text-sm text-muted-foreground">Нет данных по доходам.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <h3 className="font-semibold">Калькулятор дохода и расхода</h3>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setIncomeSource('date')
                    setFinanceError('')
                  }}
                  className={`h-9 rounded-lg border text-sm ${
                    incomeSource === 'date' ? 'border-primary/40 bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background'
                  }`}
                >
                  Подгрузить по дате
                </button>
                <button
                  onClick={() => {
                    setIncomeSource('manual')
                    setFinanceError('')
                  }}
                  className={`h-9 rounded-lg border text-sm ${
                    incomeSource === 'manual' ? 'border-primary/40 bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background'
                  }`}
                >
                  Ввести вручную
                </button>
              </div>

              {incomeSource === 'date' ? (
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Период для подгрузки</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">От</div>
                      <input
                        type="date"
                        value={selectedDateFrom}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setSelectedDateFrom(e.target.value)}
                        className="w-full rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">До</div>
                      <input
                        type="date"
                        value={selectedDateTo}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setSelectedDateTo(e.target.value)}
                        className="w-full rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={`${selectedDateFrom || '-'} — ${selectedDateTo || '-'}`}
                      className="w-full rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3 text-sm text-muted-foreground"
                    />
                    <button
                      onClick={loadIncomeFromDateRange}
                      className="h-10 px-3 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm whitespace-nowrap"
                    >
                      Подгрузить
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Сейчас для выбранного периода используется доступный срез дохода из системы.
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">Сумма дохода в месяц (₽)</div>
                  <input
                    type="number"
                    min={0}
                    value={manualIncome}
                    onChange={(e) => setManualIncome(Math.max(0, Number(e.target.value || 0)))}
                    className="w-full rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[1, 3, 6, 12].map((m) => (
                  <button
                    key={m}
                    onClick={() => setCalcMonths(m as 1 | 3 | 6 | 12)}
                    className={`h-9 rounded-lg border text-sm ${
                      calcMonths === m ? 'border-primary/40 bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background'
                    }`}
                  >
                    {m} мес
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3">
                <div className="text-xs text-muted-foreground mb-2">Процентный расход от дохода</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={percentCosts}
                  onChange={(e) => setPercentCosts(Number(e.target.value || 0))}
                  className="w-full rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3"
                />
              </div>

              <div className="space-y-2">
                {expenses.map((row) => (
                  <div key={row.id} className="grid grid-cols-12 gap-2">
                    <input
                      value={row.name}
                      onChange={(e) => updateExpense(row.id, { name: e.target.value })}
                      className="col-span-6 rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.amount}
                      onChange={(e) => updateExpense(row.id, { amount: Number(e.target.value || 0) })}
                      className="col-span-4 rounded-lg border border-sidebar-border bg-sidebar-background h-10 px-3 text-sm"
                    />
                    <button
                      onClick={() => removeExpense(row.id)}
                      className="col-span-2 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center"
                      title="Удалить"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addExpense}
                  className="h-10 px-3 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm inline-flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Добавить расход
                </button>
              </div>

              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3 space-y-2 text-sm">
                {financeError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {financeError}
                  </div>
                )}
                <button
                  onClick={validateFinanceInputs}
                  className="h-9 px-3 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-xs"
                >
                  Проверить данные
                </button>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Доход за период</span>
                  <span>{incomePeriodForCalc.toLocaleString('ru-RU')} ₽</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Постоянные расходы</span>
                  <span>{fixedCostsPeriod.toLocaleString('ru-RU')} ₽</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Процентные расходы</span>
                  <span>{percentCostsPeriod.toLocaleString('ru-RU')} ₽</span>
                </div>
                <div className="flex items-center justify-between border-t border-sidebar-border pt-2 font-semibold">
                  <span>Чистый итог</span>
                  <span>{netProfitPeriod.toLocaleString('ru-RU')} ₽</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Маржа</span>
                  <span>{marginPct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4">
            <h3 className="font-semibold mb-3">Кто близко к лимитам</h3>
            {topLimits.length === 0 ? (
              <SuperadminEmptyState icon={Database} title="Нет данных" description="Нет организаций для анализа лимитов." />
            ) : (
              <div className="space-y-2">
                {topLimits.slice(0, 8).map((o: any) => (
                  <div key={String(o.org_id)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{String(o.org_name)}</span>
                      <span>{o.eta_days_to_limit == null ? 'Без прогноза' : `${Number(o.eta_days_to_limit).toLocaleString('ru-RU')} дн.`}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.tables_usage_pct || 0))}%` }} /></div>
                      <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.records_usage_pct || 0))}%` }} /></div>
                      <div className="h-1.5 rounded-full bg-sidebar-accent overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Number(o.storage_usage_pct || 0))}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {module === 'security' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Подозрительные события</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                {secTop.map((a: any) => (
                  <div key={String(a.action)} className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                    <div className="text-xs text-muted-foreground">{SECURITY_EVENT_LABELS[String(a.action)] || String(a.action)}</div>
                    <div className="text-lg font-semibold mt-1">{Number(a.last_24h || 0).toLocaleString('ru-RU')}</div>
                    <div className="text-xs mt-1">Изменение: {Number(a.growth_pct || 0).toLocaleString('ru-RU')}%</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                <div className="text-xs mb-2">IP с наибольшим числом событий (24ч)</div>
                <div className="space-y-1">
                  {secIps.slice(0, 8).map((ip: any) => (
                    <div key={String(ip.ip)} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{String(ip.ip)}</span>
                      <span>{Number(ip.events || 0).toLocaleString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
              <h3 className="font-semibold">Качество данных и операции</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">Пустые/невалидные поля</div>
                  <div className="text-lg font-semibold">{Number(dataQuality.empty_or_invalid_rate_pct || 0).toLocaleString('ru-RU')}%</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">Группы дублей</div>
                  <div className="text-lg font-semibold">{Number(dataQuality.duplicate_groups || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">Экспорт (30д)</div>
                  <div className="text-lg font-semibold">{Number(exportImport.export_count_30d || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">Импорт (30д)</div>
                  <div className="text-lg font-semibold">{Number(exportImport.import_count_30d || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">AI запросов на пользователя</div>
                  <div className="text-lg font-semibold">{Number(aiAnalytics.requests_per_user_30d || 0).toLocaleString('ru-RU')}</div>
                </div>
                <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                  <div className="text-[11px] text-muted-foreground">AI токенов на запрос</div>
                  <div className="text-lg font-semibold">{Number(aiAnalytics.avg_tokens_per_request_30d || 0).toLocaleString('ru-RU')}</div>
                </div>
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2">
                <div className="text-xs mb-2">Часовые пояса</div>
                <div className="flex flex-wrap gap-1">
                  {((geo.top_timezones || []) as Array<any>).slice(0, 12).map((tz) => (
                    <span key={String(tz.timezone)} className="px-2 py-1 rounded-full border border-sidebar-border bg-sidebar-accent text-xs">
                      {String(tz.timezone)} · {Number(tz.users || 0).toLocaleString('ru-RU')}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-2 text-xs text-muted-foreground">
                Скорость и ошибки API: точные значения появятся после подключения источника метрик.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
