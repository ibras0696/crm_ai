import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/AuthContext'
import { Loader2, ArrowRight, Zap, Shield, Users } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, isAuthenticated } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
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
            <div className="space-y-2">
              <Label htmlFor="email">Эл. почта</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 bg-secondary/50"
              />
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
