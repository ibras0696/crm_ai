import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import PasswordInput from '@/components/auth/PasswordInput'
import AuthLanguageSwitcher from '@/components/auth/AuthLanguageSwitcher'
import { useAuth } from '@/contexts/AuthContext'
import { AuthError } from '@/contexts/AuthContext'
import { Loader2, ArrowRight, Zap, Shield, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const AUTH_ERROR_KEYS: Record<string, string> = {
  UNAUTHORIZED: 'errors.unauthorized',
  NOT_FOUND: 'errors.notFound',
  FORBIDDEN: 'errors.forbidden',
  RATE_LIMITED: 'errors.rateLimited',
  VALIDATION_ERROR: 'errors.validation',
  NETWORK_ERROR: 'errors.network',
  SERVER_ERROR: 'errors.server',
}

type FieldErrors = { email?: string; password?: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, isAuthenticated } = useAuth()
  const { t } = useTranslation(['auth', 'common'])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const validate = (): boolean => {
    const errs: FieldErrors = {}
    if (!email.trim()) {
      errs.email = t('auth:validation.emailRequired')
    } else if (!email.includes('@')) {
      errs.email = t('auth:validation.emailInvalid')
    }
    if (!password) {
      errs.password = t('auth:validation.passwordRequired')
    } else if (password.length < 8) {
      errs.password = t('auth:validation.passwordMin')
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!validate()) return
    setLoading(true)
    try {
      await login(email, password, rememberMe)
      navigate('/dashboard')
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        const key = AUTH_ERROR_KEYS[err.code ?? '']
        setError(key ? t(`auth:${key}`) : t('auth:errors.loginFailed'))
      } else {
        setError(t('auth:errors.loginFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  const clearFieldError = (field: keyof FieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const loginFeatures = [
    { icon: Zap, text: t('auth:hero.loginFeature1') },
    { icon: Shield, text: t('auth:hero.loginFeature2') },
    { icon: Users, text: t('auth:hero.loginFeature3') },
  ]

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 gradient-primary opacity-10" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <span className="text-xl font-bold">{t('common:appName')}</span>
          </div>
          <AuthLanguageSwitcher />
        </div>

        <div className="relative space-y-8">
          <h1 className="text-4xl font-bold leading-tight">
            {t('auth:hero.loginTitleTop')}
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
              {t('auth:hero.loginTitleAccent')}
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            {t('auth:hero.loginDescription')}
          </p>

          <div className="space-y-4">
            {loginFeatures.map((feature) => (
              <div key={feature.text} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 border border-white/10">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-muted-foreground">&copy; 2026 {t('common:appName')}</p>
      </div>

      <div className="flex w-full lg:w-1/2 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
                <span className="text-lg font-bold text-white">C</span>
              </div>
              <span className="text-xl font-bold">{t('common:appName')}</span>
            </div>
            <AuthLanguageSwitcher />
          </div>

          <div>
            <h2 className="text-2xl font-bold">{t('auth:login.title')}</h2>
            <p className="text-muted-foreground mt-1">{t('auth:login.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="email">{t('auth:fields.email')}</Label>
              <Input
                id="email"
                type="text"
                placeholder={t('auth:placeholders.email')}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearFieldError('email')
                }}
                className={`h-11 bg-secondary/50 ${fieldErrors.email ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
              />
              {fieldErrors.email && <p className="text-xs text-red-400">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t('auth:fields.password')}</Label>
              <PasswordInput
                id="password"
                placeholder={t('auth:placeholders.password')}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  clearFieldError('password')
                }}
                className={`h-11 bg-secondary/50 ${fieldErrors.password ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
              />
              {fieldErrors.password && <p className="text-xs text-red-400">{fieldErrors.password}</p>}
            </div>
            <div className="flex justify-end">
              <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-input bg-secondary/50 accent-primary"
                />
                <span>Запомнить меня</span>
              </label>
              <Link to="/auth/forgot-password" className="text-sm text-primary hover:underline font-medium">
                {t('auth:links.forgotPassword')}
              </Link>
            </div>
            <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              {loading ? t('auth:login.submitting') : t('auth:login.submit')}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            {t('auth:links.noAccount')}{' '}
            <Link to="/register" className="text-primary hover:underline font-medium">
              {t('auth:links.createAccount')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
