import { useState, useEffect, useCallback } from 'react'
import { orgApi, accessApi, reportsApi, type AccessRule } from '@/lib/api'
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
  { value: 'ai', label: 'AI', icon: Brain },
  { value: 'schedule', label: 'Расписание', icon: Calendar },
  { value: 'reports', label: 'Отчёты', icon: BarChart3 },
]

export default function AdminPage() {
  const [tab, setTab] = useState<'members' | 'access' | 'org'>('members')
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [rules, setRules] = useState<AccessRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'employee' })
  const [saving, setSaving] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [showAddRule, setShowAddRule] = useState(false)
  const [ruleForm, setRuleForm] = useState({ resource_type: 'table', role: 'employee', can_read: true, can_write: true, can_delete: false })
  const [summary, setSummary] = useState<{ tables_count: number; records_count: number; columns_count: number } | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
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
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const mapInviteError = (err: any): string => {
    const code = err?.response?.data?.error?.code
    const message = err?.response?.data?.error?.message
    if (code === 'CONFLICT') return 'Пользователь уже в организации или приглашение уже отправлено.'
    if (code === 'VALIDATION_ERROR') return message || 'Проверьте email и попробуйте снова.'
    if (code === 'RATE_LIMIT' || code === 'RATE_LIMITED') return 'Слишком много приглашений. Попробуйте через минуту.'
    return message || 'Не удалось отправить приглашение.'
  }

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) return
    setSaving(true)
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
    try {
      await orgApi.updateMemberRole(membershipId, newRole)
      loadAll()
    } catch { /* ignore */ }
  }

  const handleRemoveMember = async (membershipId: string) => {
    try {
      await orgApi.removeMember(membershipId)
      loadAll()
    } catch { /* ignore */ }
  }

  const handleAddRule = async () => {
    setSaving(true)
    try {
      await accessApi.create({ resource_type: ruleForm.resource_type, role: ruleForm.role, can_read: ruleForm.can_read, can_write: ruleForm.can_write, can_delete: ruleForm.can_delete })
      setShowAddRule(false)
      loadAll()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleDeleteRule = async (id: string) => {
    try {
      await accessApi.delete(id)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch { /* ignore */ }
  }

  const handleToggleRulePerm = async (rule: AccessRule, field: 'can_read' | 'can_write' | 'can_delete') => {
    try {
      const r = await accessApi.update(rule.id, { [field]: !rule[field] })
      if (r.data.ok && r.data.data) setRules(prev => prev.map(x => x.id === rule.id ? r.data.data as AccessRule : x))
    } catch { /* ignore */ }
  }

  const roleLabel = (r: string) => ROLES.find(x => x.value === r)?.label || r
  const roleColor = (r: string) => ROLES.find(x => x.value === r)?.color || ''

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
        {([['members', 'Участники'], ['access', 'Доступ'], ['org', 'Организация']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === key ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

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
                  className={`text-xs font-medium px-2 py-1 rounded-md border border-border bg-background ${roleColor(m.role)}`}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {m.role !== 'owner' && (
                  <button onClick={() => handleRemoveMember(m.id)} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
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
              <p className="text-xs mt-1">По умолчанию все участники имеют полный доступ</p>
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
                        {rule.role ? `Роль: ${roleLabel(rule.role)}` : rule.user_id ? `Пользователь: ${rule.user_id.slice(0, 8)}...` : '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(['can_read', 'can_write', 'can_delete'] as const).map(perm => (
                        <button key={perm} onClick={() => handleToggleRulePerm(rule, perm)}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors ${rule[perm] ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-secondary/50 text-muted-foreground border-border'}`}>
                          {perm === 'can_read' ? 'Чтение' : perm === 'can_write' ? 'Запись' : 'Удаление'}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => handleDeleteRule(rule.id)} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all">
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
              <label className="text-xs text-muted-foreground block mb-1">Роль</label>
              <select value={ruleForm.role} onChange={e => setRuleForm(f => ({ ...f, role: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
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
              <button onClick={handleAddRule} disabled={saving} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {saving ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
