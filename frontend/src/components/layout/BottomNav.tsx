import { NavLink } from 'react-router-dom'
import {
  House,
  Robot,
  ChatCircle,
  Table,
  DotsThreeOutline,
} from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface BottomNavProps {
  onMorePress: () => void
}

const navItems = [
  { to: '/dashboard', label: 'Главная', Icon: House },
  { to: '/ai',        label: 'AI',       Icon: Robot },
  { to: '/chat',      label: 'Чат',      Icon: ChatCircle },
  { to: '/tables',    label: 'Таблицы',  Icon: Table },
] as const

export default function BottomNav({ onMorePress }: BottomNavProps) {
  return (
    <nav
      className={cn(
        'md:hidden',
        'fixed bottom-0 left-0 right-0 z-50',
        'flex items-stretch',
        'bg-background/95 backdrop-blur-md border-t border-border',
        'pb-[env(safe-area-inset-bottom)]',
      )}
      aria-label="Нижняя навигация"
    >
      {navItems.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center justify-center py-2 px-1 min-h-[52px]',
              'active:scale-95 transition-transform duration-100',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={22}
                weight={isActive ? 'fill' : 'regular'}
                aria-hidden="true"
              />
              <span className="text-[10px] font-medium mt-0.5 leading-none">
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}

      {/* "More" button opens the sidebar overlay */}
      <button
        type="button"
        onClick={onMorePress}
        className={cn(
          'flex flex-1 flex-col items-center justify-center py-2 px-1 min-h-[52px]',
          'active:scale-95 transition-transform duration-100',
          'text-muted-foreground',
        )}
        aria-label="Ещё"
      >
        <DotsThreeOutline size={22} weight="regular" aria-hidden="true" />
        <span className="text-[10px] font-medium mt-0.5 leading-none">Ещё</span>
      </button>
    </nav>
  )
}
