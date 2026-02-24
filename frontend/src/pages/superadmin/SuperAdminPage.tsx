import { useCallback, useEffect, useMemo, useState } from 'react'

import { superadminApi, type SuperadminDashboard, type SuperadminOrgOption } from '@/lib/api'
import { SuperadminAuth } from '@/components/superadmin/SuperadminAuth'
import { SuperadminHeader } from '@/components/superadmin/SuperadminHeader'
import { SuperadminDashboardView } from '@/components/superadmin/SuperadminDashboardView'
import { OrgListView } from '@/components/superadmin/OrgListView'
import { OrgDetailView } from '@/components/superadmin/OrgDetailView'
import { UsersListView } from '@/components/superadmin/UsersListView'
import { SuperadminAuditView } from '@/components/superadmin/SuperadminAuditView'
import { SuperadminAIView } from '@/components/superadmin/SuperadminAIView'
import { SuperadminTablesView } from '@/components/superadmin/SuperadminTablesView'
import { SA_SELECTED_ORG_KEY } from '@/components/superadmin/constants'

type TabKey = 'dashboard' | 'orgs' | 'tables' | 'users' | 'audit' | 'ai'

const EMPTY_DASHBOARD: SuperadminDashboard = {
  totals: { orgs: 0, users: 0, tables: 0, records: 0, files: 0, storage_bytes: 0, ai_requests: 0, ai_tokens: 0 },
  registrations_timeline: [],
  orgs_by_plan: [],
}

export default function SuperAdminPage() {
  const [isAuthed, setIsAuthed] = useState(true)
  const [tab, setTab] = useState<TabKey>('dashboard')
  const [selectedOrgId, setSelectedOrgId] = useState(() => localStorage.getItem(SA_SELECTED_ORG_KEY) || '')

  const [dashboard, setDashboard] = useState<SuperadminDashboard>(EMPTY_DASHBOARD)
  const [orgOptions, setOrgOptions] = useState<SuperadminOrgOption[]>([])
  const [loadError, setLoadError] = useState('')

  const loadOverview = useCallback(async () => {
    setLoadError('')
    try {
      const r = await superadminApi.overview(200)
      if (r.data.ok && r.data.data) {
        setDashboard(r.data.data.dashboard || EMPTY_DASHBOARD)
        setOrgOptions(r.data.data.orgs || [])
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
    setOrgOptions([])
    setLoadError('')
  }

  const refresh = () => {
    void loadOverview()
  }

  const effectiveSelectedOrgId = useMemo(() => selectedOrgId || '', [selectedOrgId])

  if (!isAuthed) return <SuperadminAuth onLoggedIn={onLoggedIn} />

  return (
    <div className="min-h-screen bg-background">
      <SuperadminHeader
        tab={tab}
        onTab={setTab}
        orgs={orgOptions}
        selectedOrgId={selectedOrgId}
        onSelectOrgId={setSelectedOrgId}
        onRefresh={refresh}
        onLogout={logout}
      />

      <div className="p-6 space-y-6">
        {loadError && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {tab === 'dashboard' && <SuperadminDashboardView dashboard={dashboard} />}

        {tab === 'orgs' && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <div className="xl:col-span-2 space-y-4">
              <OrgListView selectedOrgId={selectedOrgId} onSelectOrg={setSelectedOrgId} />
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
      </div>
    </div>
  )
}
