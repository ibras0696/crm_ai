import { useEffect, useState } from 'react'
import { Loader2, Search, Users } from 'lucide-react'

import type { SuperadminUserListPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'

export function UsersListView() {
  const [q, setQ] = useState('')
  const [isActive, setIsActive] = useState<string>('') // '', 'true', 'false'
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)

  const [page, setPage] = useState<SuperadminUserListPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const debouncedQ = useDebounced(q.trim(), 300)

  const load = async (nextOffset = offset) => {
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.users({
        q: debouncedQ || undefined,
        is_active: isActive === '' ? undefined : isActive === 'true',
        limit,
        offset: nextOffset,
      })
      if (r.data.ok && r.data.data) {
        setPage(r.data.data)
        setOffset(r.data.data.offset)
      } else {
        setError(r.data.error?.message || 'Не удалось загрузить пользователей')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить пользователей')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, isActive, limit])

  const items = page?.items || []
  const total = page?.total || 0
  const canPrev = offset > 0
  const canNext = offset + limit < total

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" /> Пользователи
          <span className="text-xs text-muted-foreground font-normal">({total.toLocaleString('ru-RU')})</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по email/имени"
              className="h-8 w-64 max-w-[48vw] pl-8 pr-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={isActive}
            onChange={(e) => setIsActive(e.target.value)}
            className="h-8 px-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="">Все</option>
            <option value="true">Активные</option>
            <option value="false">Отключенные</option>
          </select>
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
        <div className="px-4 py-10 text-sm text-muted-foreground">Нет пользователей по заданным фильтрам.</div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Имя</th>
                <th className="px-4 py-3 text-left">Статус</th>
                <th className="px-4 py-3 text-left">Организации</th>
                <th className="px-4 py-3 text-left">Создан</th>
              </tr>
            </thead>
            <tbody>
              {items.map((u, i) => (
                <tr key={u.id} className={`border-b border-border/30 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                  <td className="px-4 py-3 font-medium">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.first_name} {u.last_name}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_active ? <span className="text-emerald-500">Активен</span> : <span className="text-destructive">Отключен</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.orgs?.length ? u.orgs.map((o) => `${o.org_id.slice(0, 8)}:${o.role}`).join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3">{u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}</td>
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

function useDebounced(value: string, delayMs: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return v
}

