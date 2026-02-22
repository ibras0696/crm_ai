import { useEffect, useMemo, useState } from 'react'
import { Bot, Loader2 } from 'lucide-react'

import { superadminApi } from '@/lib/api'

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
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4" /> AI
        </h2>
        <button onClick={() => void load()} className="h-8 px-3 rounded-lg border border-border hover:bg-secondary/30 text-sm">
          Обновить
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-14 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
        </div>
      )}

      {!loading && error && <div className="px-4 py-8 text-sm text-destructive">{error}</div>}

      {!loading && !error && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Запросов</div>
              <div className="text-lg font-bold">{totals.requests.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Токенов</div>
              <div className="text-lg font-bold">{totals.tokens.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="text-xs text-muted-foreground">Ключ</div>
              <div className="text-sm font-medium">{config?.key_configured ? `Настроен (${config?.key_prefix || ''})` : 'Не настроен'}</div>
            </div>
          </div>

          <div className="rounded-lg border border-border overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/20">
                  <th className="px-4 py-3 text-left">Организация</th>
                  <th className="px-4 py-3 text-center">Запросов</th>
                  <th className="px-4 py-3 text-center">Токенов</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((r, i) => (
                  <tr key={r.org_id} className={`border-b border-border/30 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.org_name}</div>
                      <div className="text-xs text-muted-foreground">{r.org_id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">{Number(r.requests || 0).toLocaleString('ru-RU')}</td>
                    <td className="px-4 py-3 text-center">{Number(r.tokens || 0).toLocaleString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            Provider: {config?.provider || '—'} • Base URL: {config?.base_url || '—'} • Model: {config?.model || '—'}
          </div>
        </div>
      )}
    </div>
  )
}

