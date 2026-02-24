import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Shield } from 'lucide-react'

import type { SuperadminAuditPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  selectedOrgId: string
}

export function SuperadminAuditView({ selectedOrgId }: Props) {
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
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
  const normalizedQ = q.trim().toLowerCase()

  const actionOptions = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => {
      if (i.action) set.add(i.action)
    })
    return ['all', ...Array.from(set).sort()]
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((l) => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false
      if (!normalizedQ) return true
      const hay = [
        l.org_name,
        l.org_id,
        l.action,
        l.entity_type,
        l.entity_id || '',
        l.actor_id || '',
        l.ip_address || '',
        l.correlation_id || '',
        l.meta ? JSON.stringify(l.meta) : '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(normalizedQ)
    })
  }, [items, actionFilter, normalizedQ])

  const actionCounts = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((l) => m.set(l.action, (m.get(l.action) || 0) + 1))
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
  }, [items])

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">Аудит событий</h2>
              <p className="mt-1 text-sm text-muted-foreground">Журнал security и бизнес-событий платформы</p>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2 text-sm">
            Всего: <span className="font-semibold">{total.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      </div>

      {actionCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actionCounts.map(([action, count]) => (
            <span key={action} className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
              {action}: <span className="font-semibold">{count}</span>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: org/action/entity/meta/ip/correlation"
            className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm"
          >
            {actionOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt === 'all' ? 'Все действия' : opt}
              </option>
            ))}
          </select>
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm"
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
        <div className="flex items-center justify-center py-14 text-muted-foreground rounded-xl border border-sidebar-border bg-sidebar-background/40">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
        </div>
      )}

      {!loading && error && <div className="px-4 py-8 text-sm text-destructive">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <SuperadminEmptyState
          icon={Shield}
          title="Журнал пока пуст"
          description="Когда в системе появятся события, они отобразятся здесь."
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border bg-secondary/20">
                  <th className="px-4 py-3 text-left">Организация</th>
                  <th className="px-4 py-3 text-left">Событие</th>
                  <th className="px-4 py-3 text-left">Сущность</th>
                  <th className="px-4 py-3 text-left">Meta</th>
                  <th className="px-4 py-3 text-left">Контекст</th>
                  <th className="px-4 py-3 text-left">Дата</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((l, i) => (
                  <tr key={l.id} className={`border-b border-sidebar-border/40 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.org_name}</div>
                      <div className="text-xs text-muted-foreground">{l.org_id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-lg border border-sidebar-border bg-sidebar-background px-2 py-1 text-xs font-medium">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.entity_type}</div>
                      <div className="text-xs text-muted-foreground">{l.entity_id ? l.entity_id.slice(0, 12) : '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      {l.meta ? (
                        <div className="flex flex-wrap gap-1.5 max-w-[360px]">
                          {Object.entries(l.meta)
                            .slice(0, 3)
                            .map(([k, v]) => (
                              <span key={k} className="rounded-md border border-sidebar-border bg-sidebar-background px-2 py-0.5 text-xs">
                                {k}: {String(v)}
                              </span>
                            ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground space-y-0.5 min-w-[180px]">
                        <div>actor: {l.actor_id ? l.actor_id.slice(0, 8) : '—'}</div>
                        <div>ip: {l.ip_address || '—'}</div>
                        <div>corr: {l.correlation_id ? l.correlation_id.slice(0, 10) : '—'}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{l.created_at ? new Date(l.created_at).toLocaleString('ru-RU') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredItems.length === 0 && (
            <div className="p-4">
              <SuperadminEmptyState
                icon={Shield}
                title="Ничего не найдено"
                description="Попробуйте изменить поиск или фильтр по действию."
              />
            </div>
          )}
        </div>
      )}

      <div className="px-1 pt-1 flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          {total > 0 ? (
            <>
              Показаны {Math.min(total, offset + 1)}–{Math.min(total, offset + limit)} из {total.toLocaleString('ru-RU')}
            </>
          ) : (
            '—'
          )}
          {normalizedQ && <span className="ml-2">• найдено на странице: {filteredItems.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!canPrev || loading}
            onClick={() => void load(Math.max(0, offset - limit))}
            className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
          >
            Назад
          </button>
          <button
            disabled={!canNext || loading}
            onClick={() => void load(offset + limit)}
            className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
          >
            Вперед
          </button>
        </div>
      </div>
    </section>
  )
}
