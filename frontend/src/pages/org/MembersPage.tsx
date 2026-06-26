import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { orgApi } from '@/lib/api'
import {
  UserPlus,
  Mail,
  Shield,
  MoreHorizontal,
  Crown,
  Users,
  X,
  Loader2,
  CheckCircle,
} from 'lucide-react'

/** Role display labels */
const roleLabels: Record<string, string> = {
  owner: 'Владелец',
  admin: 'Админ',
  manager: 'Менеджер',
  employee: 'Сотрудник',
  readonly: 'Только чтение',
}

/** Tailwind classes for role badge — colored pill */
const roleBadgeClass: Record<string, string> = {
  owner: 'bg-amber-500/15 text-amber-600 border-amber-500/25',
  admin: 'bg-violet-500/15 text-violet-600 border-violet-500/25',
  manager: 'bg-blue-500/15 text-blue-600 border-blue-500/25',
  employee: 'bg-secondary text-muted-foreground border-border',
  readonly: 'bg-secondary/50 text-muted-foreground border-border',
}

const roleIcons: Record<string, typeof Crown> = {
  owner: Crown,
  admin: Shield,
}

export default function MembersPage() {
  const { members, org, refresh } = useAuth()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('employee')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState('Приглашение отправлено')
  const [inviteError, setInviteError] = useState('')

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
    if (code === 'NOT_FOUND') return 'Пользователь не найден.'
    return message || 'Не удалось отправить приглашение.'
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteLoading(true)
    setInviteError('')
    setInviteSuccess(false)
    try {
      const resp = await orgApi.createInvite({ email: inviteEmail, role: inviteRole })
      if (resp.data.ok) {
        const exists = resp.data.data?.invitee_exists
        setInviteSuccessMessage(
          exists
            ? 'Приглашение отправлено пользователю.'
            : 'Пользователь еще не зарегистрирован. Ссылка-приглашение отправлена на email.',
        )
        setInviteSuccess(true)
        setInviteEmail('')
        setTimeout(() => {
          setInviteSuccess(false)
          setShowInvite(false)
        }, 2000)
        await refresh()
      } else {
        setInviteError(resp.data.error?.message || 'Не удалось отправить приглашение.')
      }
    } catch (err: any) {
      setInviteError(mapInviteError(err))
    } finally {
      setInviteLoading(false)
    }
  }

  return (
    <div className="space-y-5 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Команда</h1>
          <p className="text-muted-foreground mt-1 text-sm">Управление участниками и ролями</p>
        </div>
        {/* Desktop invite button */}
        <Button
          onClick={() => setShowInvite(!showInvite)}
          className="hidden md:flex gradient-primary border-0 text-white"
        >
          {showInvite ? <X className="h-4 w-4 mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
          {showInvite ? 'Отмена' : 'Пригласить'}
        </Button>
      </div>

      {/* Invite Form */}
      {showInvite && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <form onSubmit={handleInvite} className="flex flex-col gap-4">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Эл. почта</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="коллега@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    className="pl-9 h-11 bg-background"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="invite-role">Роль</Label>
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="admin">Админ</option>
                    <option value="manager">Менеджер</option>
                    <option value="employee">Сотрудник</option>
                    <option value="readonly">Только чтение</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={inviteLoading} className="h-11 px-6">
                    {inviteLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : inviteSuccess ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      'Отправить'
                    )}
                  </Button>
                </div>
              </div>
            </form>
            {inviteError && (
              <p className="mt-3 text-sm text-red-400">{inviteError}</p>
            )}
            {inviteSuccess && (
              <p className="mt-3 text-sm text-emerald-400">{inviteSuccessMessage}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-3 grid-cols-3">
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2.5 shrink-0">
              <Users className="h-4 w-4 md:h-5 md:w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xl md:text-2xl font-bold">{members.length}</p>
              <p className="text-xs text-muted-foreground">Участников</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2.5 shrink-0">
              <Shield className="h-4 w-4 md:h-5 md:w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xl md:text-2xl font-bold">{members.filter(m => m.role === 'admin' || m.role === 'owner').length}</p>
              <p className="text-xs text-muted-foreground">Админы</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5 shrink-0">
              <Crown className="h-4 w-4 md:h-5 md:w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xl md:text-2xl font-bold uppercase">{org?.plan ?? 'free'}</p>
              <p className="text-xs text-muted-foreground">Тариф</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Members list — desktop table */}
      <Card className="hidden md:block border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Все участники</CardTitle>
          <CardDescription>Люди с доступом к {org?.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <div className="col-span-5">Участник</div>
              <div className="col-span-3">Роль</div>
              <div className="col-span-3">Присоединился</div>
              <div className="col-span-1"></div>
            </div>

            {members.map((m) => {
              const initials = `${m.user_first_name?.[0] ?? ''}${m.user_last_name?.[0] ?? ''}`.toUpperCase()
              const RoleIcon = roleIcons[m.role]
              return (
                <div
                  key={m.id}
                  className="grid grid-cols-12 gap-4 items-center rounded-lg px-4 py-3 hover:bg-secondary/30 transition-colors border-b border-border/30 last:border-0"
                >
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback className="bg-primary/20 text-primary text-sm font-bold">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{m.user_first_name} {m.user_last_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.user_email}</p>
                    </div>
                  </div>
                  <div className="col-span-3 flex items-center gap-2">
                    {RoleIcon && <RoleIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${roleBadgeClass[m.role] ?? roleBadgeClass.employee}`}>
                      {roleLabels[m.role] ?? m.role}
                    </span>
                  </div>
                  <div className="col-span-3">
                    <span className="text-sm text-muted-foreground">-</span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}

            {members.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Users className="h-12 w-12 mb-4 opacity-30" />
                <p className="text-lg font-medium">Пока нет участников</p>
                <p className="text-sm">Пригласите команду для начала</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Members list — mobile contacts view */}
      <div className="md:hidden">
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60">
            <p className="text-sm font-semibold">Все участники</p>
            <p className="text-xs text-muted-foreground">{org?.name}</p>
          </div>

          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-base font-medium">Пока нет участников</p>
              <p className="text-sm mt-1">Пригласите команду для начала</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {members.map((m) => {
                const initials = `${m.user_first_name?.[0] ?? ''}${m.user_last_name?.[0] ?? ''}`.toUpperCase() || '?'
                const RoleIcon = roleIcons[m.role]
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3 min-h-[60px]">
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-full bg-primary/20 text-primary text-sm font-bold flex items-center justify-center shrink-0">
                      {initials}
                    </div>
                    {/* Name + email + role */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium leading-tight truncate">
                          {m.user_first_name} {m.user_last_name}
                        </p>
                        {RoleIcon && <RoleIcon className="h-3 w-3 text-muted-foreground shrink-0" />}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${roleBadgeClass[m.role] ?? roleBadgeClass.employee}`}>
                          {roleLabels[m.role] ?? m.role}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{m.user_email}</p>
                    </div>
                    {/* Kebab */}
                    <button className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary/60 transition-colors shrink-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mobile FAB — invite */}
      <button
        onClick={() => setShowInvite(!showInvite)}
        className="md:hidden fixed bottom-[5rem] right-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors active:scale-95"
        aria-label="Пригласить участника"
      >
        {showInvite ? <X className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
      </button>
    </div>
  )
}
