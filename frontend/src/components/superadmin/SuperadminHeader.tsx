import { Shield, LogOut, RefreshCw } from 'lucide-react'

import type { SuperadminOrgOption } from '@/lib/api'
import { SA_SELECTED_ORG_KEY } from './constants'

type TabKey = 'dashboard' | 'orgs' | 'tables' | 'users' | 'audit' | 'ai'

type Props = {
  tab: TabKey
  onTab: (t: TabKey) => void
  orgs: SuperadminOrgOption[]
  selectedOrgId: string
  onSelectOrgId: (id: string) => void
  onRefresh: () => void
  onLogout: () => void
}

export function SuperadminHeader({
  tab,
  onTab,
  orgs,
  selectedOrgId,
  onSelectOrgId,
  onRefresh,
  onLogout,
}: Props) {
  const setOrg = (id: string) => {
    onSelectOrgId(id)
    localStorage.setItem(SA_SELECTED_ORG_KEY, id)
  }

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'dashboard', label: 'Дашборд' },
    { key: 'orgs', label: 'Организации' },
    { key: 'tables', label: 'Таблицы' },
    { key: 'users', label: 'Пользователи' },
    { key: 'audit', label: 'Аудит' },
    { key: 'ai', label: 'AI' },
  ]

  return (
    <div className="border-b border-border bg-card px-6 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-bold text-sm">Суперадмин панель</span>
      </div>

      <div className="flex-1 flex items-center gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            className={`h-8 px-3 rounded-lg text-sm whitespace-nowrap border transition-colors ${
              tab === t.key ? 'bg-primary text-white border-primary' : 'bg-background border-border hover:bg-secondary/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="hidden md:flex items-center gap-2">
        <select
          value={selectedOrgId}
          onChange={(e) => setOrg(e.target.value)}
          className="h-8 max-w-[260px] px-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="">Все организации</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.plan})
            </option>
          ))}
        </select>

        <button
          onClick={onRefresh}
          className="h-8 w-8 rounded-lg border border-border bg-background hover:bg-secondary/30 flex items-center justify-center"
          title="Обновить"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          onClick={onLogout}
          className="h-8 w-8 rounded-lg border border-border bg-background hover:bg-secondary/30 flex items-center justify-center"
          title="Выйти"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
