import { useCallback, useEffect, useMemo, useState } from 'react'
import { Menu, Moon, Sun } from 'lucide-react'
import { SaShieldIcon } from '@/components/icons/modules/SuperadminModuleIcons'
import { useTheme } from '@/contexts/ThemeContext'

import { superadminApi, type SuperadminDashboard } from '@/lib/api'
import {
  OrgDetailView,
  OrgListView,
  SA_SELECTED_ORG_KEY,
  SA_SIDEBAR_COLLAPSED_KEY,
  SuperadminAIView,
  SuperadminAuditView,
  SuperadminAuth,
  SuperadminDashboardView,
  SuperadminProfileView,
  SuperadminRightSidebar,
  SuperadminTablesView,
  UsersListView,
} from '@/components/superadmin'

type TabKey = 'dashboard' | 'orgs' | 'tables' | 'users' | 'audit' | 'ai' | 'profile'

const EMPTY_DASHBOARD: SuperadminDashboard = {
  totals: { orgs: 0, users: 0, tables: 0, records: 0, files: 0, storage_bytes: 0, ai_requests: 0, ai_tokens: 0 },
  registrations_timeline: [],
  orgs_by_plan: [],
}

export default function SuperAdminPage() {
  const { theme, toggleTheme } = useTheme()
  const [isAuthed, setIsAuthed] = useState(true)
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [selectedOrgId, setSelectedOrgId] = useState(() => localStorage.getItem(SA_SELECTED_ORG_KEY) || '')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SA_SIDEBAR_COLLAPSED_KEY) === '1')

  const [dashboard, setDashboard] = useState<SuperadminDashboard>(EMPTY_DASHBOARD)
  const [loadError, setLoadError] = useState('')

  const loadOverview = useCallback(async () => {
    setLoadError('')
    try {
      const r = await superadminApi.overview(200)
      if (r.data.ok && r.data.data) {
        setDashboard(r.data.data.dashboard || EMPTY_DASHBOARD)
      } else {
        setLoadError(r.data.error?.message || 'Не удалось загрузить данные')
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message || e?.message || 'Не удалось загрузить данные'
      setLoadError(msg)
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        setIsAuthed(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!isAuthed) return
    void loadOverview()
  }, [isAuthed, loadOverview])

  const onLoggedIn = () => {
    setIsAuthed(true)
    void loadOverview()
  }

  const logout = async () => {
    try {
      await superadminApi.logout()
    } catch {}
    setIsAuthed(false)
    setDashboard(EMPTY_DASHBOARD)
    setLoadError('')
  }

  const refresh = () => {
    void loadOverview()
  }

  const setSelectedOrg = (id: string) => {
    setSelectedOrgId(id)
    localStorage.setItem(SA_SELECTED_ORG_KEY, id)
  }

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SA_SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  const effectiveSelectedOrgId = useMemo(() => selectedOrgId || '', [selectedOrgId])

  if (!isAuthed) return <SuperadminAuth onLoggedIn={onLoggedIn} />

  return (
    <div className="min-h-screen bg-background">
      <SuperadminRightSidebar
        tab={tab}
        onTab={setTab}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
      />

      <header className="lg:hidden sticky top-0 z-20 border-b border-sidebar-border bg-sidebar-background/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <SaShieldIcon className="h-4 w-4 text-white" />
            </div>
            <div className="truncate text-sm font-semibold">Суперадминка</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="h-9 w-9 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center"
              title={theme === 'dark' ? 'Светлая тема' : 'Темная тема'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setMobileNavOpen(true)}
              className="h-9 w-9 rounded-lg border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className={sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'}>
        <div className="p-4 lg:p-6 space-y-6">
        {loadError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {tab === 'dashboard' && <SuperadminDashboardView dashboard={dashboard} />}

        {tab === 'orgs' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <div className="xl:col-span-2 space-y-4">
              <OrgListView selectedOrgId={selectedOrgId} onSelectOrg={setSelectedOrg} />
            </div>
            <div className="xl:col-span-1">
              <OrgDetailView orgId={effectiveSelectedOrgId} />
            </div>
          </div>
        )}

        {tab === 'tables' && <SuperadminTablesView selectedOrgId={effectiveSelectedOrgId} />}

        {tab === 'users' && <UsersListView />}

        {tab === 'audit' && <SuperadminAuditView selectedOrgId={effectiveSelectedOrgId} />}

        {tab === 'ai' && <SuperadminAIView />}

        {tab === 'profile' && (
          <SuperadminProfileView
            onRefresh={refresh}
            onLogout={logout}
          />
        )}
        </div>
      </main>
    </div>
  )
}
