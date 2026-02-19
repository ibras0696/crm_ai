import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { authApi, orgApi, type UserInfo, type OrgInfo, type MemberInfo } from '@/lib/api'
import { getAccessToken, saveTokens, clearTokens } from '@/lib/auth'

interface AuthState {
  user: UserInfo | null
  org: OrgInfo | null
  members: MemberInfo[]
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; first_name: string; last_name: string; org_name: string }) => Promise<void>
  logout: () => void
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
      clearTokens()
      setUser(null)
      setOrg(null)
      setMembers([])
    }
  }, [])

  useEffect(() => {
    if (getAccessToken()) {
      loadProfile().finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [loadProfile])

  const login = async (email: string, password: string) => {
    const resp = await authApi.login({ email, password })
    if (resp.data.ok && resp.data.data) {
      saveTokens(resp.data.data.access_token, resp.data.data.refresh_token)
      await loadProfile()
    } else {
      throw new Error(resp.data.error?.message || 'Login failed')
    }
  }

  const register = async (data: { email: string; password: string; first_name: string; last_name: string; org_name: string }) => {
    const resp = await authApi.register(data)
    if (resp.data.ok && resp.data.data) {
      saveTokens(resp.data.data.access_token, resp.data.data.refresh_token)
      await loadProfile()
    } else {
      throw new Error(resp.data.error?.message || 'Registration failed')
    }
  }

  const logout = () => {
    clearTokens()
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
