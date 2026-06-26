import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
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

  // Shared field-row styles
  const fieldRow = 'flex flex-col gap-1.5 px-4 py-3.5 bg-card border-b border-border/60 last:border-0 min-h-[64px]'
  const selectCls =
    'flex h-10 w-full rounded-md border border-input bg-secondary/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  const avatarInitials =
    `${profileForm.first_name || ''} ${profileForm.last_name || ''}`.trim().slice(0, 2).toUpperCase() || 'U'

  return (
    <div className="pb-24 md:pb-6 touch-pan-y max-w-2xl md:mx-0">
      {/* Page header */}
      <div className="px-4 pt-2 pb-4 md:px-0 md:pt-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{t('settings:title')}</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">{t('settings:subtitle')}</p>
      </div>

      {/* ── PROFILE section ──────────────────────────────── */}
      <section className="mb-6">
        {/* Avatar hero — centered, iOS-style profile top */}
        <div className="flex flex-col items-center gap-2 py-6 px-4 bg-card border border-border rounded-2xl mx-4 md:mx-0 mb-4">
          <div className="relative">
            <Avatar className="h-20 w-20 border-2 border-border/60">
              <AvatarImage src={profileForm.avatar_url || undefined} alt="avatar" />
              <AvatarFallback className="text-lg font-semibold">{avatarInitials}</AvatarFallback>
            </Avatar>
            {avatarUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
          </div>
          <div className="text-center">
            <p className="font-semibold text-base">
              {profileForm.first_name} {profileForm.last_name}
            </p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <div className="w-full max-w-[240px]">
            <Label htmlFor="profile-avatar-upload" className="sr-only">Аватар</Label>
            <Input
              id="profile-avatar-upload"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => void handleAvatarUpload(e)}
              disabled={avatarUploading}
              className="bg-secondary/50 text-xs cursor-pointer"
            />
            <p className="text-[11px] text-muted-foreground mt-1 text-center">
              {avatarUploading ? 'Загрузка...' : 'PNG / JPG / GIF / WEBP'}
            </p>
          </div>
        </div>

        {/* Section label */}
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 mb-2">
          <User className="inline h-3 w-3 mr-1.5 -mt-px" />
          {t('settings:profile.title')}
        </p>

        {/* Settings rows grouped in a card */}
        <div className="rounded-2xl overflow-hidden border border-border mx-4 md:mx-0">
          {/* First name */}
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:fields.firstName')}
            </Label>
            <Input
              value={profileForm.first_name}
              onChange={(e) => setProfileForm((p) => ({ ...p, first_name: e.target.value }))}
              className="bg-secondary/50 w-full"
            />
          </div>
          {/* Last name */}
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:fields.lastName')}
            </Label>
            <Input
              value={profileForm.last_name}
              onChange={(e) => setProfileForm((p) => ({ ...p, last_name: e.target.value }))}
              className="bg-secondary/50 w-full"
            />
          </div>
          {/* Email (readonly) */}
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:fields.email')}
            </Label>
            <Input
              defaultValue={user?.email}
              disabled
              className="bg-secondary/30 opacity-60 w-full"
            />
            <p className="text-[11px] text-muted-foreground">{t('settings:hints.emailReadonly')}</p>
          </div>
          {/* Timezone */}
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:fields.timezone')}
            </Label>
            <select
              value={profileForm.timezone}
              onChange={(e) => setProfileForm((p) => ({ ...p, timezone: e.target.value }))}
              className={selectCls}
            >
              {timezoneOptions.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">{t('settings:hints.timezone')}</p>
          </div>
          {/* Locale (conditional) */}
          {localeEnabled && (
            <div className={fieldRow}>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('settings:fields.locale')}
              </Label>
              <select
                value={profileForm.locale}
                onChange={(e) => setProfileForm((p) => ({ ...p, locale: e.target.value as 'ru' | 'en' }))}
                className={selectCls}
              >
                <option value="ru">{t('common:language.russian')}</option>
                <option value="en">{t('common:language.english')}</option>
              </select>
            </div>
          )}
        </div>

        {/* Save profile button */}
        <div className="px-4 md:px-0 mt-3">
          <Button
            className="gradient-primary border-0 text-white w-full md:w-auto"
            onClick={saveProfile}
            disabled={profileLoading}
          >
            {profileLoading
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : profileSaved
              ? <Check className="h-4 w-4 mr-2" />
              : null}
            {profileSaved ? t('settings:actions.saved') : t('settings:actions.save')}
          </Button>
        </div>
      </section>

      {/* ── ORGANIZATION section ─────────────────────────── */}
      <section className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 mb-2">
          <Building2 className="inline h-3 w-3 mr-1.5 -mt-px" />
          {t('settings:organization.title')}
        </p>
        <div className="rounded-2xl overflow-hidden border border-border mx-4 md:mx-0">
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:organization.name')}
            </Label>
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              className="bg-secondary/50 w-full"
            />
          </div>
          <div className={fieldRow}>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('settings:organization.slug')}
            </Label>
            <Input
              defaultValue={org?.slug}
              disabled
              className="bg-secondary/30 opacity-60 font-mono text-sm w-full"
            />
          </div>
        </div>
        <div className="px-4 md:px-0 mt-3">
          <Button
            className="gradient-primary border-0 text-white w-full md:w-auto"
            onClick={saveOrg}
            disabled={orgLoading}
          >
            {orgLoading
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : orgSaved
              ? <Check className="h-4 w-4 mr-2" />
              : null}
            {orgSaved ? t('settings:actions.saved') : t('settings:organization.update')}
          </Button>
        </div>
      </section>

      {/* ── BILLING section ──────────────────────────────── */}
      <section className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-4 mb-2">
          <CreditCard className="inline h-3 w-3 mr-1.5 -mt-px" />
          {t('settings:billing.title')}
        </p>
        <div className="rounded-2xl overflow-hidden border border-border mx-4 md:mx-0">
          {/* Plan summary row */}
          <div className="flex items-center justify-between px-4 py-3.5 min-h-[56px] border-b border-border/60">
            <div>
              <p className="text-sm font-medium">{t('settings:billing.freePlan')}</p>
              <p className="text-xs text-muted-foreground">{t('settings:billing.freePlanDetails')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={org?.plan === 'free' ? 'secondary' : 'default'} className="uppercase text-xs">
                {org?.plan ?? 'free'}
              </Badge>
              <p className="text-lg font-bold">
                0 <span className="text-xs font-normal text-muted-foreground">₽{t('settings:billing.perMonth')}</span>
              </p>
            </div>
          </div>
          <Separator className="bg-border/50" />
          {/* Feature rows */}
          <div className="flex items-center gap-3 px-4 py-3 min-h-[48px] border-b border-border/40">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">{t('settings:billing.usersLimit')}</span>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 min-h-[48px]">
            <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">{t('settings:billing.rbacBasic')}</span>
          </div>
        </div>
        <div className="px-4 md:px-0 mt-3 flex items-center gap-2">
          <Button
            className="gradient-primary border-0 text-white flex-1 md:flex-none"
            onClick={() => navigate('/billing')}
          >
            {t('settings:billing.openBilling')}
          </Button>
          <Badge variant="secondary" className="text-xs shrink-0">
            {t('settings:billing.teamSoon')}
          </Badge>
        </div>
      </section>

      {/* ── DANGER ZONE section ──────────────────────────── */}
      <section className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-destructive/70 px-4 mb-2">
          {t('settings:dangerZone.title')}
        </p>
        <div className="rounded-2xl overflow-hidden border border-destructive/20 mx-4 md:mx-0">
          <div className="flex items-center justify-between px-4 py-3.5 min-h-[60px]">
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-sm font-medium">{t('settings:dangerZone.deleteOrgTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('settings:dangerZone.deleteOrgDescription')}</p>
            </div>
            {isOrgOwner ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteOrg}
                disabled={deleteLoading}
                className="shrink-0"
              >
                {deleteLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : t('settings:dangerZone.delete')}
              </Button>
            ) : (
              <Badge variant="secondary" className="text-xs shrink-0">
                {t('settings:dangerZone.ownerOnly')}
              </Badge>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
