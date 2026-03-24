import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { AuthError } from '@/contexts/AuthContext'
import { Loader2, ArrowRight, Zap, Shield, Users } from 'lucide-react'

const AUTH_ERRORS_RU: Record<string, string> = {
  UNAUTHORIZED: 'Неверный email или пароль',
  NOT_FOUND: 'Аккаунт не найден',
  FORBIDDEN: 'Аккаунт деактивирован',
  RATE_LIMITED: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  VALIDATION_ERROR: 'Проверьте корректность введенных данных.',
  NETWORK_ERROR: 'Нет соединения с сервером. Проверьте сеть.',
  SERVER_ERROR: 'Сервис временно недоступен. Попробуйте позже.',
}

type FieldErrors = { email?: string; password?: string }

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const validate = (): boolean => {
    const errs: FieldErrors = {}
    if (!email.trim()) {
      errs.email = 'Введите email'
    } else if (!email.includes('@')) {
      errs.email = 'Введите корректный email'
    }
    if (!password) {
      errs.password = 'Введите пароль'
    } else if (password.length < 8) {
      errs.password = 'Пароль должен быть не менее 8 символов'
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
      await login(email, password)
      navigate('/dashboard')
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        setError(AUTH_ERRORS_RU[err.code ?? ''] || err.message || 'Ошибка входа')
      } else {
        setError('Ошибка входа. Попробуйте позже.')
      }
    } finally {
      setLoading(false)
    }
  }

  const clearFieldError = (field: keyof FieldErrors) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  return (
    <div className="flex min-h-screen">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 gradient-primary opacity-10" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <span className="text-xl font-bold">CRM Platform</span>
          </div>
        </div>

        <div className="relative space-y-8">
          <h1 className="text-4xl font-bold leading-tight">
            Всё в одном<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
              для вашего бизнеса
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            Таблицы, база знаний, расписание, отчёты и AI — всё, что нужно вашей команде, в одном месте.
          </p>

          <div className="space-y-4">
            {[
              { icon: Zap, text: 'AI-аналитика и автоматизация' },
              { icon: Shield, text: 'Корпоративная безопасность и RBAC' },
              { icon: Users, text: 'Мультитенантная командная работа' },
            ].map((f) => (
              <div key={f.text} className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 border border-white/10">
                  <f.icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm text-muted-foreground">{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-muted-foreground">
          &copy; 2026 CRM Платформа
        </p>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <span className="text-xl font-bold">CRM Platform</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold">С возвращением</h2>
            <p className="text-muted-foreground mt-1">Войдите в свой аккаунт</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="email">Эл. почта</Label>
              <Input
                id="email"
                type="text"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearFieldError('email') }}
                className={`h-11 bg-secondary/50 ${fieldErrors.email ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
              />
              {fieldErrors.email && (
                <p className="text-xs text-red-400">{fieldErrors.email}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Минимум 8 символов"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearFieldError('password') }}
                className={`h-11 bg-secondary/50 ${fieldErrors.password ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
              />
              {fieldErrors.password && (
                <p className="text-xs text-red-400">{fieldErrors.password}</p>
              )}
            </div>
            <div className="flex justify-end">
              <Link to="/auth/forgot-password" className="text-sm text-primary hover:underline font-medium">
                Забыли пароль?
              </Link>
            </div>
            <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              {loading ? 'Вход...' : 'Войти'}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-primary hover:underline font-medium">
              Создать
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
