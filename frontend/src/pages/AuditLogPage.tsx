import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { auditApi, type AuditLogItem } from '@/lib/api'
import { Shield, RefreshCw, Clock, Loader2, AlertCircle } from 'lucide-react'

const actionLabels: Record<string, string> = {
  user_login: 'Вход в систему',
  user_register: 'Регистрация',
  user_logout: 'Выход',
  org_create: 'Создание организации',
  org_update: 'Обновление организации',
  member_invite: 'Приглашение участника',
  member_remove: 'Удаление участника',
  role_change: 'Смена роли',
}

const actionColors: Record<string, string> = {
  user_login: 'default',
  user_register: 'success',
  user_logout: 'secondary',
  org_create: 'default',
  member_invite: 'warning',
  member_remove: 'destructive',
  role_change: 'warning',
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Shield className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg">События</CardTitle>
              <CardDescription>{logs.length} записей</CardDescription>
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

          {!loading && !error && logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Shield className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">Нет событий</p>
              <p className="text-sm">Действия будут отображаться здесь</p>
            </div>
          )}

          {!loading && !error && logs.length > 0 && (
            <div className="space-y-2">
              {/* Table header */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="col-span-3">Действие</div>
                <div className="col-span-2">Тип</div>
                <div className="col-span-2">ID объекта</div>
                <div className="col-span-2">IP</div>
                <div className="col-span-3">Дата</div>
              </div>

              {logs.map((log) => (
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
                    <span className="text-sm text-muted-foreground">{log.entity_type}</span>
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-xs text-muted-foreground font-mono truncate block max-w-[120px]">
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
