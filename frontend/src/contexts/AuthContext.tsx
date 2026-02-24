import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { authApi, orgApi, type UserInfo, type OrgInfo, type MemberInfo } from '@/lib/api'
import { isAxiosError } from 'axios'

export class AuthError extends Error {
  code: string | null
  field: string | null
  constructor(message: string, code: string | null, field: string | null) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.field = field
  }
}

function toAuthError(err: unknown, fallbackMessage: string): AuthError {
  if (!isAxiosError(err)) {
    return new AuthError(fallbackMessage, null, null)
  }

  const status = err.response?.status ?? null
  const data = err.response?.data as
    | { error?: { code?: string; message?: string; field?: string } | null; detail?: Array<{ msg?: string; loc?: Array<string | number> }> }
    | undefined

  const apiError = data?.error
  if (apiError?.message) {
    return new AuthError(apiError.message, apiError.code ?? null, apiError.field ?? null)
  }

  if (Array.isArray(data?.detail) && data?.detail.length > 0) {
    const first = data.detail[0]
    const loc = first?.loc ?? []
    const field = loc.length > 1 ? String(loc[loc.length - 1]) : null
    return new AuthError(first?.msg || 'Ошибка валидации данных', 'VALIDATION_ERROR', field)
  }

  if (status === 429) return new AuthError('Слишком много запросов. Попробуйте через минуту.', 'RATE_LIMITED', null)
  if (status === 401) return new AuthError('Неверный email или пароль', 'UNAUTHORIZED', null)
  if (status === 403) return new AuthError('Доступ запрещен', 'FORBIDDEN', null)
  if (status === 404) return new AuthError('Ресурс не найден', 'NOT_FOUND', null)
  if (status === 409) return new AuthError('Конфликт данных', 'CONFLICT', null)
  if (status === 422) return new AuthError('Ошибка валидации данных', 'VALIDATION_ERROR', null)
  if (status && status >= 500) return new AuthError('Ошибка сервера. Попробуйте позже.', 'SERVER_ERROR', null)
  if (!err.response) return new AuthError('Сеть недоступна. Проверьте соединение.', 'NETWORK_ERROR', null)

  return new AuthError(fallbackMessage, null, null)
}

interface AuthState {
  user: UserInfo | null
  org: OrgInfo | null
  members: MemberInfo[]
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; first_name: string; last_name: string; org_name: string; accepted_privacy_policy: true }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [org, setOrg] = useState<OrgInfo | null>(null)
  const [members, setMembers] = useState<MemberInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    try {
      const [u, o, m] = await Promise.all([
        authApi.me(),
        orgApi.getCurrent(),
        orgApi.getMembers(),
      ])
      if (u.data.ok) setUser(u.data.data)
      if (o.data.ok) setOrg(o.data.data)
      if (m.data.ok) setMembers(m.data.data ?? [])
    } catch {
      setUser(null)
      setOrg(null)
      setMembers([])
    }
  }, [])

  useEffect(() => {
    loadProfile().finally(() => setIsLoading(false))
  }, [loadProfile])

  const login = async (email: string, password: string) => {
    try {
      const resp = await authApi.login({ email, password })
      if (resp.data.ok) {
        await loadProfile()
        return
      }
      throw new AuthError(
        resp.data.error?.message || 'Login failed',
        resp.data.error?.code ?? null,
        resp.data.error?.field ?? null,
      )
    } catch (err: unknown) {
      throw toAuthError(err, 'Ошибка входа')
    }
  }

  const register = async (data: { email: string; password: string; first_name: string; last_name: string; org_name: string; accepted_privacy_policy: true }) => {
    try {
      const resp = await authApi.register(data)
      if (resp.data.ok) {
        await loadProfile()
        return
      }
      throw new AuthError(
        resp.data.error?.message || 'Registration failed',
        resp.data.error?.code ?? null,
        resp.data.error?.field ?? null,
      )
    } catch (err: unknown) {
      throw toAuthError(err, 'Ошибка регистрации')
    }
  }

  const logout = async () => {
    try {
      await authApi.logout()
    } catch {}
    setUser(null)
    setOrg(null)
    setMembers([])
  }

  const refresh = async () => {
    await loadProfile()
  }

  return (
    <AuthContext.Provider value={{ user, org, members, isLoading, isAuthenticated: !!user, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
