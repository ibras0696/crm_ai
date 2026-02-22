import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { AuthError } from '@/contexts/AuthContext'
import { Loader2, ArrowRight, Building2 } from 'lucide-react'

const AUTH_ERRORS_RU: Record<string, string> = {
  CONFLICT: 'Аккаунт с таким email уже существует',
  VALIDATION_ERROR: 'Ошибка валидации данных',
}

type FormFields = { email: string; password: string; first_name: string; last_name: string; org_name: string }
type FieldErrors = Partial<Record<keyof FormFields, string>>

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register, isAuthenticated } = useAuth()
  const [form, setForm] = useState<FormFields>({ email: '', password: '', first_name: '', last_name: '', org_name: '' })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const update = (field: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const validate = (): boolean => {
    const errs: FieldErrors = {}
    if (!form.first_name.trim()) errs.first_name = 'Введите имя'
    if (!form.last_name.trim()) errs.last_name = 'Введите фамилию'
    if (!form.org_name.trim()) errs.org_name = 'Введите название организации'
    if (!form.email.trim()) {
      errs.email = 'Введите email'
    } else if (!form.email.includes('@')) {
      errs.email = 'Введите корректный email'
    }
    if (!form.password) {
      errs.password = 'Введите пароль'
    } else if (form.password.length < 8) {
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
      await register(form)
      navigate('/dashboard')
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        const ruMessage = AUTH_ERRORS_RU[err.code ?? ''] || err.message || 'Ошибка регистрации'
        if (err.field) {
          setFieldErrors((prev) => ({ ...prev, [err.field as keyof FormFields]: ruMessage }))
        } else {
          setError(ruMessage)
        }
      } else {
        setError('Ошибка регистрации. Попробуйте позже.')
      }
    } finally {
      setLoading(false)
    }
  }

  const fieldClass = (field: keyof FormFields) =>
    `h-11 bg-secondary/50${fieldErrors[field] ? ' border-red-500 focus-visible:ring-red-500' : ''}`

  return (
    <div className="flex min-h-screen">
      {/* Left Panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 gradient-primary opacity-10" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <span className="text-xl font-bold">CRM Platform</span>
          </div>
        </div>

        <div className="relative space-y-6">
          <h1 className="text-4xl font-bold leading-tight">
            Создайте<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
              своё рабочее пространство
            </span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md">
            Создайте организацию и пригласите команду. Старт за секунды.
          </p>
          <div className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 p-4 max-w-sm">
            <Building2 className="h-8 w-8 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium">Мультитенантная архитектура</p>
              <p className="text-xs text-muted-foreground">Каждая организация — изолированные данные, роли и биллинг</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-muted-foreground">&copy; 2026 CRM Платформа</p>
      </div>

      {/* Right Panel */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary">
              <span className="text-lg font-bold text-white">C</span>
            </div>
            <span className="text-xl font-bold">CRM Platform</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold">Создайте аккаунт</h2>
            <p className="text-muted-foreground mt-1">Настройте организацию за секунды</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-red-400">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="first_name">Имя</Label>
                <Input id="first_name" value={form.first_name} onChange={update('first_name')} className={fieldClass('first_name')} />
                {fieldErrors.first_name && <p className="text-xs text-red-400">{fieldErrors.first_name}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="last_name">Фамилия</Label>
                <Input id="last_name" value={form.last_name} onChange={update('last_name')} className={fieldClass('last_name')} />
                {fieldErrors.last_name && <p className="text-xs text-red-400">{fieldErrors.last_name}</p>}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="org_name">Организация</Label>
              <Input id="org_name" placeholder="Моя компания" value={form.org_name} onChange={update('org_name')} className={fieldClass('org_name')} />
              {fieldErrors.org_name && <p className="text-xs text-red-400">{fieldErrors.org_name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Эл. почта</Label>
              <Input id="email" type="text" placeholder="you@company.com" value={form.email} onChange={update('email')} className={fieldClass('email')} />
              {fieldErrors.email && <p className="text-xs text-red-400">{fieldErrors.email}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" type="password" placeholder="Минимум 8 символов" value={form.password} onChange={update('password')} className={fieldClass('password')} />
              {fieldErrors.password && <p className="text-xs text-red-400">{fieldErrors.password}</p>}
            </div>
            <Button type="submit" className="w-full h-11 gradient-primary border-0 text-white font-semibold" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
              {loading ? 'Создание...' : 'Создать аккаунт'}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-primary hover:underline font-medium">Войти</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
