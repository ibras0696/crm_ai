import { useEffect, useMemo, useState } from 'react'
import { Building2, Loader2, Search } from 'lucide-react'

import type { SuperadminOrgListItem, SuperadminOrgListPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'
import { PLAN_LABELS, SUB_STATUS_LABELS } from '../shared/constants'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  selectedOrgId: string
  onSelectOrg: (orgId: string) => void
}

export function OrgListView({ selectedOrgId, onSelectOrg }: Props) {
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState<string>('')
  const [subStatus, setSubStatus] = useState<string>('')
  const [limit, setLimit] = useState(25)
  const [offset, setOffset] = useState(0)

  const [page, setPage] = useState<SuperadminOrgListPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const debouncedQ = useDebounced(q.trim(), 300)

  const load = async (nextOffset = offset) => {
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.orgs({
        q: debouncedQ || undefined,
        plan: plan || undefined,
        sub_status: subStatus || undefined,
        limit,
        offset: nextOffset,
      })
      if (r.data.ok && r.data.data) {
        setPage(r.data.data)
        setOffset(r.data.data.offset)
      } else {
        setError(r.data.error?.message || 'Не удалось загрузить организации')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить организации')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setOffset(0)
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, plan, subStatus, limit])

  const items = page?.items || []
  const total = page?.total || 0
  const canPrev = offset > 0
  const canNext = offset + limit < total

  const subtitle = useMemo(() => {
    const parts: string[] = []
    if (plan) parts.push(`тариф: ${PLAN_LABELS[plan] || plan}`)
    if (subStatus) parts.push(`подписка: ${SUB_STATUS_LABELS[subStatus] || subStatus}`)
    if (debouncedQ) parts.push(`поиск: "${debouncedQ}"`)
    return parts.join(' • ')
  }, [plan, subStatus, debouncedQ])

  const planSummary = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of items) map.set(it.plan, (map.get(it.plan) || 0) + 1)
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [items])

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">Организации</h2>
              <p className="mt-1 text-sm text-muted-foreground">Поиск, фильтрация и выбор организации для детального управления</p>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2 text-sm">
            Всего: <span className="font-semibold">{total.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      </div>

      {(subtitle || planSummary.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {subtitle && <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">{subtitle}</span>}
          {planSummary.map(([p, c]) => (
            <span key={p} className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
              {PLAN_LABELS[p] || p}: <span className="font-semibold">{c}</span>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative md:col-span-2">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию/slug"
            className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm">
          <option value="">Все тарифы</option>
          <option value="free">{PLAN_LABELS.free}</option>
          <option value="team">{PLAN_LABELS.team}</option>
          <option value="business">{PLAN_LABELS.business}</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={subStatus}
            onChange={(e) => setSubStatus(e.target.value)}
            className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm"
          >
            <option value="">Статус</option>
            <option value="active">{SUB_STATUS_LABELS.active}</option>
            <option value="past_due">{SUB_STATUS_LABELS.past_due}</option>
            <option value="cancelled">{SUB_STATUS_LABELS.cancelled}</option>
            <option value="trialing">{SUB_STATUS_LABELS.trialing}</option>
            <option value="none">{SUB_STATUS_LABELS.none}</option>
          </select>
          <select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm">
            {[25, 50, 100].map((n) => (
              <option key={n} value={String(n)}>
                {n}/стр
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-secondary/20">
                <th className="px-4 py-3 text-left">Название</th>
                <th className="px-4 py-3 text-left">Тариф</th>
                <th className="px-4 py-3 text-left">Подписка</th>
                <th className="px-4 py-3 text-center">Участники</th>
                <th className="px-4 py-3 text-center">Таблицы</th>
                <th className="px-4 py-3 text-center">Записи</th>
                <th className="px-4 py-3 text-left">Создана</th>
              </tr>
            </thead>
            <tbody>
              {items.map((org, i) => (
                <OrgRow key={org.id} org={org} active={org.id === selectedOrgId} zebra={i % 2 === 1} onClick={() => onSelectOrg(org.id)} />
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
            <SuperadminEmptyState icon={Building2} title="Организации не найдены" description="Попробуйте изменить фильтры или поисковый запрос." />
          </div>
        )}
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

function OrgRow({ org, zebra, active, onClick }: { org: SuperadminOrgListItem; zebra: boolean; active: boolean; onClick: () => void }) {
  const sub = org.subscription
  return (
    <tr
      onClick={onClick}
      className={`border-b border-sidebar-border/40 cursor-pointer ${active ? 'bg-primary/10' : zebra ? 'bg-secondary/5' : ''} hover:bg-secondary/10 transition-colors`}
    >
      <td className="px-4 py-3">
        <div className="font-medium">{org.name}</div>
        <div className="text-xs text-muted-foreground">{org.slug}</div>
      </td>
      <td className="px-4 py-3">{PLAN_LABELS[org.plan] || org.plan}</td>
      <td className="px-4 py-3">
        {sub ? (
          <div className="text-xs">
            <div className="font-medium">{SUB_STATUS_LABELS[sub.status] || sub.status}</div>
            <div className="text-muted-foreground">{PLAN_LABELS[sub.plan] || sub.plan}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">{Number(org.members || 0).toLocaleString('ru-RU')}</td>
      <td className="px-4 py-3 text-center">{Number(org.tables || 0).toLocaleString('ru-RU')}</td>
      <td className="px-4 py-3 text-center">{Number(org.records || 0).toLocaleString('ru-RU')}</td>
      <td className="px-4 py-3">{org.created_at ? new Date(org.created_at).toLocaleDateString('ru-RU') : '—'}</td>
    </tr>
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
