import type { SVGProps } from 'react'
import { Moon, Sun, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  SaAiIcon,
  SaAuditIcon,
  SaDashboardIcon,
  SaOrganizationsIcon,
  SaProfileIcon,
  SaShieldIcon,
  SaTablesIcon,
  SaUsersIcon,
} from '@/components/icons/modules/SuperadminModuleIcons'

type TabKey = 'dashboard' | 'orgs' | 'tables' | 'users' | 'audit' | 'ai' | 'profile'

type Props = {
  tab: TabKey
  onTab: (t: TabKey) => void
  mobileOpen: boolean
  onCloseMobile: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

type TabDef = {
  key: TabKey
  label: string
  Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element
}

const TABS: TabDef[] = [
  { key: 'dashboard', label: 'Дашборд', Icon: SaDashboardIcon },
  { key: 'orgs', label: 'Организации', Icon: SaOrganizationsIcon },
  { key: 'tables', label: 'Таблицы', Icon: SaTablesIcon },
  { key: 'users', label: 'Пользователи', Icon: SaUsersIcon },
  { key: 'audit', label: 'Аудит', Icon: SaAuditIcon },
  { key: 'ai', label: 'AI', Icon: SaAiIcon },
  { key: 'profile', label: 'Профиль', Icon: SaProfileIcon },
]

function SidebarContent({
  tab,
  onTab,
  onCloseMobile,
  collapsed,
  onToggleCollapsed,
  mobile,
}: Omit<Props, 'mobileOpen'> & { mobile: boolean }) {
  const { theme, toggleTheme } = useTheme()
  const compact = !mobile && collapsed

  return (
    <div className="relative flex h-full flex-col">
      <div className="pointer-events-none absolute -left-14 top-10 h-44 w-44 rounded-full bg-primary/20 blur-3xl" />

      <div className={`relative flex items-center justify-between ${compact ? 'px-2 py-2' : 'border-b border-sidebar-border px-4 py-4'}`}>
        <button
          onClick={() => !mobile && onToggleCollapsed()}
          className={`group flex items-center min-w-0 ${compact ? 'mx-auto h-11 w-11 justify-center rounded-xl border border-sidebar-border bg-sidebar-accent/40' : 'gap-3'}`}
          title={!mobile ? (compact ? 'Развернуть меню' : 'Свернуть меню') : undefined}
        >
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${compact ? 'bg-sidebar-background border border-sidebar-border' : 'gradient-primary'}`}>
            <SaShieldIcon className={`h-4 w-4 ${compact ? 'text-primary' : 'text-white'}`} />
          </div>
          <div className={`min-w-0 flex-col ${compact ? 'hidden' : 'flex'}`}>
            <span className="truncate text-sm font-semibold text-sidebar-foreground">Суперадминка</span>
            <span className="truncate text-xs text-muted-foreground">Platform Control</span>
          </div>
        </button>
        {mobile && (
          <button
            onClick={onCloseMobile}
            className="h-11 w-11 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className={`relative space-y-2 ${compact ? 'px-2 py-2' : 'px-3 py-4'}`}>
        <div className={`px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${compact ? 'hidden' : ''}`}>
          Модули
        </div>
        {TABS.map((t) => (
          <div key={t.key} className={`relative ${compact ? 'group flex justify-center' : ''}`}>
            <button
              onClick={() => {
                onTab(t.key)
                if (mobile) onCloseMobile()
              }}
              className={`h-11 text-sm border transition-all inline-flex items-center ${
                compact ? 'w-11 justify-center rounded-xl' : 'w-full gap-2 px-3 rounded-xl'
              } ${
                tab === t.key
                  ? 'bg-primary/10 text-primary border-primary/40'
                  : 'bg-sidebar-background border-sidebar-border text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
              }`}
            >
              <t.Icon className="h-4 w-4" />
              {!compact && t.label}
            </button>
            {compact && (
              <div className="pointer-events-none absolute left-[56px] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-sidebar-border bg-popover px-2 py-1 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
                {t.label}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className={`mt-auto ${compact ? 'pb-3 pt-1 flex justify-center' : 'border-t border-sidebar-border p-3'}`}>
        <button
          onClick={toggleTheme}
          title={compact ? (theme === 'dark' ? 'Светлая тема' : 'Темная тема') : undefined}
          className={`h-11 border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center text-sm ${
            compact ? 'w-11 justify-center rounded-xl' : 'w-full gap-2 px-3 rounded-xl'
          }`}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!compact && (theme === 'dark' ? 'Светлая тема' : 'Темная тема')}
        </button>
      </div>
    </div>
  )
}

export function SuperadminRightSidebar(props: Props) {
  return (
    <>
      <aside
        className={`hidden lg:block fixed left-0 top-0 z-30 h-screen border-r border-sidebar-border bg-sidebar-background/95 backdrop-blur transition-all ${
          props.collapsed ? 'w-20' : 'w-72'
        }`}
      >
        <SidebarContent {...props} mobile={false} />
      </aside>

      {props.mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/78 backdrop-blur-sm" onClick={props.onCloseMobile} aria-label="Close menu" />
          <aside
            className="absolute left-0 top-0 h-full w-[86vw] max-w-sm border-r border-sidebar-border shadow-2xl"
            style={{ backgroundColor: 'hsl(var(--sidebar-background))', opacity: 1 }}
          >
            <SidebarContent {...props} mobile />
          </aside>
        </div>
      )}
    </>
  )
}
