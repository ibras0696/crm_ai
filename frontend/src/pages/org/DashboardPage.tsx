import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { billingApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
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
      title: 'Таблицы',
      value: totalTables.toString(),
      change: `${totalRecords} записей`,
      icon: Database,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      to: '/tables',
    },
    {
      title: 'Файлы',
      value: storageUsed,
      change: totalFiles > 0 ? `${totalFiles} файлов` : 'Нет файлов',
      icon: HardDrive,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      to: '/docs',
    },
  ]

  return (
    <div className="space-y-6 pb-24 md:pb-6 touch-pan-y">
      {/* Welcome header */}
      <div className="px-4 pt-2 md:px-0 md:pt-0">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          С возвращением, {user?.first_name} 👋
        </h1>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Что происходит в <span className="text-foreground font-medium">{org?.name}</span>
        </p>
      </div>

      {/* Stats Grid — 2 cols on mobile, 4 on desktop */}
      <section>
        <p className="px-4 md:px-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Обзор
        </p>
        <div className="px-4 md:px-0 grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <Card
              key={stat.title}
              role="button"
              tabIndex={0}
              aria-label={`Открыть раздел: ${stat.title}`}
              className="gradient-card cursor-pointer rounded-2xl border-border/50 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.97]"
              onClick={() => navigate(stat.to)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  navigate(stat.to)
                }
              }}
            >
              <CardContent className="p-4">
                {/* Icon top-right */}
                <div className="flex justify-end">
                  <div className={`rounded-lg p-2 ${stat.bg}`}>
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xl font-bold leading-none">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.title}</p>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground leading-snug line-clamp-2">
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Team Members */}
      <section>
        <p className="px-4 md:px-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Участники
        </p>
        <div className="px-4 md:px-0">
          <Card className="rounded-2xl border-border/50 overflow-hidden">
            {/* Header row */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <span className="text-sm font-medium">
                {members.length} активных участников
              </span>
              <Badge variant="secondary" className="text-xs uppercase">{org?.plan}</Badge>
            </div>
            {/* Member rows */}
            <div>
              {members.map((m, idx) => {
                const initials = `${m.user_first_name?.[0] ?? ''}${m.user_last_name?.[0] ?? ''}`.toUpperCase()
                return (
                  <div
                    key={m.id}
                    className={`flex items-center gap-3 px-4 py-3 min-h-[56px] transition-colors hover:bg-secondary/40 ${
                      idx < members.length - 1 ? 'border-b border-border/40' : ''
                    }`}
                  >
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="bg-primary/20 text-primary text-xs font-medium">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {m.user_first_name} {m.user_last_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{m.user_email}</p>
                    </div>
                    <Badge
                      variant={m.role === 'owner' ? 'default' : m.role === 'admin' ? 'warning' : 'secondary'}
                      className="shrink-0 text-xs"
                    >
                      {m.role}
                    </Badge>
                  </div>
                )
              })}
              {members.length === 0 && (
                <div className="text-center py-10 text-muted-foreground">
                  <Users className="h-9 w-9 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Пока нет участников</p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </section>

      {/* Org Status */}
      <section>
        <p className="px-4 md:px-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Состояние организации
        </p>
        <div className="px-4 md:px-0">
          <Card className="rounded-2xl border-border/50 overflow-hidden">
            {statusItems.map((item, idx) => (
              <div
                key={item.title}
                className={`flex items-center gap-3 px-4 py-3.5 min-h-[56px] ${
                  idx < statusItems.length - 1 ? 'border-b border-border/40' : ''
                }`}
              >
                <div className="rounded-lg bg-secondary/60 p-2 shrink-0">
                  <item.icon className={`h-4 w-4 ${item.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{item.title}</p>
                  <p className="text-sm font-medium truncate">{item.text}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground max-w-[120px] text-right leading-tight">
                    {item.hint}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </section>

      {/* Quick info cards — horizontal scroll on mobile */}
      <section>
        <p className="px-4 md:px-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Подсказки
        </p>
        <div className="flex gap-2.5 overflow-x-auto pb-2 snap-x snap-mandatory px-4 md:px-0 md:grid md:grid-cols-2 md:overflow-visible">
          <div className="snap-start shrink-0 w-[200px] md:w-auto rounded-xl border border-border/50 bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold mb-1.5">
              <Shield className="h-3.5 w-3.5 text-blue-400 shrink-0" />
              Роли в команде
            </div>
            <p className="text-xs text-muted-foreground">
              {ownersCount} owner, {adminsCount} admin,{' '}
              {Math.max(members.length - ownersCount - adminsCount, 0)} employee
            </p>
          </div>
          <div className="snap-start shrink-0 w-[200px] md:w-auto rounded-xl border border-border/50 bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold mb-1.5">
              <UserPlus className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              Что делать дальше
            </div>
            <p className="text-xs text-muted-foreground">
              Добавьте участников, создайте таблицы и подключите документы.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
