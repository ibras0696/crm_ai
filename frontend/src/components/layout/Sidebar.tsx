import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  Folder,
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

const mainNav = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
  { to: '/members', icon: Users, label: 'Команда' },
  { to: '/audit', icon: Shield, label: 'Журнал' },
]

const moduleNav = [
  { to: '/tables', icon: FileText, label: 'Таблицы' },
  { to: '/docs', icon: Folder, label: 'Документы' },
  { to: '/knowledge', icon: BookOpen, label: 'База знаний' },
  { to: '/schedule', icon: Calendar, label: 'Расписание' },
  { to: '/reports', icon: BarChart3, label: 'Отчёты' },
  { to: '/ai', icon: Brain, label: 'AI Агент' },
  { to: '/admin', icon: Wrench, label: 'Админ-панель' },
  { to: '/billing', icon: CreditCard, label: 'Биллинг' },
  { to: '/plans', icon: BarChart2, label: 'Тарифы' },
]

interface SidebarProps {
  mobileOpen?: boolean
  onMobileClose?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function Sidebar({ mobileOpen, onMobileClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { org } = useAuth()
  const orgName = typeof org?.name === 'string' ? org.name.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))) : ''

  const sidebarContent = (isCollapsed: boolean, isMobile: boolean) => (
    <>
      <div className="flex h-14 md:h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-primary">
          <span className="text-sm font-bold text-white">C</span>
        </div>
        {!isCollapsed && (
          <div className="flex flex-col overflow-hidden flex-1">
            <span className="truncate text-sm font-semibold text-sidebar-foreground">CRM Платформа</span>
            {org && <span className="truncate text-xs text-muted-foreground">{orgName}</span>}
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
          Основное
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
          Модули
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
          {!isCollapsed && <span>Настройки</span>}
        </NavLink>

        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
            style={isCollapsed ? { justifyContent: 'center', paddingLeft: '0.5rem', paddingRight: '0.5rem' } : {}}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!isCollapsed && <span>Свернуть</span>}
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
