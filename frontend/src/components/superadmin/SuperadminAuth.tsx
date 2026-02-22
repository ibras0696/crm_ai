import { useState } from 'react'
import { Shield } from 'lucide-react'

import { superadminApi } from '@/lib/api'
import { SA_TOKEN_KEY } from './constants'

type Props = {
  onLoggedIn: (token: string) => void
}

export function SuperadminAuth({ onLoggedIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const login = async () => {
    if (!email.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.login(email.trim(), password)
      if (r.data.ok && r.data.data?.access_token) {
        localStorage.setItem(SA_TOKEN_KEY, r.data.data.access_token)
        onLoggedIn(r.data.data.access_token)
      } else {
        setError(r.data.error?.message || 'Ошибка входа')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Суперадмин</h1>
          <p className="text-sm text-muted-foreground mt-1">Панель управления платформой</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Email</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="admin"
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && login()}
              placeholder="••••••••"
              className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            onClick={login}
            disabled={loading || !email.trim() || !password}
            className="w-full h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </div>
      </div>
    </div>
  )
}

