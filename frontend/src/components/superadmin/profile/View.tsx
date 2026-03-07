import { useEffect, useState } from 'react'
import { KeyRound, LogOut, Mail, Moon, RefreshCw, Save, ShieldCheck, Sun } from 'lucide-react'

import { SaProfileIcon } from '@/components/icons/modules/SuperadminModuleIcons'
import { useTheme } from '@/contexts/ThemeContext'
import { superadminApi, type SuperadminProfile } from '@/lib/api'

type Props = {
  onRefresh: () => void
  onLogout: () => void
}

const EMPTY_PROFILE: SuperadminProfile = {
  email: '',
  password_configured: false,
  runtime_email_overridden: false,
  runtime_password_overridden: false,
  audit: [],
}

function formatChangedFields(fields: string[]): string {
  if (fields.includes('email') && fields.includes('password')) return 'Почта и пароль'
  if (fields.includes('email')) return 'Почта'
  if (fields.includes('password')) return 'Пароль'
  return fields.join(', ') || 'Профиль'
}

export function SuperadminProfileView({ onRefresh, onLogout }: Props) {
  const { theme, setTheme } = useTheme()
  const [profile, setProfile] = useState<SuperadminProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', repeatPassword: '' })

  const loadProfile = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await superadminApi.profile()
      if (!response.data.ok || !response.data.data) {
        setError(response.data.error?.message || 'Не удалось загрузить профиль супер-админа')
        return
      }
      setProfile(response.data.data)
      setEmailForm((prev) => ({ ...prev, email: response.data.data?.email || '' }))
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить профиль супер-админа')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfile()
  }, [])

  const saveEmail = async () => {
    const nextEmail = emailForm.email.trim().toLowerCase()
    if (!nextEmail) {
      setError('Введите email супер-админа')
      return
    }
    if (!emailForm.currentPassword) {
      setError('Введите текущий пароль для подтверждения смены почты')
      return
    }
    setSavingEmail(true)
    setError('')
    setSuccess('')
    try {
      const response = await superadminApi.updateProfile({
        email: nextEmail,
        current_password: emailForm.currentPassword,
      })
      if (!response.data.ok || !response.data.data) {
        setError(response.data.error?.message || 'Не удалось обновить почту супер-админа')
        return
      }
      setProfile(response.data.data)
      setEmailForm({ email: response.data.data.email, currentPassword: '' })
      setSuccess('Почта супер-админа обновлена')
      onRefresh()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось обновить почту супер-админа')
    } finally {
      setSavingEmail(false)
    }
  }

  const savePassword = async () => {
    if (!passwordForm.currentPassword) {
      setError('Введите текущий пароль')
      return
    }
    if (passwordForm.newPassword.length < 8) {
      setError('Новый пароль должен быть не короче 8 символов')
      return
    }
    if (passwordForm.newPassword !== passwordForm.repeatPassword) {
      setError('Новый пароль и подтверждение не совпадают')
      return
    }
    setSavingPassword(true)
    setError('')
    setSuccess('')
    try {
      const response = await superadminApi.updateProfile({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
      })
      if (!response.data.ok || !response.data.data) {
        setError(response.data.error?.message || 'Не удалось обновить пароль супер-админа')
        return
      }
      setProfile(response.data.data)
      setPasswordForm({ currentPassword: '', newPassword: '', repeatPassword: '' })
      setSuccess('Пароль супер-админа обновлён')
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось обновить пароль супер-админа')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-6 lg:p-7 space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-sm">
          <SaProfileIcon className="h-5 w-5 text-white" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold leading-none">Профиль супер-админа</h2>
          <p className="text-sm text-muted-foreground">Почта для входа, пароль, тема интерфейса и управление сессией.</p>
        </div>
      </div>

      {(error || success) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          }`}
        >
          {error || success}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Почта для входа</h3>
            <p className="text-xs text-muted-foreground mt-1">Этот адрес используется при входе в супер-админку.</p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              value={emailForm.email}
              onChange={(event) => setEmailForm((prev) => ({ ...prev, email: event.target.value }))}
              className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="admin@example.com"
              disabled={loading || savingEmail}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Текущий пароль</label>
            <input
              type="password"
              value={emailForm.currentPassword}
              onChange={(event) => setEmailForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Подтвердите текущим паролем"
              disabled={loading || savingEmail}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Mail className="h-3.5 w-3.5" />
              Текущая почта: <span className="font-medium text-foreground break-all">{profile.email || 'Не задана'}</span>
            </span>
            {profile.runtime_email_overridden && <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">runtime</span>}
          </div>
          <button
            onClick={saveEmail}
            disabled={loading || savingEmail || !emailForm.email.trim() || !emailForm.currentPassword}
            className="h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2 px-4 text-sm font-medium"
          >
            {savingEmail ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить почту
          </button>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Смена пароля</h3>
            <p className="text-xs text-muted-foreground mt-1">Новый пароль начнёт действовать сразу после сохранения.</p>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Текущий пароль"
              disabled={loading || savingPassword}
            />
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Новый пароль"
              disabled={loading || savingPassword}
            />
            <input
              type="password"
              value={passwordForm.repeatPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, repeatPassword: event.target.value }))}
              className="w-full h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Повторите новый пароль"
              disabled={loading || savingPassword}
            />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" />
              Пароль настроен: <span className="font-medium text-foreground">{profile.password_configured ? 'Да' : 'Нет'}</span>
            </span>
            {profile.runtime_password_overridden && <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">runtime</span>}
          </div>
          <button
            onClick={savePassword}
            disabled={
              loading ||
              savingPassword ||
              !passwordForm.currentPassword ||
              !passwordForm.newPassword ||
              !passwordForm.repeatPassword
            }
            className="h-11 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center justify-center gap-2 px-4 text-sm font-medium"
          >
            {savingPassword ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Обновить пароль
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Тема интерфейса</h3>
            <p className="text-xs text-muted-foreground mt-1">Выберите удобный режим отображения.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTheme('dark')}
              className={`h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-sm ${
                theme === 'dark' ? 'border-primary bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent'
              }`}
            >
              <Moon className="h-4 w-4" /> Темная
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-sm ${
                theme === 'light' ? 'border-primary bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent'
              }`}
            >
              <Sun className="h-4 w-4" /> Светлая
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Сессия</h3>
            <p className="text-xs text-muted-foreground mt-1">Обновление данных и завершение текущего сеанса.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-2">
            <button
              onClick={() => {
                void loadProfile()
                onRefresh()
              }}
              className="h-11 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-sm"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить данные
            </button>
            <button
              onClick={onLogout}
              className="h-11 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-sm"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Последние изменения</h3>
          <p className="text-xs text-muted-foreground mt-1">История смены почты и пароля в профиле супер-админа.</p>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка...</div>
        ) : profile.audit.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">
            Изменений профиля пока не было.
          </div>
        ) : (
          <div className="space-y-2">
            {profile.audit.slice(0, 8).map((item) => (
              <div key={item.id} className="flex flex-col gap-1 rounded-xl border border-border/70 bg-background/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{formatChangedFields(item.changed_fields)}</div>
                  <div className="text-xs text-muted-foreground break-all">
                    {item.actor}
                    {item.ip_address ? ` · ${item.ip_address}` : ''}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{item.created_at ? new Date(item.created_at).toLocaleString() : '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
