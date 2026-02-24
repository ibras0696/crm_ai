import { LogOut, Moon, RefreshCw, Sun } from 'lucide-react'

import { SaProfileIcon } from '@/components/icons/modules/SuperadminModuleIcons'
import { useTheme } from '@/contexts/ThemeContext'

type Props = {
  onRefresh: () => void
  onLogout: () => void
}

export function SuperadminProfileView({ onRefresh, onLogout }: Props) {
  const { theme, setTheme } = useTheme()

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-6 lg:p-7 space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary shadow-sm">
          <SaProfileIcon className="h-5 w-5 text-white" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold leading-none">Профиль супер-админа</h2>
          <p className="text-sm text-muted-foreground">Настройки интерфейса и действия сессии</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Тема интерфейса</h3>
            <p className="text-xs text-muted-foreground mt-1">Выберите удобный режим отображения</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTheme('dark')}
              className={`h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-sm ${
                theme === 'dark' ? 'border-primary bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent'
              }`}
            >
              <Moon className="h-4 w-4" /> Темная
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`h-11 rounded-xl border inline-flex items-center justify-center gap-2 text-sm ${
                theme === 'light' ? 'border-primary bg-primary/12 text-primary' : 'border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent'
              }`}
            >
              <Sun className="h-4 w-4" /> Светлая
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/60 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Сессия</h3>
            <p className="text-xs text-muted-foreground mt-1">Обновление данных и завершение сеанса</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-2">
            <button
              onClick={onRefresh}
              className="h-11 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-sm"
            >
              <RefreshCw className="h-4 w-4" />
              Обновить данные
            </button>
            <button
              onClick={onLogout}
              className="h-11 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent inline-flex items-center justify-center gap-2 text-sm"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
