import { useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Mail, Search, Users } from 'lucide-react'

import type { SuperadminUserListPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'
import { SuperadminEmptyState } from '../shared/EmptyState'

export function UsersListView() {
  const [q, setQ] = useState('')
  const [isActive, setIsActive] = useState<string>('') // '', 'true', 'false'
  const [orgId, setOrgId] = useState<string>('')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)

  const [page, setPage] = useState<SuperadminUserListPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [copied, setCopied] = useState<'email' | 'id' | null>(null)

  const debouncedQ = useDebounced(q.trim(), 300)

  const load = async (nextOffset = offset) => {
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.users({
        q: debouncedQ || undefined,
        org_id: orgId || undefined,
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
  }, [debouncedQ, isActive, orgId, limit])

  const items = useMemo(() => page?.items ?? [], [page?.items])
  const total = page?.total || 0
  const canPrev = offset > 0
  const canNext = offset + limit < total
  const selectedUser = useMemo(() => items.find((u) => u.id === selectedUserId) || items[0] || null, [items, selectedUserId])
  const activeCount = useMemo(() => items.filter((i) => i.is_active).length, [items])
  const disabledCount = Math.max(0, items.length - activeCount)

  const copyText = async (value: string, kind: 'email' | 'id') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1200)
    } catch {
      // clipboard failures should stay silent in this view
    }
  }

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">Пользователи</h2>
              <p className="mt-1 text-sm text-muted-foreground">Живой список, фильтры и карточка взаимодействия</p>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2 text-sm">
            Всего: <span className="font-semibold">{total.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
          Активных: <span className="font-semibold text-emerald-500">{activeCount}</span>
        </span>
        <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
          Отключенных: <span className="font-semibold text-destructive">{disabledCount}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по email/имени"
            className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select
          value={isActive}
          onChange={(e) => setIsActive(e.target.value)}
          className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm"
        >
          <option value="">Статус: Все</option>
          <option value="true">Только активные</option>
          <option value="false">Только отключенные</option>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border bg-secondary/20">
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Имя</th>
                  <th className="px-4 py-3 text-left">Статус</th>
                  <th className="px-4 py-3 text-left">Организации</th>
                  <th className="px-4 py-3 text-left">Создан</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u, i) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className={`border-b border-sidebar-border/40 cursor-pointer transition-colors ${
                      selectedUser?.id === u.id ? 'bg-primary/10' : i % 2 === 1 ? 'bg-secondary/5' : ''
                    } hover:bg-secondary/10`}
                  >
                    <td className="px-4 py-3 font-medium">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.first_name} {u.last_name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg border px-2 py-0.5 text-xs ${
                          u.is_active
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                            : 'border-destructive/40 bg-destructive/10 text-destructive'
                        }`}
                      >
                        {u.is_active ? 'Активен' : 'Отключен'}
                      </span>
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

          {loading && (
            <div className="flex items-center justify-center py-14 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
            </div>
          )}

          {!loading && error && <div className="px-4 py-8 text-sm text-destructive">{error}</div>}

          {!loading && !error && items.length === 0 && (
            <div className="p-4">
              <SuperadminEmptyState icon={Users} title="Пользователи не найдены" description="Измените фильтры или строку поиска." />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Карточка пользователя</h3>
            <p className="text-xs text-muted-foreground mt-1">Кликни строку в таблице для деталей</p>
          </div>

          {!selectedUser ? (
            <SuperadminEmptyState icon={Users} title="Нет выбранного пользователя" description="Выберите пользователя в таблице слева." />
          ) : (
            <>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3">
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-medium break-all">{selectedUser.email}</div>
              </div>
              <div className="rounded-lg border border-sidebar-border bg-sidebar-background p-3">
                <div className="text-xs text-muted-foreground">User ID</div>
                <div className="text-xs font-mono break-all">{selectedUser.id}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => copyText(selectedUser.email, 'email')}
                  className="h-9 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === 'email' ? 'Скопировано' : 'Email'}
                </button>
                <button
                  onClick={() => copyText(selectedUser.id, 'id')}
                  className="h-9 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied === 'id' ? 'Скопировано' : 'User ID'}
                </button>
              </div>
              <a
                href={`mailto:${selectedUser.email}`}
                className="h-9 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-xs"
              >
                <Mail className="h-3.5 w-3.5" />
                Написать email
              </a>

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Организации пользователя</div>
                <div className="flex flex-wrap gap-2">
                  {selectedUser.orgs?.length ? (
                    selectedUser.orgs.map((o) => (
                      <button
                        key={`${selectedUser.id}-${o.org_id}-${o.role}`}
                        onClick={() => setOrgId(o.org_id)}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          orgId === o.org_id
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent'
                        }`}
                        title="Фильтровать таблицу по этой организации"
                      >
                        {o.org_id.slice(0, 8)}:{o.role}
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">Нет организаций</span>
                  )}
                </div>
                {orgId && (
                  <button onClick={() => setOrgId('')} className="text-xs text-primary hover:underline">
                    Сбросить org-фильтр
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="px-1 pt-1 flex items-center justify-between text-sm">
        <div className="text-muted-foreground">
          {total > 0 ? (
            <>
              Показаны {Math.min(total, offset + 1)}–{Math.min(total, offset + limit)} из {total.toLocaleString('ru-RU')}
            </>
          ) : (
            '—'
          )}
          {orgId && <span className="ml-2">• org: {orgId.slice(0, 8)}</span>}
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

function useDebounced(value: string, delayMs: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return v
}
