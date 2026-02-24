import { useEffect, useMemo, useState } from 'react'
import { Bot, Crown, Loader2, RefreshCw, Users } from 'lucide-react'

import type { SuperadminOrgDetail, SuperadminOrgMemberItem, SuperadminOrgMembersPage } from '@/lib/api'
import { superadminApi } from '@/lib/api'
import { PLAN_LABELS, formatBytes } from '../shared/constants'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  orgId: string
}

export function OrgDetailView({ orgId }: Props) {
  const [detail, setDetail] = useState<SuperadminOrgDetail | null>(null)
  const [members, setMembers] = useState<SuperadminOrgMembersPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [changingPlan, setChangingPlan] = useState(false)
  const [changingAiFlag, setChangingAiFlag] = useState(false)
  const [resettingAiUsage, setResettingAiUsage] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const load = async () => {
    if (!orgId) return
    setLoading(true)
    setError('')
    try {
      const [d, m] = await Promise.all([superadminApi.orgDetail(orgId), superadminApi.orgMembers(orgId, { limit: 100, offset: 0 })])
      if (!d.data.ok || !d.data.data) throw new Error(d.data.error?.message || 'Не удалось загрузить организацию')
      if (!m.data.ok || !m.data.data) throw new Error(m.data.error?.message || 'Не удалось загрузить участников')
      setDetail(d.data.data)
      setMembers(m.data.data)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить организацию')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  const org = detail?.org
  const planLimits = detail?.plan_limits
  const usage = detail?.usage

  const tokenUsage = useMemo(() => {
    const used = detail?.ai_usage_today?.tokens_used || 0
    const limit = planLimits?.ai_tokens_per_day || 0
    const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
    return { used, limit, pct }
  }, [detail?.ai_usage_today?.tokens_used, planLimits?.ai_tokens_per_day])

  const setPlan = async (plan: string) => {
    if (!orgId || !plan) return
    setActionError('')
    setActionSuccess('')
    setChangingPlan(true)
    try {
      await superadminApi.setPlan(orgId, plan)
      setActionSuccess('Тариф обновлен')
      await load()
    } catch (e: any) {
      setActionError(e?.response?.data?.error?.message || e?.message || 'Не удалось обновить тариф')
    } finally {
      setChangingPlan(false)
    }
  }

  const setOrgAiEnabled = async (enabled: boolean) => {
    if (!orgId) return
    setActionError('')
    setActionSuccess('')
    setChangingAiFlag(true)
    try {
      const r = await superadminApi.setOrgAiEnabled(orgId, enabled)
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось изменить статус AI')
      setActionSuccess(enabled ? 'AI включен для организации' : 'AI выключен для организации')
      await load()
    } catch (e: any) {
      setActionError(e?.response?.data?.error?.message || e?.message || 'Не удалось изменить статус AI')
    } finally {
      setChangingAiFlag(false)
    }
  }

  const resetOrgAiUsage = async () => {
    if (!orgId) return
    setActionError('')
    setActionSuccess('')
    setResettingAiUsage(true)
    try {
      const r = await superadminApi.resetOrgAiUsage(orgId)
      if (!r.data.ok || !r.data.data) throw new Error(r.data.error?.message || 'Не удалось сбросить usage')
      setActionSuccess(`Сброшено: ${r.data.data.removed_requests} запросов, ${r.data.data.removed_tokens} токенов`)
      await load()
    } catch (e: any) {
      setActionError(e?.response?.data?.error?.message || e?.message || 'Не удалось сбросить usage')
    } finally {
      setResettingAiUsage(false)
    }
  }

  if (!orgId) {
    return <SuperadminEmptyState icon={Crown} title="Организация не выбрана" description="Выберите организацию в списке слева, чтобы открыть детали." />
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка...
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-6 space-y-3">
        <div className="text-sm text-destructive">{error}</div>
        <button onClick={() => void load()} className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm">
          Повторить
        </button>
      </div>
    )
  }

  if (!detail || !org || !usage) return null

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2 truncate">
              <Crown className="h-4 w-4 text-amber-500" /> {org.name}
            </h2>
            <p className="text-xs text-muted-foreground break-all mt-1">{org.slug}</p>
          </div>
          <button
            onClick={() => void load()}
            className="h-9 w-9 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center"
            title="Обновить"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Участники', value: usage.members },
          { label: 'Таблицы', value: usage.tables },
          { label: 'Записи', value: usage.records },
          { label: 'Файлы', value: usage.files },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-sidebar-border bg-sidebar-background/50 p-3">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-2xl font-semibold leading-none mt-1">{Number(c.value || 0).toLocaleString('ru-RU')}</div>
          </div>
        ))}
        <div className="rounded-lg border border-sidebar-border bg-sidebar-background/50 p-3 col-span-2">
          <div className="text-xs text-muted-foreground">Хранилище</div>
          <div className="text-2xl font-semibold leading-none mt-1">{formatBytes(usage.storage_bytes || 0)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
        <div className="text-sm font-semibold">Тариф и лимиты</div>
        <div className="flex flex-col gap-2">
          <select
            value={org.plan}
            onChange={(e) => void setPlan(e.target.value)}
            disabled={changingPlan}
            className="h-10 rounded-xl border border-sidebar-border bg-sidebar-background px-2 text-sm"
          >
            <option value="free">{PLAN_LABELS.free}</option>
            <option value="team">{PLAN_LABELS.team}</option>
            <option value="business">{PLAN_LABELS.business}</option>
          </select>
          {planLimits && (
            <div className="text-xs text-muted-foreground">
              Лимиты: {planLimits.max_members} участников • {planLimits.max_tables} таблиц • {planLimits.max_records} записей • {planLimits.max_storage_mb} МБ
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" /> AI управление
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void setOrgAiEnabled(!(detail.org?.ai_enabled ?? true))}
            disabled={changingAiFlag}
            className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm disabled:opacity-50"
          >
            {detail.org?.ai_enabled ? 'Выключить AI' : 'Включить AI'}
          </button>
          <button
            onClick={() => void resetOrgAiUsage()}
            disabled={resettingAiUsage}
            className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm disabled:opacity-50"
          >
            Сбросить AI usage (сегодня)
          </button>
          <div className="text-xs text-muted-foreground">Состояние: {detail.org?.ai_enabled ? 'включен' : 'выключен'}</div>
        </div>

        {planLimits?.has_ai && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Токены сегодня: {tokenUsage.used.toLocaleString('ru-RU')}
              {tokenUsage.limit ? ` / ${tokenUsage.limit.toLocaleString('ru-RU')}` : ''}
            </div>
            {tokenUsage.limit > 0 && (
              <div className="h-2 rounded-full bg-secondary/50 overflow-hidden">
                <div className="h-2 bg-primary" style={{ width: `${tokenUsage.pct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {(actionError || actionSuccess) && (
        <div className={`rounded-xl border p-3 text-xs ${actionError ? 'border-destructive/50 text-destructive' : 'border-emerald-500/40 text-emerald-400'}`}>
          {actionError || actionSuccess}
        </div>
      )}

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> Участники ({members?.total || 0})
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-sidebar-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border bg-secondary/20">
                <th className="px-3 py-2 text-left">Пользователь</th>
                <th className="px-3 py-2 text-left">Роль</th>
                <th className="px-3 py-2 text-left">Статус</th>
              </tr>
            </thead>
            <tbody>
              {(members?.items || []).map((it, idx) => (
                <MemberRow key={it.membership.id} item={it} zebra={idx % 2 === 1} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function MemberRow({ item, zebra }: { item: SuperadminOrgMemberItem; zebra: boolean }) {
  const u = item.user
  return (
    <tr className={`border-b border-sidebar-border/40 ${zebra ? 'bg-secondary/5' : ''}`}>
      <td className="px-3 py-2">
        <div className="font-medium">{u.email}</div>
        <div className="text-xs text-muted-foreground">
          {u.first_name} {u.last_name}
        </div>
      </td>
      <td className="px-3 py-2">{item.membership.role}</td>
      <td className="px-3 py-2">
        {u.is_active ? <span className="text-emerald-500">Активен</span> : <span className="text-destructive">Отключен</span>}
      </td>
    </tr>
  )
}
