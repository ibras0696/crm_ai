import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, ArrowRight, Building2 } from 'lucide-react'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register, isAuthenticated } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '', org_name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(form)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err?.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

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
              <div className="space-y-2">
                <Label htmlFor="first_name">Имя</Label>
                <Input id="first_name" value={form.first_name} onChange={update('first_name')} required className="h-11 bg-secondary/50" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Фамилия</Label>
                <Input id="last_name" value={form.last_name} onChange={update('last_name')} required className="h-11 bg-secondary/50" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org_name">Организация</Label>
              <Input id="org_name" placeholder="Моя компания" value={form.org_name} onChange={update('org_name')} required className="h-11 bg-secondary/50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Эл. почта</Label>
              <Input id="email" type="email" placeholder="you@company.com" value={form.email} onChange={update('email')} required className="h-11 bg-secondary/50" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input id="password" type="password" placeholder="Минимум 8 символов" value={form.password} onChange={update('password')} required minLength={8} className="h-11 bg-secondary/50" />
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
