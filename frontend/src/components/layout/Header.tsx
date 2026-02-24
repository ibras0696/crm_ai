import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Bell, Search, Sun, Moon, Menu, BellOff, CheckCheck, Loader2, Database, Users, BookOpen, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { knowledgeApi, notificationsApi, NotificationInfo, orgApi, recordsApi, tablesApi } from '@/lib/api'

interface HeaderProps {
  onMenuToggle?: () => void
}

type GlobalSearchResult = {
  id: string
  kind: 'table' | 'record' | 'member' | 'knowledge'
  title: string
  subtitle: string
  route: string
}

export default function Header({ onMenuToggle }: HeaderProps) {
  const { user, org, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [notifications, setNotifications] = useState<NotificationInfo[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [searchText, setSearchText] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([])
  const searchRef = useRef<HTMLDivElement>(null)

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
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const q = searchText.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const [tablesResp, membersResp, pagesResp] = await Promise.all([
          tablesApi.list(),
          orgApi.getMembers(),
          knowledgeApi.list(),
        ])

        const tables = tablesResp.data.ok && tablesResp.data.data ? tablesResp.data.data : []
        const members = membersResp.data.ok && membersResp.data.data ? membersResp.data.data : []
        const pages = pagesResp.data.ok && pagesResp.data.data ? pagesResp.data.data : []
        const query = q.toLowerCase()

        const tableResults: GlobalSearchResult[] = tables
          .filter((t) => (t.name || '').toLowerCase().includes(query))
          .slice(0, 5)
          .map((t) => ({
            id: `table-${t.id}`,
            kind: 'table',
            title: t.name,
            subtitle: 'Таблица',
            route: `/tables/${t.id}`,
          }))

        const memberResults: GlobalSearchResult[] = members
          .filter((m) => {
            const fullName = `${m.user_first_name || ''} ${m.user_last_name || ''}`.toLowerCase()
            return fullName.includes(query) || (m.user_email || '').toLowerCase().includes(query)
          })
          .slice(0, 5)
          .map((m) => ({
            id: `member-${m.id}`,
            kind: 'member',
            title: `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || (m.user_email || 'Участник'),
            subtitle: `Участник · ${m.user_email || 'без email'}`,
            route: '/members',
          }))

        const pageResults: GlobalSearchResult[] = pages
          .filter((p) => (p.title || '').toLowerCase().includes(query) || (p.content || '').toLowerCase().includes(query))
          .slice(0, 5)
          .map((p) => ({
            id: `kb-${p.id}`,
            kind: 'knowledge',
            title: p.title,
            subtitle: 'Страница базы знаний',
            route: '/knowledge',
          }))

        const tableCandidates = tables.slice(0, 6)
        const recordBatches = await Promise.all(
          tableCandidates.map(async (t) => {
            try {
              const r = await recordsApi.list(t.id, 40, 0)
              if (!r.data.ok || !r.data.data) return []
              return r.data.data.records
                .filter((rec) => JSON.stringify(rec.data || {}).toLowerCase().includes(query))
                .slice(0, 2)
                .map((rec) => {
                  const firstValue = Object.values(rec.data || {})[0]
                  const valuePreview = firstValue == null ? 'Запись' : String(firstValue)
                  return {
                    id: `record-${rec.id}`,
                    kind: 'record' as const,
                    title: valuePreview,
                    subtitle: `Запись в таблице "${t.name}"`,
                    route: `/tables/${t.id}`,
                  }
                })
            } catch {
              return []
            }
          }),
        )
        const recordResults = recordBatches.flat().slice(0, 6)

        if (!cancelled) {
          const merged = [...tableResults, ...recordResults, ...memberResults, ...pageResults].slice(0, 20)
          setSearchResults(merged)
          setSearchOpen(true)
        }
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchText])

  const groupedResults = useMemo(() => {
    return {
      tables: searchResults.filter((r) => r.kind === 'table'),
      records: searchResults.filter((r) => r.kind === 'record'),
      members: searchResults.filter((r) => r.kind === 'member'),
      knowledge: searchResults.filter((r) => r.kind === 'knowledge'),
    }
  }, [searchResults])

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

      <div className="relative flex-1 max-w-md hidden sm:block" ref={searchRef}>
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Глобальный поиск: таблицы, записи, участники, страницы..."
          className="pl-9 pr-9 bg-secondary/50 border-none h-9 focus-visible:ring-1"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onFocus={() => {
            if (searchText.trim().length >= 2) setSearchOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchResults.length > 0) {
              const first = searchResults[0]
              if (first) navigate(first.route)
              setSearchOpen(false)
            }
          }}
        />
        {searchLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground animate-spin" />}

        {searchOpen && (
          <div className="absolute top-full mt-2 left-0 right-0 rounded-xl border border-border bg-popover shadow-xl z-50 max-h-[420px] overflow-y-auto">
            {searchText.trim().length < 2 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Введи минимум 2 символа.</div>
            ) : searchLoading ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Ищем...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">Ничего не найдено.</div>
            ) : (
              <div className="p-2 space-y-2">
                {[
                  { key: 'tables', title: 'Таблицы', icon: Database, items: groupedResults.tables },
                  { key: 'records', title: 'Записи', icon: FileText, items: groupedResults.records },
                  { key: 'members', title: 'Участники', icon: Users, items: groupedResults.members },
                  { key: 'knowledge', title: 'База знаний', icon: BookOpen, items: groupedResults.knowledge },
                ].map((group) => {
                  if (group.items.length === 0) return null
                  return (
                    <div key={group.key} className="rounded-lg border border-border/60 bg-background/40">
                      <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border/60 flex items-center gap-2">
                        <group.icon className="h-3.5 w-3.5" />
                        {group.title}
                      </div>
                      <div className="py-1">
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              navigate(item.route)
                              setSearchOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-secondary/50 transition-colors"
                          >
                            <div className="text-sm">{item.title}</div>
                            <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
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
