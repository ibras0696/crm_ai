import { useEffect, useState } from 'react'
import { Loader2, Shield } from 'lucide-react'

import type { SuperadminAuditPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'

type Props = {
  selectedOrgId: string
}

export function SuperadminAuditView({ selectedOrgId }: Props) {
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<SuperadminAuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async (nextOffset = offset) => {
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.audit({ org_id: selectedOrgId || undefined, limit, offset: nextOffset })
      if (r.data.ok && r.data.data) {
        setPage(r.data.data)
        setOffset(r.data.data.offset)
      } else {
        setError(r.data.error?.message || 'Не удалось загрузить аудит')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить аудит')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, limit])

  const items = page?.items || []
  const total = page?.total || 0
  const canPrev = offset > 0
  const canNext = offset + limit < total

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Shield className="h-4 w-4" /> Аудит
          <span className="text-xs text-muted-foreground font-normal">({total.toLocaleString('ru-RU')})</span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-8 px-2 rounded-lg border border-border bg-background text-sm"
          >
            {[50, 100, 200].map((n) => (
              <option key={n} value={String(n)}>
                {n}/стр
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-14 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
        </div>
      )}

      {!loading && error && <div className="px-4 py-8 text-sm text-destructive">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="px-4 py-10 text-sm text-muted-foreground">Записей аудита нет.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="px-4 py-3 text-left">Организация</th>
                <th className="px-4 py-3 text-left">Действие</th>
                <th className="px-4 py-3 text-left">Сущность</th>
                <th className="px-4 py-3 text-left">Meta</th>
                <th className="px-4 py-3 text-left">Дата</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l, i) => (
                <tr key={l.id} className={`border-b border-border/30 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{l.org_name}</div>
                    <div className="text-xs text-muted-foreground">{l.org_id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3">{l.action}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{l.entity_type}</div>
                    <div className="text-xs text-muted-foreground">{l.entity_id ? l.entity_id.slice(0, 12) : '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <pre className="text-xs whitespace-pre-wrap break-words max-w-[460px]">
                      {l.meta ? JSON.stringify(l.meta) : '—'}
                    </pre>
                  </td>
                  <td className="px-4 py-3">{l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          {total > 0 ? (
            <>
              Показаны {Math.min(total, offset + 1)}–{Math.min(total, offset + limit)} из {total.toLocaleString('ru-RU')}
            </>
          ) : (
            '—'
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!canPrev || loading}
            onClick={() => void load(Math.max(0, offset - limit))}
            className="h-8 px-3 rounded-lg border border-border hover:bg-secondary/30 disabled:opacity-50"
          >
            Назад
          </button>
          <button
            disabled={!canNext || loading}
            onClick={() => void load(offset + limit)}
            className="h-8 px-3 rounded-lg border border-border hover:bg-secondary/30 disabled:opacity-50"
          >
            Вперед
          </button>
        </div>
      </div>
    </div>
  )
}

