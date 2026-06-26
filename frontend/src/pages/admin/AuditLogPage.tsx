import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { auditApi, type AuditLogItem } from '@/lib/api'
import { Shield, RefreshCw, Clock, Loader2, AlertCircle, Search, SlidersHorizontal, X } from 'lucide-react'

const actionLabels: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  login: 'Вход',
  logout: 'Выход',
  invite_sent: 'Приглашение отправлено',
  invite_accepted: 'Приглашение принято',
  role_changed: 'Смена роли',
  export: 'Экспорт',
  ai_query: 'AI запрос',
  login_failed: 'Ошибка входа',
  access_denied: 'Запрет доступа',
  token_anomaly: 'Проблема с токеном',
}

const actionColors: Record<string, string> = {
  create: 'default',
  update: 'secondary',
  delete: 'destructive',
  login: 'secondary',
  logout: 'secondary',
  invite_sent: 'secondary',
  invite_accepted: 'secondary',
  role_changed: 'warning',
  export: 'secondary',
  ai_query: 'secondary',
  login_failed: 'destructive',
  access_denied: 'destructive',
  token_anomaly: 'warning',
}

/** Icon background + text color per action for mobile cards */
const actionIconStyle: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-emerald-500/15', text: 'text-emerald-500' },
  update: { bg: 'bg-blue-500/15', text: 'text-blue-500' },
  delete: { bg: 'bg-red-500/15', text: 'text-red-500' },
  login: { bg: 'bg-secondary', text: 'text-muted-foreground' },
  logout: { bg: 'bg-secondary', text: 'text-muted-foreground' },
  invite_sent: { bg: 'bg-violet-500/15', text: 'text-violet-500' },
  invite_accepted: { bg: 'bg-emerald-500/15', text: 'text-emerald-500' },
  role_changed: { bg: 'bg-amber-500/15', text: 'text-amber-500' },
  login_failed: { bg: 'bg-red-500/15', text: 'text-red-500' },
  access_denied: { bg: 'bg-red-500/15', text: 'text-red-500' },
  token_anomaly: { bg: 'bg-amber-500/15', text: 'text-amber-500' },
}

const entityLabels: Record<string, string> = {
  organization: 'Организация',
  invite: 'Приглашение',
  invite_resend: 'Повторное приглашение',
  user: 'Пользователь',
  org_plan: 'Тариф',
  org_ai_settings: 'AI настройки',
  org_ai_usage: 'AI лимиты',
  record: 'Запись',
  table: 'Таблица',
  file: 'Файл',
}

/** Return initials for a user identifier string */
function getInitials(str: string): string {
  const parts = str.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
  return str.slice(0, 2).toUpperCase()
}

const MOBILE_PAGE_SIZE = 20

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobilePageSize, setMobilePageSize] = useState(MOBILE_PAGE_SIZE)

  const fetchLogs = async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await auditApi.list(100)
      if (resp.data.ok) {
        setLogs(resp.data.data ?? [])
      } else {
        setError(resp.data.error?.message || 'Ошибка загрузки')
      }
    } catch {
      setError('Не удалось загрузить журнал аудита')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  const actions = useMemo(() => {
    return Array.from(new Set(logs.map((l) => l.action))).sort()
  }, [logs])

  const filteredLogs = useMemo(() => {
    const query = q.trim().toLowerCase()
    return logs.filter((log) => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false
      if (!query) return true
      const text = [
        actionLabels[log.action] || log.action,
        entityLabels[log.entity_type] || log.entity_type,
        log.entity_id || '',
        log.ip_address || '',
        JSON.stringify(log.meta || {}),
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(query)
    })
  }, [logs, q, actionFilter])

  const summary = useMemo(() => {
    const failed = logs.filter((l) => l.action === 'login_failed').length
    const denied = logs.filter((l) => l.action === 'access_denied').length
    const security = failed + denied + logs.filter((l) => l.action === 'token_anomaly').length
    return { total: logs.length, failed, denied, security }
  }, [logs])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const formatDateShort = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const mobileLogs = filteredLogs.slice(0, mobilePageSize)
  const hasMore = filteredLogs.length > mobilePageSize

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Журнал аудита</h1>
          <p className="text-muted-foreground mt-1 text-sm">История действий в организации</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading} className="shrink-0">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline ml-2">Обновить</span>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего событий</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ошибок входа</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{summary.failed}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Запретов доступа</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{summary.denied}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Событий безопасности</p>
            <p className="text-2xl font-semibold mt-1 tabular-nums">{summary.security}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2">
                <Shield className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-lg">События</CardTitle>
                <CardDescription>{filteredLogs.length} записей</CardDescription>
              </div>
            </div>

            {/* Desktop filters */}
            <div className="hidden md:flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-80">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск по действию, типу, ID, IP"
                  className="w-full h-10 rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 pr-8 text-sm outline-none focus:border-primary"
                >
                  <option value="all">Все действия</option>
                  {actions.map((a) => (
                    <option key={a} value={a}>{actionLabels[a] || a}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mobile: search + filter toggle */}
            <div className="flex md:hidden items-center gap-2 w-full">
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Поиск..."
                  className="w-full h-10 rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <button
                onClick={() => setFiltersOpen(!filtersOpen)}
                className={`h-10 w-10 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                  filtersOpen || actionFilter !== 'all'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground'
                }`}
              >
                {filtersOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
              </button>
            </div>

            {/* Mobile: expandable filters */}
            {filtersOpen && (
              <div className="flex md:hidden w-full">
                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="all">Все действия</option>
                  {actions.map((a) => (
                    <option key={a} value={a}>{actionLabels[a] || a}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <AlertCircle className="h-10 w-10 mb-3 text-destructive opacity-60" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && filteredLogs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">Нет событий</p>
              <p className="text-sm">Попробуйте изменить фильтры или обновить данные</p>
            </div>
          )}

          {!loading && !error && filteredLogs.length > 0 && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block space-y-2">
                <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <div className="col-span-3">Действие</div>
                  <div className="col-span-2">Тип</div>
                  <div className="col-span-2">ID объекта</div>
                  <div className="col-span-2">IP</div>
                  <div className="col-span-3">Дата</div>
                </div>
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="grid grid-cols-12 gap-4 items-center rounded-lg px-4 py-3 hover:bg-secondary/30 transition-colors border-b border-border/30 last:border-0"
                  >
                    <div className="col-span-3">
                      <Badge variant={(actionColors[log.action] as any) || 'secondary'}>
                        {actionLabels[log.action] || log.action}
                      </Badge>
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-muted-foreground">{entityLabels[log.entity_type] || log.entity_type}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-muted-foreground font-mono truncate block max-w-[120px]" title={log.entity_id || '—'}>
                        {log.entity_id || '—'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-muted-foreground">{log.ip_address || '—'}</span>
                    </div>
                    <div className="col-span-3 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Mobile activity list */}
              <div className="md:hidden divide-y divide-border/40">
                {mobileLogs.map((log) => {
                  const iconStyle = actionIconStyle[log.action] ?? { bg: 'bg-secondary', text: 'text-muted-foreground' }
                  const entityLabel = entityLabels[log.entity_type] || log.entity_type
                  const actionLabel = actionLabels[log.action] || log.action
                  // Build a readable user hint from IP or entity
                  const userHint = log.ip_address || log.entity_id || '?'
                  const initials = getInitials(userHint.split('.').join('') || 'XX')
                  return (
                    <div key={log.id} className="flex items-start gap-3 py-3">
                      {/* Left: colored icon circle */}
                      <div className={`h-9 w-9 rounded-full ${iconStyle.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Shield className={`h-4 w-4 ${iconStyle.text}`} />
                      </div>
                      {/* Center: action + entity + time */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">{actionLabel}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{entityLabel}{log.entity_id ? ` · ${log.entity_id.slice(0, 8)}…` : ''}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          {formatDateShort(log.created_at)}
                          {log.ip_address && <> · {log.ip_address}</>}
                        </p>
                      </div>
                      {/* Right: avatar initials */}
                      <div className="h-8 w-8 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                        {initials}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Mobile: load more */}
              {hasMore && (
                <div className="md:hidden pt-3">
                  <button
                    onClick={() => setMobilePageSize((n) => n + MOBILE_PAGE_SIZE)}
                    className="w-full h-11 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary/40 transition-colors"
                  >
                    Загрузить ещё ({filteredLogs.length - mobilePageSize})
                  </button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
