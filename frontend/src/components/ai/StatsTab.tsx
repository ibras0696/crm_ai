import { BarChart3, Bot, User, Zap } from 'lucide-react'
import { Progress } from '@/components/ui/progress'

interface AIStats {
  total_requests: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
}

interface AIStatus {
  enabled: boolean
  configured: boolean
  plan?: string
  stats: AIStats
  today?: {
    requests: number
    total_tokens: number
    prompt_tokens: number
    completion_tokens: number
  }
  limits?: {
    daily_tokens: number
    rpm_per_user: number
    max_tokens_per_request: number
  }
  token_wallet?: {
    cycle_key: string
    plan_tokens_monthly_quota: number
    plan_tokens_remaining: number
    addon_tokens_remaining: number
    total_tokens_remaining: number
  }
}

interface StatsTabProps {
  status: AIStatus | null
  onRefresh: () => void
}

export default function StatsTab({ status, onRefresh }: StatsTabProps) {
  const todaySpent = status?.today?.total_tokens ?? 0
  const dailyLimit = status?.limits?.daily_tokens ?? 0
  const tokenWallet = status?.token_wallet
  const monthQuota = tokenWallet?.plan_tokens_monthly_quota ?? 0
  const monthRemaining = tokenWallet?.total_tokens_remaining ?? 0
  const monthUsed = Math.max(monthQuota - (tokenWallet?.plan_tokens_remaining ?? 0), 0)

  return (
    <div className="flex-1 overflow-y-auto space-y-4">
      {status?.limits && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Лимиты AI</p>
              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span>Тариф: {(status.plan || 'free').toUpperCase()}</span>
                <span>Лимит на запрос: {status.limits.max_tokens_per_request.toLocaleString('ru')}</span>
                <span>Скорость: {status.limits.rpm_per_user}/мин</span>
              </div>
            </div>
            <button
              onClick={onRefresh}
              className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary transition-colors shrink-0 self-start sm:self-auto"
            >
              Синхронизация
            </button>
          </div>

          {tokenWallet && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Осталось на месяц</p>
                  <div className="mt-2 text-3xl font-bold tracking-tight">{monthRemaining.toLocaleString('ru')}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Цикл: {tokenWallet.cycle_key} • Купленных отдельно: {tokenWallet.addon_tokens_remaining.toLocaleString('ru')}
                  </p>
                </div>
                {monthQuota > 0 && (
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div>По тарифу</div>
                    <div className="mt-1 font-medium text-foreground">
                      {tokenWallet.plan_tokens_remaining.toLocaleString('ru')} / {monthQuota.toLocaleString('ru')}
                    </div>
                  </div>
                )}
              </div>
              {monthQuota > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span>Использовано из месячного лимита</span>
                    <span>
                      {monthUsed.toLocaleString('ru')} / {monthQuota.toLocaleString('ru')}
                    </span>
                  </div>
                  <Progress value={Math.min(100, (monthUsed / monthQuota) * 100)} />
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Потрачено сегодня</span>
              <span>
                {todaySpent.toLocaleString('ru')} / {dailyLimit.toLocaleString('ru')}
              </span>
            </div>
            <Progress value={dailyLimit > 0 ? Math.min(100, (todaySpent / dailyLimit) * 100) : 0} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Запросов (сегодня)', value: status?.today?.requests ?? 0, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Потрачено токенов (сегодня)', value: status?.today?.total_tokens ?? 0, icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Входящих (сегодня)', value: status?.today?.prompt_tokens ?? 0, icon: User, color: 'text-violet-500', bg: 'bg-violet-500/10' },
          { label: 'Исходящих (сегодня)', value: status?.today?.completion_tokens ?? 0, icon: Bot, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-xl ${card.bg} flex items-center justify-center shrink-0`}>
              <card.icon className={`h-5 w-5 ${card.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xl lg:text-2xl font-bold truncate">{(card.value as number).toLocaleString('ru')}</p>
              <p className="text-xs text-muted-foreground leading-snug">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold mb-1">Всего (за все время)</p>
        <p className="text-xs text-muted-foreground">
          Запросов: {(status?.stats.total_requests ?? 0).toLocaleString('ru')} •
          Токенов: {(status?.stats.total_tokens ?? 0).toLocaleString('ru')} •
          Входящих: {(status?.stats.prompt_tokens ?? 0).toLocaleString('ru')} •
          Исходящих: {(status?.stats.completion_tokens ?? 0).toLocaleString('ru')}
        </p>
      </div>
    </div>
  )
}
