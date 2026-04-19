import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import PasswordInput from '@/components/auth/PasswordInput'
import AuthLanguageSwitcher from '@/components/auth/AuthLanguageSwitcher'
import { orgApi } from '@/lib/api/org/org'
import { useAuth } from '@/contexts/AuthContext'
import { isAxiosError } from 'axios'
import { Loader2, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const { t } = useTranslation('auth')

  const token = searchParams.get('token')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token) {
      setError(t('reset.invalidLink'))
      return
    }

    if (!firstName.trim()) {
      setError(t('validation.firstNameRequired'))
      return
    }

    if (!password || password.length < 8) {
      setError(t('validation.passwordMin'))
      return
    }

    setLoading(true)
    try {
      const resp = await orgApi.acceptInvite({
        token,
        password,
        first_name: firstName,
        last_name: lastName,
      })

      if (resp.data.ok && resp.data.data?.access_token) {
        await refresh()
        navigate('/dashboard')
      } else {
        setError(t('invite.authTokenMissing'))
      }
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        const message = err.response?.data?.error?.message
        setError(typeof message === 'string' && message.trim() ? message : t('invite.acceptFailed'))
      } else {
        setError(t('invite.acceptFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="flex justify-end">
            <AuthLanguageSwitcher />
          </div>
          <p className="text-red-400">{t('invite.missingToken')}</p>
          <Link to="/login" className="text-primary hover:underline font-medium">
            {t('links.backToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-end">
          <AuthLanguageSwitcher />
        </div>
        <div>
          <h2 className="text-2xl font-bold">{t('invite.title')}</h2>
          <p className="text-muted-foreground mt-1">
            {t('invite.subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="firstName">{t('fields.firstName')}</Label>
              <Input
                id="firstName"
                placeholder={t('placeholders.firstName')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="h-11 bg-secondary/50"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">{t('fields.lastNameOptional')}</Label>
              <Input
                id="lastName"
                placeholder={t('placeholders.lastName')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="h-11 bg-secondary/50"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">{t('fields.createPassword')}</Label>
            <PasswordInput
              id="password"
              placeholder={t('placeholders.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 bg-secondary/50"
            />
          </div>

          <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ArrowRight className="h-4 w-4 mr-2" />
            )}
            {loading ? t('invite.submitting') : t('invite.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
