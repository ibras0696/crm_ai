import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PreCallLobby } from './components/PreCallLobby'
import { CallRoom } from './components/CallRoom'
import { callsApi } from '../../lib/api/calls'
import type { RoomOut } from '../../lib/api/calls'
import { PhoneCall, ArrowRight, Clock, VideoCamera } from '@phosphor-icons/react'
import { useAuth } from '../../contexts/AuthContext'

type Phase = 'idle' | 'lobby' | 'room'

interface JoinPreferences {
  audio: boolean
  video: boolean
}

function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'только что'
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  return `${h} ч назад`
}

export default function CallPage() {
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const [phase, setPhase] = useState<Phase>('idle')
  const [slug, setSlug] = useState<string | null>(null)
  const [room, setRoom] = useState<RoomOut | null>(null)
  const [joinPreferences, setJoinPreferences] = useState<JoinPreferences>({ audio: true, video: true })
  const [activeRooms, setActiveRooms] = useState<RoomOut[]>([])
  const [roomsLoading, setRoomsLoading] = useState(true)

  const loadActiveRooms = useCallback(() => {
    callsApi.listRooms()
      .then((res) => setActiveRooms(res.data.data))
      .catch(() => {})
      .finally(() => setRoomsLoading(false))
  }, [])

  // Load active rooms on mount and refresh every 30s
  useEffect(() => {
    loadActiveRooms()
    const interval = setInterval(loadActiveRooms, 30_000)
    return () => clearInterval(interval)
  }, [loadActiveRooms])

  // Auto-join when URL contains ?slug= (incoming call accept or history rejoin)
  useEffect(() => {
    const urlSlug = searchParams.get('slug')
    if (urlSlug && phase === 'idle') {
      handleJoinWithSlug(urlSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleCreateRoom = async () => {
    const res = await callsApi.createRoom({ title: 'Новый звонок' })
    const newRoom = res.data.data
    setRoom(newRoom)
    setSlug(newRoom.slug)
    setPhase('lobby')
  }

  const handleJoinWithSlug = async (roomSlug: string) => {
    const res = await callsApi.getRoom(roomSlug)
    setRoom(res.data.data)
    setSlug(roomSlug)
    setPhase('lobby')
  }

  const handleReadyToJoin = (preferences: JoinPreferences) => {
    setJoinPreferences(preferences)
    setPhase('room')
  }

  const handleLeave = () => {
    setPhase('idle')
    setSlug(null)
    setRoom(null)
    // Refresh active rooms after leaving
    setTimeout(loadActiveRooms, 1000)
  }

  if (phase === 'lobby' && slug) {
    return <PreCallLobby slug={slug} room={room} onJoin={handleReadyToJoin} onCancel={handleLeave} />
  }

  if (phase === 'room' && slug) {
    return (
      <CallRoom
        slug={slug}
        onLeave={handleLeave}
        isHost={room?.host_id === user?.id}
        initialAudio={joinPreferences.audio}
        initialVideo={joinPreferences.video}
      />
    )
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Созвон</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Начните звонок или присоединитесь к активному</p>
        </div>
        <button
          onClick={handleCreateRoom}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          <PhoneCall size={16} weight="fill" />
          Новый созвон
        </button>
      </div>

      {/* Active rooms */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Активные созвоны</h2>
          <button
            onClick={loadActiveRooms}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Обновить
          </button>
        </div>

        {roomsLoading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 rounded-xl border border-dashed border-border">
            <VideoCamera size={32} className="text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Нет активных созвонов</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {activeRooms.map((activeRoom) => {
              const isMyRoom = activeRoom.host_id === user?.id
              return (
                <div
                  key={activeRoom.id}
                  className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
                >
                  {/* Live dot */}
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <VideoCamera size={20} className="text-primary" />
                    <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-red-500 border-2 border-card animate-pulse" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{activeRoom.title ?? 'Созвон'}</p>
                      {isMyRoom && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                          Мой
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Clock size={11} />
                      {activeRoom.started_at ? formatAgo(activeRoom.started_at) : 'только что'}
                    </div>
                  </div>

                  <button
                    onClick={() => handleJoinWithSlug(activeRoom.slug)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    Войти
                    <ArrowRight size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer link */}
      <div className="flex justify-center pt-2">
        <Link
          to="/calls/history"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          История звонков →
        </Link>
      </div>
    </div>
  )
}
