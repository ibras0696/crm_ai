import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import PasswordInput from '@/components/auth/PasswordInput'
import AuthLanguageSwitcher from '@/components/auth/AuthLanguageSwitcher'
import { authApi } from '@/lib/api/auth/auth'
import { Loader2, ArrowRight } from 'lucide-react'
import { isAxiosError } from 'axios'
import { useTranslation } from 'react-i18next'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const { t } = useTranslation('auth')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token) {
      setError(t('reset.invalidLink'))
      return
    }

    if (!password || password.length < 8) {
      setError(t('validation.passwordMin'))
      return
    }

    setLoading(true)
    try {
      await authApi.resetPassword({ token, new_password: password })
      setSuccess(true)
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        const code = err.response?.data?.error?.code as string | undefined
        if (code === 'VALIDATION_ERROR') {
          setError(t('validation.passwordMin'))
        } else {
          setError(t('errors.resetFailed'))
        }
      } else {
        setError(t('errors.resetFailed'))
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
          <p className="text-red-400">{t('reset.missingToken')}</p>
          <Link to="/auth/forgot-password" className="text-primary hover:underline font-medium">
            {t('links.requestNewLink')}
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
          <h2 className="text-2xl font-bold">{t('reset.title')}</h2>
          <p className="text-muted-foreground mt-1">
            {t('reset.subtitle')}
          </p>
        </div>

        {success ? (
          <div className="space-y-5 text-center">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-emerald-500">
              {t('reset.success')}
            </div>
            <Link to="/login" className="block text-primary font-medium hover:underline">
              {t('reset.nextLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="password">{t('fields.newPassword')}</Label>
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
              {loading ? t('reset.submitting') : t('reset.submit')}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
