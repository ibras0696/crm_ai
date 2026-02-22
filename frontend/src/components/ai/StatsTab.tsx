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
}

interface StatsTabProps {
  status: AIStatus | null
  onRefresh: () => void
}

export default function StatsTab({ status, onRefresh }: StatsTabProps) {
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

          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Токены сегодня</span>
              <span>
                {(status.today?.total_tokens ?? 0).toLocaleString('ru')} / {status.limits.daily_tokens.toLocaleString('ru')}
              </span>
            </div>
            <Progress
              value={
                status.limits.daily_tokens > 0
                  ? Math.min(100, ((status.today?.total_tokens ?? 0) / status.limits.daily_tokens) * 100)
                  : 0
              }
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Запросов (сегодня)', value: status?.today?.requests ?? 0, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Токенов (сегодня)', value: status?.today?.total_tokens ?? 0, icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
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
