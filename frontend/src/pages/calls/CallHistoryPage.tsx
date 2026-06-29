import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callsApi, type CallHistoryOut } from '../../lib/api/calls'
import { VideoCamera, Clock, Users, ArrowLeft, ArrowRight } from '@phosphor-icons/react'

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}ч ${m}м`
  if (m > 0) return `${m}м ${s}с`
  return `${s}с`
}

export default function CallHistoryPage() {
  const [history, setHistory] = useState<CallHistoryOut[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    callsApi.getHistory()
      .then((res) => setHistory(res.data.data))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const header = (
    <div className="flex items-center gap-3 mb-4">
      <button
        onClick={() => navigate('/calls')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={16} />
        Назад
      </button>
      <h1 className="text-xl font-semibold">История звонков</h1>
    </div>
  )

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        {header}
        <div className="flex justify-center items-center h-40">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        {header}
        <div className="flex flex-col items-center justify-center h-60 text-center gap-3">
          <VideoCamera size={40} className="text-muted-foreground" />
          <p className="text-muted-foreground text-sm">История звонков пуста</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      {header}

      {history.map((call) => {
        const isEnded = call.status === 'ended'
        const isActive = call.status === 'active'

        return (
          <div
            key={call.id}
            className={`flex items-center gap-4 p-4 rounded-xl border border-border bg-card transition-colors ${
              isActive ? 'hover:bg-accent cursor-pointer' : 'opacity-70'
            }`}
            onClick={() => isActive && navigate(`/calls?slug=${call.slug}`)}
          >
            {/* Icon */}
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              isActive ? 'bg-primary/10' : 'bg-muted'
            }`}>
              <VideoCamera size={20} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{call.title ?? 'Созвон'}</p>
                {isActive && (
                  <span className="shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                    Live
                  </span>
                )}
                {isEnded && (
                  <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    Завершён
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {call.my_role === 'host' ? 'Организатор' : 'Участник'}
                {call.created_at && ` · ${new Date(call.created_at).toLocaleDateString('ru-RU')}`}
              </p>
            </div>

            {/* Stats */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock size={12} />
                {formatDuration(call.duration_seconds)}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users size={12} />
                {call.participant_count}
              </div>
            </div>

            {/* Join arrow only for active */}
            {isActive && (
              <ArrowRight size={16} className="text-primary shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}
