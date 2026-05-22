import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Building2, User, CreditCard, Globe, Lock, Loader2, Check } from 'lucide-react'
import api, { filesApi, orgApi, profileApi } from '@/lib/api'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import type { AppLocale } from '@/lib/i18n'
import { isI18nEnabled } from '@/lib/featureFlags'

export default function SettingsPage() {
  const { user, org, members, refresh, logout } = useAuth()
  const { t } = useTranslation(['common', 'settings'])
  const localeEnabled = isI18nEnabled()
  const navigate = useNavigate()
  const [profileForm, setProfileForm] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    timezone: user?.timezone ?? 'UTC',
    locale: user?.locale ?? 'ru',
    avatar_url: user?.avatar_url ?? '',
  })
  const [orgName, setOrgName] = useState(org?.name ?? '')
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [orgLoading, setOrgLoading] = useState(false)
  const [orgSaved, setOrgSaved] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  useEffect(() => {
    setProfileForm({
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      timezone: user?.timezone ?? 'UTC',
      locale: user?.locale ?? 'ru',
      avatar_url: user?.avatar_url ?? '',
    })
  }, [user?.first_name, user?.last_name, user?.timezone, user?.locale, user?.avatar_url])

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const uploaded = await filesApi.upload(file)
      const fileId = uploaded.data.data?.id
      if (uploaded.data.ok && fileId) {
        setProfileForm((prev) => ({ ...prev, avatar_url: filesApi.downloadUrl(fileId) }))
      }
    } catch {
      // ignore
    } finally {
      setAvatarUploading(false)
      event.target.value = ''
    }
  }

  const isOrgOwner = useMemo(() => {
    if (!user) return false
    return members.find((m) => m.user_id === user.id)?.role === 'owner'
  }, [members, user])

  const timezoneOptions = useMemo(() => {
    const base = [
      { value: 'Europe/Moscow', label: t('settings:timezoneOptions.moscow') },
      { value: 'Europe/Berlin', label: t('settings:timezoneOptions.berlin') },
      { value: 'Europe/London', label: t('settings:timezoneOptions.london') },
      { value: 'Asia/Yekaterinburg', label: t('settings:timezoneOptions.yekaterinburg') },
      { value: 'Asia/Novosibirsk', label: t('settings:timezoneOptions.novosibirsk') },
      { value: 'Asia/Vladivostok', label: t('settings:timezoneOptions.vladivostok') },
      { value: 'Asia/Almaty', label: t('settings:timezoneOptions.almaty') },
      { value: 'UTC', label: t('settings:timezoneOptions.utc') },
    ]
    const current = (profileForm.timezone || '').trim()
    if (current && !base.some((tz) => tz.value === current)) {
      return [{ value: current, label: t('settings:timezoneOptions.current', { value: current }) }, ...base]
    }
    return base
  }, [profileForm.timezone, t])

  const saveProfile = async () => {
    setProfileLoading(true)
    try {
      await profileApi.update(profileForm)
      if (localeEnabled) {
        await i18n.changeLanguage(profileForm.locale as AppLocale)
      }
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
      window.alert(t('settings:dialogs.deleteOrgOwnerOnly'))
      return
    }
    if (!org) return
    const confirmed = window.confirm(t('settings:dialogs.deleteOrgConfirm', { name: org.name }))
    if (!confirmed) return

    setDeleteLoading(true)
    try {
      await orgApi.deleteCurrent()
      logout()
      navigate('/login')
    } catch {
      window.alert(t('settings:dialogs.deleteOrgFailed'))
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('settings:title')}</h1>
        <p className="text-muted-foreground mt-1">{t('settings:subtitle')}</p>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <User className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-lg">{t('settings:profile.title')}</CardTitle>
              <CardDescription>{t('settings:profile.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-14 w-14 border border-border/60">
              <AvatarImage src={profileForm.avatar_url || undefined} alt="avatar" />
              <AvatarFallback>{`${profileForm.first_name || ''} ${profileForm.last_name || ''}`.trim().slice(0, 2).toUpperCase() || 'U'}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <Label htmlFor="profile-avatar-upload">Аватар</Label>
              <Input
                id="profile-avatar-upload"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => void handleAvatarUpload(e)}
                disabled={avatarUploading}
                className="bg-secondary/50"
              />
              <p className="text-xs text-muted-foreground">
                {avatarUploading ? 'Загрузка...' : 'PNG/JPG/GIF/WEBP, загрузка в хранилище организации'}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('settings:fields.firstName')}</Label>
              <Input
                value={profileForm.first_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, first_name: e.target.value }))}
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings:fields.lastName')}</Label>
              <Input
                value={profileForm.last_name}
                onChange={(e) => setProfileForm((p) => ({ ...p, last_name: e.target.value }))}
                className="bg-secondary/50"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t('settings:fields.email')}</Label>
            <Input defaultValue={user?.email} disabled className="bg-secondary/30 opacity-60" />
            <p className="text-xs text-muted-foreground">{t('settings:hints.emailReadonly')}</p>
          </div>
          <div className="space-y-2">
            <Label>{t('settings:fields.timezone')}</Label>
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
            <p className="text-xs text-muted-foreground">{t('settings:hints.timezone')}</p>
          </div>
          {localeEnabled && (
            <div className="space-y-2">
              <Label>{t('settings:fields.locale')}</Label>
              <select
                value={profileForm.locale}
                onChange={(e) => setProfileForm((p) => ({ ...p, locale: e.target.value as 'ru' | 'en' }))}
                className="flex h-10 w-full rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ru">{t('common:language.russian')}</option>
                <option value="en">{t('common:language.english')}</option>
              </select>
            </div>
          )}
          <Button className="gradient-primary border-0 text-white" onClick={saveProfile} disabled={profileLoading}>
            {profileLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : profileSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {profileSaved ? t('settings:actions.saved') : t('settings:actions.save')}
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
              <CardTitle className="text-lg">{t('settings:organization.title')}</CardTitle>
              <CardDescription>{t('settings:organization.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t('settings:organization.name')}</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="bg-secondary/50" />
          </div>
          <div className="space-y-2">
            <Label>{t('settings:organization.slug')}</Label>
            <Input defaultValue={org?.slug} disabled className="bg-secondary/30 opacity-60 font-mono text-sm" />
          </div>
          <Button className="gradient-primary border-0 text-white" onClick={saveOrg} disabled={orgLoading}>
            {orgLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : orgSaved ? <Check className="h-4 w-4 mr-2" /> : null}
            {orgSaved ? t('settings:actions.saved') : t('settings:organization.update')}
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
                <CardTitle className="text-lg">{t('settings:billing.title')}</CardTitle>
                <CardDescription>{t('settings:billing.description')}</CardDescription>
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
                <p className="font-semibold">{t('settings:billing.freePlan')}</p>
                <p className="text-sm text-muted-foreground">{t('settings:billing.freePlanDetails')}</p>
              </div>
              <p className="text-2xl font-bold">
                0 ₽
                <span className="text-sm font-normal text-muted-foreground">{t('settings:billing.perMonth')}</span>
              </p>
            </div>
            <Separator className="bg-border/50" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>{t('settings:billing.usersLimit')}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span>{t('settings:billing.rbacBasic')}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="gradient-primary border-0 text-white flex-1"
                onClick={() => navigate('/billing')}
              >
                {t('settings:billing.openBilling')}
              </Button>
              <Badge variant="secondary" className="text-xs">
                {t('settings:billing.teamSoon')}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">{t('settings:dangerZone.title')}</CardTitle>
          <CardDescription>{t('settings:dangerZone.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 p-4">
            <div>
              <p className="text-sm font-medium">{t('settings:dangerZone.deleteOrgTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('settings:dangerZone.deleteOrgDescription')}</p>
            </div>
            {isOrgOwner ? (
              <Button variant="destructive" size="sm" onClick={deleteOrg} disabled={deleteLoading}>
                {deleteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('settings:dangerZone.delete')}
              </Button>
            ) : (
              <Badge variant="secondary" className="text-xs">{t('settings:dangerZone.ownerOnly')}</Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
