import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { billingApi } from '@/lib/api'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Users,
  Building2,
  HardDrive,
  CalendarClock,
  Clock,
  Shield,
  UserPlus,
  Database,
} from 'lucide-react'

type SubscriptionInfo = {
  plan: string
  status: string
  current_period_start: string | null
  current_period_end: string | null
  grace_period_end?: string | null
  data_purge_at?: string | null
  external_id?: string
}

type UsageInfo = {
  members: number
  tables: number
  records: number
  files: number
  storage_bytes: number
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru')
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  const digits = value >= 10 || index === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[index]}`
}

function subscriptionLabel(status: string | undefined): string {
  if (status === 'past_due') return 'Льготный период'
  if (status === 'cancelled') return 'Отключён'
  if (status === 'active') return 'Активен'
  return 'Базовый режим'
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user, org, members } = useAuth()
  const [billingNote, setBillingNote] = useState('Тариф активен')
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [subscriptionResp, usageResp] = await Promise.all([
          billingApi.subscription(),
          billingApi.usage(),
        ])
        if (!active) return
        if (subscriptionResp.data.ok && subscriptionResp.data.data) {
          const sub = subscriptionResp.data.data
          setSubscription(sub)
          if (sub.status === 'past_due') {
            setBillingNote(
              sub.grace_period_end
                ? `Льготный период до ${new Date(sub.grace_period_end).toLocaleDateString('ru')}`
                : 'Подписка просрочена',
            )
          } else if (sub.status === 'cancelled') {
            setBillingNote(
              sub.data_purge_at
                ? `Ограничения free-плана после ${new Date(sub.data_purge_at).toLocaleDateString('ru')}`
                : 'Тариф отменён',
            )
          } else if (sub.current_period_end) {
            setBillingNote(`Оплачен до ${new Date(sub.current_period_end).toLocaleDateString('ru')}`)
          } else {
            setBillingNote('Тариф активен')
          }
        }
        if (usageResp.data.ok && usageResp.data.data) {
          setUsage(usageResp.data.data)
        }
      } catch {
        // ignore
      }
    })()
    return () => { active = false }
  }, [])

  const ownersCount = members.filter((m) => m.role === 'owner').length
  const adminsCount = members.filter((m) => m.role === 'admin').length
  const totalTables = usage?.tables ?? 0
  const totalRecords = usage?.records ?? 0
  const totalFiles = usage?.files ?? 0
  const storageUsed = formatBytes(usage?.storage_bytes ?? 0)
  const currentPlan = (subscription?.plan ?? org?.plan ?? 'free').toUpperCase()
  const subscriptionState = subscriptionLabel(subscription?.status)

  const statusItems = [
    {
      icon: Building2,
      title: 'Организация',
      text: org?.name ?? 'Без названия',
      hint: org?.created_at ? `Создана ${formatDate(org.created_at)}` : 'Организация активна',
      color: 'text-emerald-400',
    },
    {
      icon: CalendarClock,
      title: 'Подписка',
      text: subscriptionState,
      hint:
        formatDate(subscription?.current_period_end)
        ?? formatDate(subscription?.grace_period_end)
        ?? billingNote,
      color: 'text-blue-400',
    },
    {
      icon: HardDrive,
      title: 'Хранилище',
      text: storageUsed,
      hint: `${totalFiles} файлов в документах`,
      color: 'text-amber-400',
    },
  ]

  const stats = [
    {
      title: 'Участники',
      value: members.length.toString(),
      change: ownersCount > 0 || adminsCount > 0
        ? `${ownersCount} owner, ${adminsCount} admin`
        : 'Команда ещё не настроена',
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      to: '/members',
    },
    {
      title: 'Тариф',
      value: currentPlan,
      change: billingNote,
      icon: Building2,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      to: '/billing',
    },
    {
      title: 'Таблицы и записи',
      value: totalTables.toString(),
      change: `${totalRecords} записей в рабочих таблицах`,
      icon: Database,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      to: '/tables',
    },
    {
      title: 'Файлы и хранилище',
      value: storageUsed,
      change: totalFiles > 0 ? `${totalFiles} файлов загружено` : 'Файлы ещё не загружались',
      icon: HardDrive,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      to: '/docs',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          С возвращением, {user?.first_name} 👋
        </h1>
        <p className="text-muted-foreground mt-1">
          Что происходит в <span className="text-foreground font-medium">{org?.name}</span>
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.title}
            role="button"
            tabIndex={0}
            aria-label={`Открыть раздел: ${stat.title}`}
            className="gradient-card cursor-pointer border-border/50 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => navigate(stat.to)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                navigate(stat.to)
              }
            }}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <div className="mt-4">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.title}</p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Team Members */}
        <Card className="lg:col-span-2 border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Участники</CardTitle>
              <CardDescription>{members.length} активных участников</CardDescription>
            </div>
            <Badge variant="secondary" className="text-xs">{org?.plan?.toUpperCase()}</Badge>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {members.map((m) => {
                const initials = `${m.user_first_name?.[0] ?? ''}${m.user_last_name?.[0] ?? ''}`.toUpperCase()
                return (
                  <div key={m.id} className="flex items-center gap-4 rounded-lg bg-secondary/30 p-3 hover:bg-secondary/50 transition-colors">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">{initials}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.user_first_name} {m.user_last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{m.user_email}</p>
                    </div>
                    <Badge variant={m.role === 'owner' ? 'default' : m.role === 'admin' ? 'warning' : 'secondary'}>
                      {m.role}
                    </Badge>
                  </div>
                )
              })}
              {members.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p>Пока нет участников</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Org Status */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Состояние организации</CardTitle>
            <CardDescription>Коротко о том, что важно сейчас</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {statusItems.map((item) => (
                <div key={item.title} className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-secondary/50 p-2">
                    <item.icon className={`h-4 w-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.title}</p>
                    <p className="text-sm font-medium">{item.text}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{item.hint}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 text-blue-400" />
                  Роли в команде
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {ownersCount} owner, {adminsCount} admin, {Math.max(members.length - ownersCount - adminsCount, 0)} employee
                </p>
              </div>
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <UserPlus className="h-4 w-4 text-emerald-400" />
                  Что делать дальше
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Добавьте участников, создайте первые таблицы и подключите документы, чтобы команда начала работать в одном контуре.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
