import { useState, useEffect, useCallback } from 'react'
import { orgApi, accessApi, reportsApi, type AccessRule, type OrgAILimitsInfo } from '@/lib/api'
import { Users, Shield, Settings, Plus, Trash2, X, UserPlus, Crown, BarChart3, Database, Brain, Calendar, FileText, Table2 } from 'lucide-react'

interface Member {
  id: string; user_id: string; org_id: string; role: string
  user_email: string | null; user_first_name: string | null; user_last_name: string | null
  created_at: string
}

interface OrgInfo { id: string; name: string; slug: string; plan: string; created_at: string }

const ROLES = [
  { value: 'owner', label: 'Владелец', color: 'text-amber-500' },
  { value: 'admin', label: 'Админ', color: 'text-blue-500' },
  { value: 'manager', label: 'Менеджер', color: 'text-violet-500' },
  { value: 'employee', label: 'Сотрудник', color: 'text-emerald-500' },
  { value: 'readonly', label: 'Только чтение', color: 'text-muted-foreground' },
]

const RESOURCE_TYPES = [
  { value: 'table', label: 'Таблицы', icon: Table2 },
  { value: 'knowledge', label: 'База знаний', icon: FileText },
  { value: 'files', label: 'Документы', icon: FileText },
  { value: 'ai', label: 'AI', icon: Brain },
  { value: 'schedule', label: 'Расписание', icon: Calendar },
  { value: 'reports', label: 'Аналитика', icon: BarChart3 },
]

export default function AdminPage() {
  const [tab, setTab] = useState<'members' | 'access' | 'org' | 'ai_limits'>('members')
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [rules, setRules] = useState<AccessRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'employee' })
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [showAddRule, setShowAddRule] = useState(false)
  const [ruleForm, setRuleForm] = useState({
    resource_type: 'table',
    subject_type: 'role' as 'role' | 'user',
    role: 'employee',
    user_id: '',
    can_read: true,
    can_write: true,
    can_delete: false,
  })
  const [summary, setSummary] = useState<{ tables_count: number; records_count: number; columns_count: number } | null>(null)
  const [aiLimits, setAiLimits] = useState<OrgAILimitsInfo | null>(null)
  const [orgAiDraft, setOrgAiDraft] = useState({ daily_tokens_limit: 0, monthly_tokens_limit: 0 })
  const [savingOrgLimits, setSavingOrgLimits] = useState(false)
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null)
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null)
  const [aiLimitsError, setAiLimitsError] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setPageError('')
    try {
      const [orgR, memR, rulesR, sumR] = await Promise.all([
        orgApi.getCurrent(),
        orgApi.getMembers(),
        accessApi.list(),
        reportsApi.summary(),
      ])
      if (orgR.data.ok && orgR.data.data) setOrg(orgR.data.data as OrgInfo)
      if (memR.data.ok && memR.data.data) setMembers(memR.data.data as Member[])
      if (rulesR.data.ok && rulesR.data.data) setRules(rulesR.data.data as AccessRule[])
      if (sumR.data.ok && sumR.data.data) setSummary(sumR.data.data as any)
      const aiR = await orgApi.getAiLimits()
      if (aiR.data.ok && aiR.data.data) {
        const data = aiR.data.data as OrgAILimitsInfo
        setAiLimits(data)
        setOrgAiDraft({
          daily_tokens_limit: Number(data.org_limits.daily_tokens_limit || 0),
          monthly_tokens_limit: Number(data.org_limits.monthly_tokens_limit || 0),
        })
      }
    } catch (e: any) {
      setPageError(e?.response?.data?.error?.message || 'Не удалось загрузить данные админ-панели.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const clearActionState = () => {
    setActionError('')
    setActionSuccess('')
  }

  const mapAccessError = (err: any): string => {
    const code = err?.response?.data?.error?.code
    const message = err?.response?.data?.error?.message
    if (code === 'FORBIDDEN') return 'У вас нет прав для изменения правил доступа.'
    if (code === 'NOT_FOUND') return 'Правило доступа не найдено.'
    if (code === 'CONFLICT') return 'Такое правило уже существует.'
    if (code === 'VALIDATION_ERROR') return message || 'Проверьте параметры правила доступа.'
    return message || 'Не удалось изменить правила доступа.'
  }

  const mapMemberError = (err: any): string => {
    const code = err?.response?.data?.error?.code
    const message = err?.response?.data?.error?.message
    if (code === 'FORBIDDEN') return 'У вас нет прав для управления участниками.'
    if (code === 'NOT_FOUND') return 'Участник не найден.'
    if (code === 'VALIDATION_ERROR') {
      if (message === 'Cannot remove the last owner of an organization' || message === 'Cannot remove the last owner') {
        return 'Нельзя убрать последнего владельца организации.'
      }
      return message || 'Проверьте данные участника.'
    }
    return message || 'Не удалось изменить участника.'
  }

  const mapInviteError = (err: any): string => {
    const code = err?.response?.data?.error?.code
    const message = err?.response?.data?.error?.message
    if (code === 'CONFLICT') {
      const normalized = String(message || '').toLowerCase()
      if (normalized.includes('pending invite already exists')) {
        return 'Для этого email уже есть активное приглашение.'
      }
      if (normalized.includes('already a member')) {
        return 'Пользователь уже состоит в организации.'
      }
      return 'Конфликт данных приглашения. Проверьте email.'
    }
    if (code === 'VALIDATION_ERROR') return message || 'Проверьте email и попробуйте снова.'
    if (code === 'RATE_LIMIT' || code === 'RATE_LIMITED') return 'Слишком много приглашений. Попробуйте через минуту.'
    return message || 'Не удалось отправить приглашение.'
  }

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) return
    setSaving(true)
    clearActionState()
    setInviteError('')
    setInviteSuccess('')
    try {
      const resp = await orgApi.createInvite({ email: inviteForm.email, role: inviteForm.role })
      if (!resp.data.ok) {
        setInviteError(resp.data.error?.message || 'Не удалось отправить приглашение.')
        return
      }
      const exists = resp.data.data?.invitee_exists
      setInviteSuccess(
        exists
          ? 'Приглашение отправлено зарегистрированному пользователю.'
          : 'Пользователь еще не зарегистрирован. Ссылка отправлена на email.',
      )
      loadAll()
      setTimeout(() => {
        setShowInvite(false)
        setInviteForm({ email: '', role: 'employee' })
        setInviteSuccess('')
      }, 1400)
    } catch (e: any) {
      setInviteError(mapInviteError(e))
    }
    setSaving(false)
  }

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    clearActionState()
    setSavingMemberId(membershipId)
    try {
      const resp = await orgApi.updateMemberRole(membershipId, newRole)
      if (!resp.data.ok) {
        setActionError(resp.data.error?.message || 'Не удалось изменить роль участника.')
        return
      }
      setActionSuccess('Роль участника обновлена.')
      await loadAll()
    } catch (e: any) {
      setActionError(mapMemberError(e))
    } finally {
      setSavingMemberId(null)
    }
  }

  const handleRemoveMember = async (membershipId: string) => {
    clearActionState()
    setSavingMemberId(membershipId)
    try {
      const resp = await orgApi.removeMember(membershipId)
      if (!resp.data.ok) {
        setActionError(resp.data.error?.message || 'Не удалось удалить участника.')
        return
      }
      setActionSuccess('Участник удалён из организации.')
      await loadAll()
    } catch (e: any) {
      setActionError(mapMemberError(e))
    } finally {
      setSavingMemberId(null)
    }
  }

  const handleAddRule = async () => {
    setSaving(true)
    clearActionState()
    try {
      const resp = await accessApi.create({
        resource_type: ruleForm.resource_type,
        role: ruleForm.subject_type === 'role' ? ruleForm.role : undefined,
        user_id: ruleForm.subject_type === 'user' ? ruleForm.user_id : undefined,
        can_read: ruleForm.can_read,
        can_write: ruleForm.can_write,
        can_delete: ruleForm.can_delete,
      })
      if (!resp.data.ok) {
        setActionError(resp.data.error?.message || 'Не удалось создать правило доступа.')
        return
      }
      setShowAddRule(false)
      setRuleForm({
        resource_type: 'table',
        subject_type: 'role',
        role: 'employee',
        user_id: '',
        can_read: true,
        can_write: true,
        can_delete: false,
      })
      setActionSuccess('Правило доступа создано.')
      await loadAll()
    } catch (e: any) {
      setActionError(mapAccessError(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRule = async (id: string) => {
    clearActionState()
    setSavingRuleId(id)
    try {
      const resp = await accessApi.delete(id)
      if (!resp.data.ok) {
        setActionError(resp.data.error?.message || 'Не удалось удалить правило доступа.')
        return
      }
      setRules(prev => prev.filter(r => r.id !== id))
      setActionSuccess('Правило доступа удалено.')
    } catch (e: any) {
      setActionError(mapAccessError(e))
    } finally {
      setSavingRuleId(null)
    }
  }

  const handleToggleRulePerm = async (rule: AccessRule, field: 'can_read' | 'can_write' | 'can_delete') => {
    clearActionState()
    setSavingRuleId(rule.id)
    try {
      const r = await accessApi.update(rule.id, { [field]: !rule[field] })
      if (r.data.ok && r.data.data) {
        setRules(prev => prev.map(x => x.id === rule.id ? r.data.data as AccessRule : x))
        setActionSuccess('Правило доступа обновлено.')
      } else {
        setActionError(r.data.error?.message || 'Не удалось обновить правило доступа.')
      }
    } catch (e: any) {
      setActionError(mapAccessError(e))
    } finally {
      setSavingRuleId(null)
    }
  }

  const roleLabel = (r: string) => ROLES.find(x => x.value === r)?.label || r
  const roleColor = (r: string) => ROLES.find(x => x.value === r)?.color || ''
  const memberLabel = (userId: string | null | undefined) => {
    const member = members.find((item) => item.user_id === userId)
    if (!member) return userId || 'Пользователь'
    const fullName = `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim()
    return fullName || member.user_email || userId || 'Пользователь'
  }

  const mapAiLimitsError = (err: any): string => {
    const code = err?.response?.data?.error?.code
    const message = err?.response?.data?.error?.message
    if (code === 'MEMBER_NOT_FOUND') return 'Сотрудник не найден в организации.'
    if (code === 'VALIDATION_ERROR') return message || 'Проверьте значения лимитов.'
    return message || 'Не удалось сохранить AI лимиты.'
  }

  const saveOrgAiLimits = async () => {
    setAiLimitsError('')
    const daily = Math.max(0, Number(orgAiDraft.daily_tokens_limit || 0))
    const monthly = Math.max(0, Number(orgAiDraft.monthly_tokens_limit || 0))
    if (!Number.isFinite(daily) || !Number.isFinite(monthly)) {
      setAiLimitsError('Введите корректные числовые лимиты.')
      return
    }
    setSavingOrgLimits(true)
    try {
      const r = await orgApi.updateAiOrgLimits({
        daily_tokens_limit: Math.trunc(daily),
        monthly_tokens_limit: Math.trunc(monthly),
      })
      if (r.data.ok && r.data.data) {
        const data = r.data.data as OrgAILimitsInfo
        setAiLimits(data)
        setOrgAiDraft({
          daily_tokens_limit: Number(data.org_limits.daily_tokens_limit || 0),
          monthly_tokens_limit: Number(data.org_limits.monthly_tokens_limit || 0),
        })
      } else {
        setAiLimitsError(r.data.error?.message || 'Не удалось сохранить лимиты организации.')
      }
    } catch (e: any) {
      setAiLimitsError(mapAiLimitsError(e))
    }
    setSavingOrgLimits(false)
  }

  const saveUserAiLimits = async (userId: string, dailyLimit: number, rpmLimit: number) => {
    setAiLimitsError('')
    const daily = Math.max(0, Number(dailyLimit || 0))
    const rpm = Math.max(0, Number(rpmLimit || 0))
    if (!Number.isFinite(daily) || !Number.isFinite(rpm)) {
      setAiLimitsError('Введите корректные лимиты сотрудника.')
      return
    }
    setSavingUserId(userId)
    try {
      const r = await orgApi.upsertAiUserLimits(userId, {
        daily_tokens_limit: Math.trunc(daily),
        rpm_limit: Math.trunc(rpm),
      })
      if (r.data.ok && r.data.data) {
        setAiLimits(r.data.data as OrgAILimitsInfo)
      } else {
        setAiLimitsError(r.data.error?.message || 'Не удалось сохранить лимит сотрудника.')
      }
    } catch (e: any) {
      setAiLimitsError(mapAiLimitsError(e))
    }
    setSavingUserId(null)
  }

  if (loading) return <div className="flex items-center justify-center py-32"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6 text-primary" /> Админ-панель</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{org?.name || '—'} · Тариф: {org?.plan || '—'}</p>
        </div>
      </div>

      {pageError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {pageError}
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
          {actionSuccess}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Участников', value: members.length, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Таблиц', value: summary?.tables_count ?? 0, icon: Database, color: 'text-violet-500', bg: 'bg-violet-500/10' },
          { label: 'Записей', value: summary?.records_count ?? 0, icon: Table2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Правил доступа', value: rules.length, icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${card.bg} flex items-center justify-center shrink-0`}>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold">{card.value.toLocaleString('ru')}</p>
              <p className="text-xs text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-secondary/30 w-fit">
        {([['members', 'Участники'], ['access', 'Доступ'], ['ai_limits', 'AI лимиты'], ['org', 'Организация']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai_limits' && (
        <div className="space-y-4">
          {aiLimitsError && <div className="text-sm text-red-500">{aiLimitsError}</div>}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /> Лимиты организации</h2>
            <div className="text-xs text-muted-foreground">
              Тариф по умолчанию: {aiLimits?.effective_defaults.plan_daily_tokens_limit || 0} токенов/день, {aiLimits?.effective_defaults.plan_rpm_per_user || 0} req/min на пользователя.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Дневной лимит токенов (org)</span>
                <input
                  type="number"
                  min={0}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                  value={orgAiDraft.daily_tokens_limit}
                  onChange={(e) => setOrgAiDraft((p) => ({ ...p, daily_tokens_limit: Number(e.target.value || 0) }))}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Месячный лимит токенов (org)</span>
                <input
                  type="number"
                  min={0}
                  className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm"
                  value={orgAiDraft.monthly_tokens_limit}
                  onChange={(e) => setOrgAiDraft((p) => ({ ...p, monthly_tokens_limit: Number(e.target.value || 0) }))}
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                onClick={saveOrgAiLimits}
                disabled={savingOrgLimits}
                className="h-9 px-4 rounded-lg bg-primary text-white text-sm disabled:opacity-50"
              >
                {savingOrgLimits ? 'Сохранение...' : 'Сохранить лимиты org'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-semibold">Лимиты сотрудников</div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="px-3 py-2 text-left">Сотрудник</th>
                    <th className="px-3 py-2 text-center">Роль</th>
                    <th className="px-3 py-2 text-center">Usage день</th>
                    <th className="px-3 py-2 text-center">Usage месяц</th>
                    <th className="px-3 py-2 text-center">Req/min</th>
                    <th className="px-3 py-2 text-center">Daily limit</th>
                    <th className="px-3 py-2 text-center">RPM limit</th>
                    <th className="px-3 py-2 text-center">Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {(aiLimits?.users || []).map((u, idx) => (
                    <UserLimitRow
                      key={u.user_id}
                      item={u}
                      zebra={idx % 2 === 1}
                      saving={savingUserId === u.user_id}
                      onSave={(daily, rpm) => saveUserAiLimits(u.user_id, daily, rpm)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Members tab */}
      {tab === 'members' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Участники ({members.length})</h2>
            <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-white text-sm hover:bg-primary/90 transition-colors">
              <UserPlus className="h-3.5 w-3.5" /> Пригласить
            </button>
          </div>
          <div className="divide-y divide-border">
            {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors group">
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-sm font-medium shrink-0">
                  {(m.user_first_name || m.user_email || '?').charAt(0).toUpperCase()}
                  </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.user_first_name} {m.user_last_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.user_email}</p>
                </div>
                <select value={m.role} onChange={e => handleRoleChange(m.id, e.target.value)}
                  disabled={savingMemberId === m.id}
                  className={`text-xs font-medium px-2 py-1 rounded-md border border-border bg-background disabled:opacity-50 ${roleColor(m.role)}`}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {m.role !== 'owner' && (
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    disabled={savingMemberId === m.id}
                    className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Access tab */}
      {tab === 'access' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Shield className="h-4 w-4" /> Правила доступа ({rules.length})</h2>
            <button onClick={() => setShowAddRule(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-white text-sm hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Добавить правило
            </button>
          </div>
          {rules.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>Нет правил доступа</p>
              <p className="text-xs mt-1">Пока отдельных правил нет, доступ определяется ролью пользователя.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rules.map(rule => {
                const rt = RESOURCE_TYPES.find(r => r.value === rule.resource_type)
                const Icon = rt?.icon || Database
                return (
                  <div key={rule.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors group">
                    <div className="h-8 w-8 rounded-lg bg-secondary/50 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{rt?.label || rule.resource_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {rule.role ? `Роль: ${roleLabel(rule.role)}` : rule.user_id ? `Пользователь: ${memberLabel(rule.user_id)}` : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(['can_read', 'can_write', 'can_delete'] as const).map(perm => (
                        <button
                          key={perm}
                          onClick={() => handleToggleRulePerm(rule, perm)}
                          disabled={savingRuleId === rule.id}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors disabled:opacity-50 ${rule[perm] ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-secondary/50 text-muted-foreground border-border'}`}
                        >
                          {perm === 'can_read' ? 'Чтение' : perm === 'can_write' ? 'Запись' : 'Удаление'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => handleDeleteRule(rule.id)}
                      disabled={savingRuleId === rule.id}
                      className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Org tab */}
      {tab === 'org' && org && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4 max-w-lg">
          <h2 className="font-semibold flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /> Организация</h2>
          <div className="space-y-3">
            {[
              { label: 'Название', value: org.name },
              { label: 'Slug', value: org.slug },
              { label: 'Тариф', value: org.plan },
              { label: 'Создана', value: new Date(org.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) },
              { label: 'ID', value: org.id },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-24 shrink-0">{row.label}</span>
                <span className="text-sm font-medium">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowInvite(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Пригласить участника</h2>
              <button onClick={() => setShowInvite(false)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <input value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" type="email" className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary" />
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Роль</label>
              <select value={inviteForm.role} onChange={e => setInviteForm(f => ({ ...f, role: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                {ROLES.filter(r => r.value !== 'owner').map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowInvite(false)} className="flex-1 h-10 rounded-lg border border-border text-sm hover:bg-secondary transition-colors">Отмена</button>
              <button onClick={handleInvite} disabled={saving || !inviteForm.email.trim()} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saving ? 'Отправка...' : 'Пригласить'}
              </button>
            </div>
            {inviteError && (
              <p className="text-sm text-red-500">{inviteError}</p>
            )}
            {inviteSuccess && (
              <p className="text-sm text-emerald-500">{inviteSuccess}</p>
            )}
          </div>
        </div>
      )}

      {/* Add rule modal */}
      {showAddRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowAddRule(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Новое правило доступа</h2>
              <button onClick={() => setShowAddRule(false)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Ресурс</label>
              <select value={ruleForm.resource_type} onChange={e => setRuleForm(f => ({ ...f, resource_type: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                {RESOURCE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Кому выдать</label>
              <select
                value={ruleForm.subject_type}
                onChange={e => setRuleForm(f => ({ ...f, subject_type: e.target.value as 'role' | 'user' }))}
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
              >
                <option value="role">По роли</option>
                <option value="user">Конкретному пользователю</option>
              </select>
            </div>
            {ruleForm.subject_type === 'role' ? (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Роль</label>
                <select value={ruleForm.role} onChange={e => setRuleForm(f => ({ ...f, role: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Пользователь</label>
                <select
                  value={ruleForm.user_id}
                  onChange={e => setRuleForm(f => ({ ...f, user_id: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
                >
                  <option value="">Выберите участника</option>
                  {members.map(member => (
                    <option key={member.id} value={member.user_id}>
                      {memberLabel(member.user_id)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-4">
              {[
                { key: 'can_read', label: 'Чтение' },
                { key: 'can_write', label: 'Запись' },
                { key: 'can_delete', label: 'Удаление' },
              ].map(p => (
                <label key={p.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={(ruleForm as any)[p.key]} onChange={e => setRuleForm(f => ({ ...f, [p.key]: e.target.checked }))} className="rounded" />
                  {p.label}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowAddRule(false)} className="flex-1 h-10 rounded-lg border border-border text-sm hover:bg-secondary transition-colors">Отмена</button>
              <button onClick={handleAddRule} disabled={saving || (ruleForm.subject_type === 'user' && !ruleForm.user_id)} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saving ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UserLimitRow({
  item,
  zebra,
  saving,
  onSave,
}: {
  item: OrgAILimitsInfo['users'][number]
  zebra: boolean
  saving: boolean
  onSave: (daily: number, rpm: number) => void
}) {
  const [daily, setDaily] = useState<number>(Number(item.daily_tokens_limit || 0))
  const [rpm, setRpm] = useState<number>(Number(item.rpm_limit || 0))

  useEffect(() => {
    setDaily(Number(item.daily_tokens_limit || 0))
    setRpm(Number(item.rpm_limit || 0))
  }, [item.daily_tokens_limit, item.rpm_limit, item.user_id])

  return (
    <tr className={`border-b border-border/40 ${zebra ? 'bg-secondary/5' : ''}`}>
      <td className="px-3 py-2">
        <div className="font-medium">{[item.first_name, item.last_name].filter(Boolean).join(' ') || item.email || item.user_id}</div>
        <div className="text-xs text-muted-foreground">{item.email || item.user_id}</div>
      </td>
      <td className="px-3 py-2 text-center">{item.role}</td>
      <td className="px-3 py-2 text-center">{Number(item.usage_today_tokens || 0).toLocaleString('ru-RU')}</td>
      <td className="px-3 py-2 text-center">{Number(item.usage_month_tokens || 0).toLocaleString('ru-RU')}</td>
      <td className="px-3 py-2 text-center">{Number(item.usage_last_min_requests || 0)}</td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          className="w-28 h-8 px-2 rounded border border-input bg-background text-xs"
          value={daily}
          onChange={(e) => setDaily(Number(e.target.value || 0))}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          className="w-20 h-8 px-2 rounded border border-input bg-background text-xs"
          value={rpm}
          onChange={(e) => setRpm(Number(e.target.value || 0))}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <button
          disabled={saving}
          onClick={() => onSave(Math.max(0, Math.trunc(daily || 0)), Math.max(0, Math.trunc(rpm || 0)))}
          className="h-8 px-3 rounded border border-border text-xs hover:bg-secondary disabled:opacity-50"
        >
          {saving ? '...' : 'Сохранить'}
        </button>
      </td>
    </tr>
  )
}
