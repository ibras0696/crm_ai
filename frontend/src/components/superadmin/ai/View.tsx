import { useEffect, useMemo, useState } from 'react'
import { Bot, KeyRound, Loader2, RefreshCw, Sparkles } from 'lucide-react'

import { superadminApi } from '@/lib/api'
import { SuperadminEmptyState } from '../shared/EmptyState'

type AIUsage = { org_id: string; org_name: string; requests: number; tokens: number }

export function SuperadminAIView() {
  const [usage, setUsage] = useState<AIUsage[]>([])
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [u, c] = await Promise.all([superadminApi.aiUsage(), superadminApi.aiConfig()])
      if (u.data.ok && u.data.data) setUsage(u.data.data as AIUsage[])
      if (c.data.ok && c.data.data) setConfig(c.data.data)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить AI данные')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totals = useMemo(() => {
    return usage.reduce(
      (acc, r) => {
        acc.requests += Number(r.requests || 0)
        acc.tokens += Number(r.tokens || 0)
        return acc
      },
      { requests: 0, tokens: 0 }
    )
  }, [usage])

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-5">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">AI аналитика</h2>
              <p className="mt-1 text-sm text-muted-foreground">Usage по организациям и конфигурация провайдера</p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            className="h-10 px-4 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm inline-flex items-center gap-2 shrink-0"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-14 text-muted-foreground rounded-xl border border-sidebar-border bg-sidebar-background/40">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
        </div>
      )}

      {!loading && error && <div className="px-4 py-8 text-sm text-destructive">{error}</div>}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Запросов</div>
              <div className="mt-1 text-3xl font-semibold leading-none">{totals.requests.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Токенов</div>
              <div className="mt-1 text-3xl font-semibold leading-none">{totals.tokens.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Ключ API</div>
              <div className="mt-2 inline-flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-primary" />
                <span className="font-medium">{config?.key_configured ? `Настроен (${config?.key_prefix || ''})` : 'Не настроен'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">По организациям</span>
            </div>
            {usage.length === 0 ? (
              <div className="p-4">
                <SuperadminEmptyState
                  icon={Bot}
                  title="Пока нет AI активности"
                  description="Как только появятся запросы, статистика отобразится здесь."
                />
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sidebar-border bg-secondary/20">
                      <th className="px-4 py-3 text-left">Организация</th>
                      <th className="px-4 py-3 text-center">Запросов</th>
                      <th className="px-4 py-3 text-center">Токенов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((r, i) => (
                      <tr key={r.org_id} className={`border-b border-sidebar-border/40 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.org_name}</div>
                          <div className="text-xs text-muted-foreground">{r.org_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">{Number(r.requests || 0).toLocaleString('ru-RU')}</td>
                        <td className="px-4 py-3 text-center font-medium">{Number(r.tokens || 0).toLocaleString('ru-RU')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Конфигурация провайдера</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1">Provider: {config?.provider || '—'}</span>
              <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1">Model: {config?.model || '—'}</span>
              <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 max-w-full truncate">Base URL: {config?.base_url || '—'}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
