import { useCallback, useEffect, useMemo, useState, type ElementType } from 'react'
import axios from 'axios'
import {
  Shield,
  Users,
  Database,
  FileText,
  Bot,
  BarChart3,
  Building2,
  LogOut,
  RefreshCw,
  TrendingUp,
  HardDrive,
  Crown,
  Zap,
  Table2,
} from 'lucide-react'

const SA_TOKEN_KEY = 'sa_access_token'

const saApi = axios.create({ baseURL: '/api/v1/superadmin' })
saApi.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(SA_TOKEN_KEY)
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

type Tab = 'dashboard' | 'orgs' | 'users' | 'ai'

interface Dashboard {
  totals: {
    orgs: number
    users: number
    tables: number
    records: number
    files: number
    storage_bytes: number
    ai_requests: number
    ai_tokens: number
  }
  registrations_timeline: { date: string; count: number }[]
  orgs_by_plan: { plan: string; count: number }[]
}

interface Org {
  id: string
  name: string
  slug: string
  plan: string
  created_at: string
  members: number
  tables: number
  records: number
}

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  created_at: string
  orgs: { org_id: string; role: string }[]
}

interface AIUsage {
  org_id: string
  org_name: string
  requests: number
  tokens: number
}

interface AIConfig {
  provider: string
  base_url: string
  official_provider_docs_url?: string
  model: string
  key_configured: boolean
  key_prefix: string
}

const EMPTY_DASHBOARD: Dashboard = {
  totals: { orgs: 0, users: 0, tables: 0, records: 0, files: 0, storage_bytes: 0, ai_requests: 0, ai_tokens: 0 },
  registrations_timeline: [],
  orgs_by_plan: [],
}

function toNumber(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function normalizeDashboard(input: unknown): Dashboard {
  if (!input || typeof input !== 'object') return EMPTY_DASHBOARD
  const raw = input as any
  const totals = raw.totals && typeof raw.totals === 'object' ? raw.totals : {}
  return {
    totals: {
      orgs: toNumber(totals.orgs),
      users: toNumber(totals.users),
      tables: toNumber(totals.tables),
      records: toNumber(totals.records),
      files: toNumber(totals.files),
      storage_bytes: toNumber(totals.storage_bytes),
      ai_requests: toNumber(totals.ai_requests),
      ai_tokens: toNumber(totals.ai_tokens),
    },
    registrations_timeline: Array.isArray(raw.registrations_timeline)
      ? raw.registrations_timeline
          .filter((r: any) => r && typeof r === 'object')
          .map((r: any) => ({ date: String(r.date || ''), count: toNumber(r.count) }))
      : [],
    orgs_by_plan: Array.isArray(raw.orgs_by_plan)
      ? raw.orgs_by_plan
          .filter((r: any) => r && typeof r === 'object')
          .map((r: any) => ({ plan: String(r.plan || 'free'), count: toNumber(r.count) }))
      : [],
  }
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Бесплатный',
  team: 'Команда',
  business: 'Бизнес',
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-secondary text-muted-foreground',
  team: 'bg-blue-500/10 text-blue-500',
  business: 'bg-amber-500/10 text-amber-500',
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} Б`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} КБ`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} МБ`
  return `${(b / 1073741824).toFixed(1)} ГБ`
}

export default function SuperAdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(SA_TOKEN_KEY) || '')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [logging, setLogging] = useState(false)

  const [tab, setTab] = useState<Tab>('dashboard')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [aiUsage, setAiUsage] = useState<AIUsage[]>([])
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [changingPlan, setChangingPlan] = useState<string | null>(null)

  const viewDashboard = dashboard || EMPTY_DASHBOARD
  const safeTab: Tab = tab === 'dashboard' || tab === 'orgs' || tab === 'users' || tab === 'ai' ? tab : 'dashboard'

  const resetData = () => {
    setDashboard(null)
    setOrgs([])
    setUsers([])
    setAiUsage([])
    setAiConfig(null)
  }

  const handleAuthError = () => {
    localStorage.removeItem(SA_TOKEN_KEY)
    setToken('')
    resetData()
    setLoadError('Сессия superadmin истекла. Войдите снова.')
  }

  const handleLogin = async () => {
    setLogging(true)
    setLoginError('')
    try {
      const r = await axios.post('/api/v1/superadmin/login', { email: loginEmail, password: loginPass })
      if (r.data.ok && r.data.data?.access_token) {
        localStorage.setItem(SA_TOKEN_KEY, r.data.data.access_token)
        setToken(r.data.data.access_token)
        setLoadError('')
      } else {
        setLoginError(r.data.error?.message || 'Ошибка входа')
      }
    } catch (e: any) {
      setLoginError(e?.response?.data?.error?.message || 'Ошибка соединения')
    } finally {
      setLogging(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(SA_TOKEN_KEY)
    setToken('')
    resetData()
  }

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const r = await saApi.get('/dashboard')
      if (r.data.ok) setDashboard(normalizeDashboard(r.data.data))
    } catch (e: any) {
      if (e?.response?.status === 401) handleAuthError()
      else setLoadError('Не удалось загрузить дашборд.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOrgs = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const r = await saApi.get('/orgs?limit=100')
      if (r.data.ok) setOrgs(r.data.data)
    } catch (e: any) {
      if (e?.response?.status === 401) handleAuthError()
      else setLoadError('Не удалось загрузить организации.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const r = await saApi.get('/users?limit=100')
      if (r.data.ok) setUsers(r.data.data)
    } catch (e: any) {
      if (e?.response?.status === 401) handleAuthError()
      else setLoadError('Не удалось загрузить пользователей.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAI = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [usageResp, cfgResp] = await Promise.all([saApi.get('/ai-usage'), saApi.get('/ai-config')])
      if (usageResp.data.ok) setAiUsage(usageResp.data.data)
      if (cfgResp.data.ok) setAiConfig(cfgResp.data.data as AIConfig)
    } catch (e: any) {
      if (e?.response?.status === 401) handleAuthError()
      else setLoadError('Не удалось загрузить AI раздел.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    if (safeTab === 'dashboard') loadDashboard()
    if (safeTab === 'orgs') loadOrgs()
    if (safeTab === 'users') loadUsers()
    if (safeTab === 'ai') loadAI()
  }, [token, safeTab, loadDashboard, loadOrgs, loadUsers, loadAI])

  const handleSetPlan = async (orgId: string, plan: string) => {
    setChangingPlan(orgId)
    try {
      await saApi.patch(`/orgs/${orgId}/plan`, { plan })
      await loadOrgs()
    } catch {
      // ignore
    } finally {
      setChangingPlan(null)
    }
  }

  const totalAiTokens = useMemo(() => aiUsage.reduce((s, r) => s + r.tokens, 0), [aiUsage])

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Shield className="h-8 w-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold">Суперадмин</h1>
            <p className="text-sm text-muted-foreground mt-1">Панель управления платформой</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="admin@example.com"
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Пароль</label>
              <input
                type="password"
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="••••••••"
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
              />
            </div>
            {loginError && <p className="text-sm text-destructive">{loginError}</p>}
            {loadError && <p className="text-sm text-destructive">{loadError}</p>}
            <button
              onClick={handleLogin}
              disabled={logging || !loginEmail || !loginPass}
              className="w-full h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {logging ? 'Вход...' : 'Войти'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: ElementType }[] = [
    { key: 'dashboard', label: 'Дашборд', icon: BarChart3 },
    { key: 'orgs', label: 'Организации', icon: Building2 },
    { key: 'users', label: 'Пользователи', icon: Users },
    { key: 'ai', label: 'AI использование', icon: Bot },
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="font-bold text-sm">Суперадмин панель</span>
        </div>
        <div className="flex-1 flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            if (safeTab === 'dashboard') loadDashboard()
            if (safeTab === 'orgs') loadOrgs()
            if (safeTab === 'users') loadUsers()
            if (safeTab === 'ai') loadAI()
          }}
          disabled={loading}
          className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button onClick={handleLogout} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive">
          <LogOut className="h-4 w-4" /> Выйти
        </button>
      </div>

      <div className="p-6 max-w-7xl mx-auto space-y-4">
        {loadError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {safeTab === 'dashboard' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Общая статистика платформы</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Организации', value: viewDashboard.totals.orgs, icon: Building2, color: 'text-blue-500', bg: 'bg-blue-500/10' },
                { label: 'Пользователи', value: viewDashboard.totals.users, icon: Users, color: 'text-violet-500', bg: 'bg-violet-500/10' },
                { label: 'Таблицы', value: viewDashboard.totals.tables, icon: Table2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
                { label: 'Записи', value: viewDashboard.totals.records, icon: FileText, color: 'text-amber-500', bg: 'bg-amber-500/10' },
                { label: 'Файлы', value: viewDashboard.totals.files, icon: HardDrive, color: 'text-rose-500', bg: 'bg-rose-500/10' },
                { label: 'Хранилище', value: formatBytes(viewDashboard.totals.storage_bytes), icon: Database, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
                { label: 'AI запросов', value: viewDashboard.totals.ai_requests, icon: Bot, color: 'text-fuchsia-500', bg: 'bg-fuchsia-500/10' },
                { label: 'AI токенов', value: viewDashboard.totals.ai_tokens.toLocaleString('ru'), icon: Zap, color: 'text-orange-500', bg: 'bg-orange-500/10' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-xl ${card.bg} flex items-center justify-center`}>
                    <card.icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  <div>
                    <p className="text-xl font-bold">{typeof card.value === 'number' ? card.value.toLocaleString('ru') : card.value}</p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><Crown className="h-4 w-4 text-primary" /> Организации по тарифам</h3>
                <div className="space-y-3">
                  {viewDashboard.orgs_by_plan.length === 0 && <p className="text-sm text-muted-foreground">Нет данных</p>}
                  {viewDashboard.orgs_by_plan.map((p) => (
                    <div key={p.plan} className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_COLORS[p.plan] || 'bg-secondary text-muted-foreground'}`}>
                        {PLAN_LABELS[p.plan] || p.plan}
                      </span>
                      <div className="flex-1 bg-secondary/50 rounded-full h-2 overflow-hidden">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (p.count / Math.max(1, viewDashboard.totals.orgs)) * 100)}%` }} />
                      </div>
                      <span className="text-sm font-bold w-8 text-right">{p.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Регистрации (30 дней)</h3>
                {viewDashboard.registrations_timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Нет данных</p>
                ) : (
                  <div className="flex items-end gap-1 h-32">
                    {(() => {
                      const max = Math.max(...viewDashboard.registrations_timeline.map((r) => r.count), 1)
                      return viewDashboard.registrations_timeline.slice(-30).map((r, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                          <div className="w-full rounded-t bg-primary/60 hover:bg-primary" style={{ height: `${Math.max(4, (r.count / max) * 100)}%` }} />
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-popover border border-border rounded px-1.5 py-0.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100">
                            {r.date}: {r.count}
                          </div>
                        </div>
                      ))
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {safeTab === 'orgs' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Организации ({orgs.length})</h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="px-4 py-3 text-left">Название</th>
                    <th className="px-4 py-3 text-left">Тариф</th>
                    <th className="px-4 py-3 text-center">Участники</th>
                    <th className="px-4 py-3 text-center">Таблицы</th>
                    <th className="px-4 py-3 text-center">Записи</th>
                    <th className="px-4 py-3 text-left">Создана</th>
                    <th className="px-4 py-3 text-left">Сменить тариф</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org, i) => (
                    <tr key={org.id} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/5'}`}>
                      <td className="px-4 py-3"><p className="font-medium">{org.name}</p><p className="text-xs text-muted-foreground">{org.slug}</p></td>
                      <td className="px-4 py-3"><span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLAN_COLORS[org.plan] || 'bg-secondary text-muted-foreground'}`}>{PLAN_LABELS[org.plan] || org.plan}</span></td>
                      <td className="px-4 py-3 text-center">{org.members}</td>
                      <td className="px-4 py-3 text-center">{org.tables}</td>
                      <td className="px-4 py-3 text-center">{org.records.toLocaleString('ru')}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{org.created_at ? new Date(org.created_at).toLocaleDateString('ru') : '—'}</td>
                      <td className="px-4 py-3">
                        <select value={org.plan} disabled={changingPlan === org.id} onChange={(e) => handleSetPlan(org.id, e.target.value)} className="h-7 rounded border border-input bg-background px-2 text-xs">
                          <option value="free">Бесплатный</option>
                          <option value="team">Команда</option>
                          <option value="business">Бизнес</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orgs.length === 0 && !loading && <div className="text-center py-12 text-muted-foreground">Нет организаций</div>}
            </div>
          </div>
        )}

        {safeTab === 'users' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">Пользователи ({users.length})</h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="px-4 py-3 text-left">Пользователь</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-center">Статус</th>
                    <th className="px-4 py-3 text-center">Орг.</th>
                    <th className="px-4 py-3 text-left">Зарегистрирован</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.id} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/5'}`}>
                      <td className="px-4 py-3 font-medium">{u.first_name} {u.last_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
                          {u.is_active ? 'Активен' : 'Заблокирован'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">{u.orgs.length}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{u.created_at ? new Date(u.created_at).toLocaleDateString('ru') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && !loading && <div className="text-center py-12 text-muted-foreground">Нет пользователей</div>}
            </div>
          </div>
        )}

        {safeTab === 'ai' && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">AI использование по организациям</h2>
            {aiConfig && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-semibold mb-3">AI конфигурация (только superadmin)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground mb-1">Провайдер</p><p className="font-medium">{aiConfig.provider}</p></div>
                  <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground mb-1">Модель</p><p className="font-medium">{aiConfig.model}</p></div>
                  <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground mb-1">API ключ</p><p className="font-medium">{aiConfig.key_configured ? aiConfig.key_prefix : 'не задан'}</p></div>
                  <div className="rounded-lg border border-border p-3 sm:col-span-2 lg:col-span-3">
                    <p className="text-xs text-muted-foreground mb-1">Base URL</p>
                    <p className="font-medium break-all">{aiConfig.base_url}</p>
                    <p className="text-xs text-muted-foreground mt-1">Документация провайдера: {aiConfig.official_provider_docs_url || 'не указана'}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="px-4 py-3 text-left">Организация</th>
                    <th className="px-4 py-3 text-center">Запросов</th>
                    <th className="px-4 py-3 text-center">Токенов</th>
                    <th className="px-4 py-3 text-left">Доля токенов</th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.map((row, i) => {
                    const pct = totalAiTokens > 0 ? (row.tokens / totalAiTokens) * 100 : 0
                    return (
                      <tr key={row.org_id} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/5'}`}>
                        <td className="px-4 py-3 font-medium">{row.org_name}</td>
                        <td className="px-4 py-3 text-center">{row.requests.toLocaleString('ru')}</td>
                        <td className="px-4 py-3 text-center">{row.tokens.toLocaleString('ru')}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-secondary/50 rounded-full h-2 overflow-hidden">
                              <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {aiUsage.length === 0 && !loading && <div className="text-center py-12 text-muted-foreground">Нет данных об использовании AI</div>}
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-14">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}

