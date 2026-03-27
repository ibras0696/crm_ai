import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Building2, User, CreditCard, Globe, Lock, Loader2, Check } from 'lucide-react'
import api, { orgApi } from '@/lib/api'

export default function SettingsPage() {
  const { user, org, members, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [profileForm, setProfileForm] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    timezone: user?.timezone ?? 'UTC',
  })
  const [orgName, setOrgName] = useState(org?.name ?? '')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [orgLoading, setOrgLoading] = useState(false)
  const [orgSaved, setOrgSaved] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const isOrgOwner = useMemo(() => {
    if (!user) return false
    return members.find((m) => m.user_id === user.id)?.role === 'owner'
  }, [members, user])

  const timezoneOptions = useMemo(() => {
    const base = [
      { value: 'Europe/Moscow', label: 'Москва (MSK, UTC+3)' },
      { value: 'Europe/Berlin', label: 'Европа: Берлин (CET/CEST)' },
      { value: 'Europe/London', label: 'Европа: Лондон (GMT/BST)' },
      { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
      { value: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
      { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
      { value: 'Asia/Almaty', label: 'Алматы (UTC+5)' },
      { value: 'UTC', label: 'UTC (универсальное время)' },
    ]
    const current = (profileForm.timezone || '').trim()
    if (current && !base.some((tz) => tz.value === current)) {
      return [{ value: current, label: `Текущий: ${current}` }, ...base]
    }
    return base
  }, [profileForm.timezone])

  const saveProfile = async () => {
    setProfileLoading(true)
    try {
      await api.patch('/auth/me', profileForm)
      await refresh()
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setProfileLoading(false)
    }
  }

  const saveOrg = async () => {
    setOrgLoading(true)
    try {
      await api.patch('/orgs/current', { name: orgName })
      await refresh()
      setOrgSaved(true)
      setTimeout(() => setOrgSaved(false), 2000)
    } catch {
      // ignore
    } finally {
      setOrgLoading(false)
    }
  }

  const deleteOrg = async () => {
    if (!isOrgOwner) {
      window.alert('Удалить организацию может только владелец.')
      return
    }
    if (!org) return
    const confirmed = window.confirm(`Удалить организацию "${org.name}"? Это действие необратимо.`)
    if (!confirmed) return

    setDeleteLoading(true)
    try {
      await orgApi.deleteCurrent()
      logout()
      navigate('/login')
    } catch {
      window.alert('Не удалось удалить организацию. Проверьте права и попробуйте снова.')
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
        <p className="text-muted-foreground mt-1">Управление аккаунтом и организацией</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <User className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Профиль</CardTitle>
              <CardDescription>Ваши личные данные</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Имя</Label>
              <Input
                value={profileForm.first_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, first_name: e.target.value }))}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label>Фамилия</Label>
              <Input
                value={profileForm.last_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, last_name: e.target.value }))}
                className="bg-secondary/50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Эл. почта</Label>
            <Input defaultValue={user?.email} disabled className="bg-secondary/30 opacity-60" />
            <p className="text-xs text-muted-foreground">Эл. почту нельзя изменить</p>
          </div>
          <div className="space-y-2">
            <Label>Часовой пояс</Label>
            <select
              value={profileForm.timezone}
              onChange={(e) => setProfileForm((p) => ({ ...p, timezone: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {timezoneOptions.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">Рекомендуем для России: Москва (MSK, UTC+3)</p>
          </div>
          <Button className="gradient-primary border-0 text-white" onClick={saveProfile} disabled={profileLoading}>
            {profileLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : profileSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {profileSaved ? 'Сохранено' : 'Сохранить'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2">
              <Building2 className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Организация</CardTitle>
              <CardDescription>Настройки организации</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Название организации</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="bg-secondary/50" />
          </div>
          <div className="space-y-2">
            <Label>Слаг</Label>
            <Input defaultValue={org?.slug} disabled className="bg-secondary/30 opacity-60 font-mono text-sm" />
          </div>
          <Button className="gradient-primary border-0 text-white" onClick={saveOrg} disabled={orgLoading}>
            {orgLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : orgSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {orgSaved ? 'Сохранено' : 'Обновить'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <CreditCard className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <CardTitle className="text-lg">Биллинг и план</CardTitle>
                <CardDescription>Управление подпиской</CardDescription>
              </div>
            </div>
            <Badge variant={org?.plan === 'free' ? 'secondary' : 'default'} className="uppercase text-xs">
              {org?.plan ?? 'free'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/50 bg-secondary/20 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Бесплатный план</p>
                <p className="text-sm text-muted-foreground">Базовые функции для небольших команд</p>
              </div>
              <p className="text-2xl font-bold">0 ₽<span className="text-sm font-normal text-muted-foreground">/мес</span></p>
            </div>
            <Separator className="bg-border/50" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>До 10 участников</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span>Базовый RBAC</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="gradient-primary border-0 text-white flex-1"
                onClick={() => navigate('/billing')}
              >
                Открыть биллинг
              </Button>
              <Badge variant="secondary" className="text-xs">
                Team скоро
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Опасная зона</CardTitle>
          <CardDescription>Необратимые действия</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 p-4">
            <div>
              <p className="text-sm font-medium">Удалить организацию</p>
              <p className="text-xs text-muted-foreground">Безвозвратно удалить организацию и все ее данные</p>
            </div>
            {isOrgOwner ? (
              <Button variant="destructive" size="sm" onClick={deleteOrg} disabled={deleteLoading}>
                {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить'}
              </Button>
            ) : (
              <Badge variant="secondary" className="text-xs">Только владелец</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
