import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  Calendar,
  Brain,
  BarChart3,
  BarChart2,
  BookOpen,
  Shield,
  ChevronLeft,
  ChevronRight,
  X,
  Wrench,
  CreditCard,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const mainNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f' },
  { to: '/members', icon: Users, label: '\u041a\u043e\u043c\u0430\u043d\u0434\u0430' },
  { to: '/audit', icon: Shield, label: '\u0416\u0443\u0440\u043d\u0430\u043b' },
]

const moduleNav = [
  { to: '/tables', icon: FileText, label: '\u0422\u0430\u0431\u043b\u0438\u0446\u044b' },
  { to: '/knowledge', icon: BookOpen, label: '\u0411\u0430\u0437\u0430 \u0437\u043d\u0430\u043d\u0438\u0439' },
  { to: '/schedule', icon: Calendar, label: '\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435' },
  { to: '/reports', icon: BarChart3, label: '\u041e\u0442\u0447\u0435\u0442\u044b' },
  { to: '/ai', icon: Brain, label: 'AI \u0410\u0433\u0435\u043d\u0442' },
  { to: '/admin', icon: Wrench, label: '\u0410\u0434\u043c\u0438\u043d-\u043f\u0430\u043d\u0435\u043b\u044c' },
  { to: '/billing', icon: CreditCard, label: '\u0411\u0438\u043b\u043b\u0438\u043d\u0433' },
  { to: '/plans', icon: BarChart2, label: '\u0422\u0430\u0440\u0438\u0444\u044b' },
]

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const { org } = useAuth()
  const [collapsed, setCollapsed] = useState(false)

  const sidebarContent = (isCollapsed: boolean, isMobile: boolean) => (
    <>
      <div className="flex h-14 md:h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-primary">
          <span className="text-sm font-bold text-white">C</span>
        </div>
        {!isCollapsed && (
          <div className="flex flex-col overflow-hidden flex-1">
            <span className="truncate text-sm font-semibold text-sidebar-foreground">CRM \u041f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0430</span>
            {org && <span className="truncate text-xs text-muted-foreground">{org.name}</span>}
          </div>
        )}
        {isMobile && (
          <Button variant="ghost" size="icon" className="ml-auto text-muted-foreground" onClick={onMobileClose}>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
        <div className={cn('mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground', isCollapsed && 'sr-only')}>
          {'\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0435'}
        </div>
        {mainNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={isMobile ? onMobileClose : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive ? 'bg-sidebar-accent text-sidebar-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isCollapsed && 'justify-center px-2'
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}

        <Separator className="!my-4 bg-sidebar-border" />

        <div className={cn('mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground', isCollapsed && 'sr-only')}>
          {'\u041c\u043e\u0434\u0443\u043b\u0438'}
        </div>
        {moduleNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={isMobile ? onMobileClose : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive ? 'bg-sidebar-accent text-sidebar-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isCollapsed && 'justify-center px-2'
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!isCollapsed && <span className="flex-1">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <NavLink
          to="/settings"
          onClick={isMobile ? onMobileClose : undefined}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
              isActive ? 'bg-sidebar-accent text-sidebar-primary' : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground',
              isCollapsed && 'justify-center px-2'
            )
          }
        >
          <Settings className="h-5 w-5 shrink-0" />
          {!isCollapsed && <span>{'\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'}</span>}
        </NavLink>

        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
            style={isCollapsed ? { justifyContent: 'center', paddingLeft: '0.5rem', paddingRight: '0.5rem' } : {}}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!isCollapsed && <span>{'\u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c'}</span>}
          </button>
        )}
      </div>
    </>
  )

  return (
    <>
      <aside
        className={cn(
          'hidden md:flex fixed left-0 top-0 z-40 h-screen flex-col border-r border-sidebar-border bg-sidebar-background transition-all duration-300',
          collapsed ? 'w-[68px]' : 'w-[260px]'
        )}
      >
        {sidebarContent(collapsed, false)}
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onMobileClose} />
          <aside
            className="relative z-10 flex h-screen w-[280px] flex-col border-r border-sidebar-border bg-sidebar-background shadow-2xl"
            style={{ backgroundColor: 'hsl(var(--sidebar-background))' }}
          >
            {sidebarContent(false, true)}
          </aside>
        </div>
      )}
    </>
  )
}