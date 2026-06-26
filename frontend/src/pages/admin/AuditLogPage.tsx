import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { auditApi, type AuditLogItem } from '@/lib/api'
import { Shield, RefreshCw, Clock, Loader2, AlertCircle, Search } from 'lucide-react'

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

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [actionFilter, setActionFilter] = useState('all')

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
    return {
      total: logs.length,
      failed,
      denied,
      security,
    }
  }, [logs])

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Журнал аудита</h1>
          <p className="text-muted-foreground mt-1">
            История действий в организации
          </p>
        </div>
        <Button variant="outline" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего событий</p>
            <p className="text-2xl font-semibold mt-1">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ошибок входа</p>
            <p className="text-2xl font-semibold mt-1">{summary.failed}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Запретов доступа</p>
            <p className="text-2xl font-semibold mt-1">{summary.denied}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Событий безопасности</p>
            <p className="text-2xl font-semibold mt-1">{summary.security}</p>
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
            <div className="flex items-center gap-2 w-full md:w-auto">
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
                    <option key={a} value={a}>
                      {actionLabels[a] || a}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
            <div className="space-y-2">
              {/* Table header */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="col-span-3">Действие</div>
                <div className="col-span-2">Тип</div>
                <div className="col-span-2">ID объекта</div>
                <div className="col-span-2">IP</div>
                <div className="col-span-3">Дата</div>
              </div>

              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 items-start md:items-center rounded-lg px-4 py-3 hover:bg-secondary/30 transition-colors border-b border-border/30 last:border-0"
                >
                  <div className="md:col-span-3">
                    <Badge variant={(actionColors[log.action] as any) || 'secondary'}>
                      {actionLabels[log.action] || log.action}
                    </Badge>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-sm text-muted-foreground">{entityLabels[log.entity_type] || log.entity_type}</span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-xs text-muted-foreground font-mono truncate block max-w-[120px]" title={log.entity_id || '—'}>
                      {log.entity_id || '—'}
                    </span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-xs text-muted-foreground">{log.ip_address || '—'}</span>
                  </div>
                  <div className="md:col-span-3 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-muted-foreground hidden md:block" />
                    <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
