import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Users,
  Building2,
  TrendingUp,
  Activity,
  ArrowUpRight,
  Clock,
  Shield,
  UserPlus,
} from 'lucide-react'

export default function DashboardPage() {
  const { user, org, members } = useAuth()

  const stats = [
    {
      title: 'Участники',
      value: members.length.toString(),
      change: '+1 в этом месяце',
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      title: 'Тариф',
      value: org?.plan?.toUpperCase() ?? 'FREE',
      change: 'Текущий план',
      icon: Building2,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
    },
    {
      title: 'Активных модулей',
      value: '3',
      change: 'Авторизация, Орг, Аудит',
      icon: TrendingUp,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      title: 'Статус API',
      value: '99.9%',
      change: 'Все системы работают',
      icon: Activity,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
  ]

  const recentActivity = [
    { icon: UserPlus, text: 'Вы создали организацию', time: 'Только что', color: 'text-emerald-400' },
    { icon: Shield, text: 'Политики RBAC настроены', time: '1 мин. назад', color: 'text-blue-400' },
    { icon: Users, text: `${members.length} участник(ов) активно`, time: '2 мин. назад', color: 'text-purple-400' },
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
          <Card key={stat.title} className="gradient-card border-border/50 hover:border-border transition-colors">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className={`rounded-lg p-2.5 ${stat.bg}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
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

        {/* Recent Activity */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-lg">Последняя активность</CardTitle>
            <CardDescription>Последние события в организации</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-secondary/50 p-2">
                    <item.icon className={`h-4 w-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{item.text}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{item.time}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
