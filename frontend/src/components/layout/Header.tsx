import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Bell, Search, Sun, Moon, Menu, BellOff, CheckCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { notificationsApi, NotificationInfo } from '@/lib/api'

interface HeaderProps {
  onMenuToggle?: () => void
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, org, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [notifications, setNotifications] = useState<NotificationInfo[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const loadNotifications = async () => {
    try {
      const listResp = await notificationsApi.list(20)
      if (listResp.data.ok && listResp.data.data) {
        setNotifications(listResp.data.data)
      }
    } catch {
      // ignore
    }
  }

  const loadUnreadCount = async () => {
    try {
      const countResp = await notificationsApi.unreadCount()
      if (countResp.data.ok && countResp.data.data) {
        setUnreadCount(countResp.data.data.count)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadUnreadCount()

    const onVisibility = () => {
      if (!document.hidden) loadUnreadCount()
    }

    document.addEventListener('visibilitychange', onVisibility)
    const interval = setInterval(loadUnreadCount, 60000)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (notifOpen) {
      loadNotifications()
    }
  }, [notifOpen])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllRead()
      setUnreadCount(0)
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    } catch {
      // ignore
    }
  }

  const handleMarkRead = async (id: string) => {
    try {
      await notificationsApi.markRead(id)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch {
      // ignore
    }
  }

  const initials = user
    ? `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : '??'

  return (
    <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center gap-2 md:gap-4 border-b border-border bg-background/80 backdrop-blur-md px-3 md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden text-muted-foreground" onClick={onMenuToggle}>
        <Menu className="h-5 w-5" />
      </Button>

      <div className="relative flex-1 max-w-md hidden sm:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Поиск..." className="pl-9 bg-secondary/50 border-none h-9 focus-visible:ring-1" />
      </div>

      <div className="flex-1" />

      <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground hover:text-foreground">
        {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      <div className="relative" ref={notifRef}>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" onClick={() => setNotifOpen(!notifOpen)}>
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
        </Button>

        {notifOpen && (
          <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border bg-popover shadow-lg z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-semibold">Уведомления</span>
              {unreadCount > 0 && <Badge variant="default" className="text-[10px]">{unreadCount}</Badge>}
            </div>
            {unreadCount > 0 && (
              <div className="px-4 py-2 border-b border-border">
                <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <CheckCheck className="h-3 w-3" /> Прочитать все
                </button>
              </div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-muted-foreground">
                  <BellOff className="h-8 w-8 mb-2 opacity-40" />
                  <span className="text-sm">Нет уведомлений</span>
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                    className={`px-4 py-3 border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors cursor-pointer ${!n.is_read ? 'bg-primary/5' : ''}`}
                  >
                    <p className="text-sm">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString('ru')}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {org && (
        <Badge variant={org.plan === 'free' ? 'secondary' : 'default'} className="uppercase text-[10px] hidden sm:inline-flex">
          {org.plan}
        </Badge>
      )}

      <div className="flex items-center gap-2 md:gap-3 pl-2 border-l border-border ml-1 md:ml-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-primary/20 text-primary text-xs">{initials}</AvatarFallback>
        </Avatar>
        <div className="hidden lg:flex flex-col">
          <span className="text-sm font-medium leading-none">
            {user?.first_name} {user?.last_name}
          </span>
          <span className="text-xs text-muted-foreground">{user?.email}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive" title="Выйти">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
