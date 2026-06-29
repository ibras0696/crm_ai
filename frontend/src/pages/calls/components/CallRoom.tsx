import { useEffect, useState } from 'react'
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import '@livekit/components-styles'
import { useCallRoom } from '../../../hooks/useCallRoom'
import { CallControls } from './CallControls'
import { ParticipantList } from './ParticipantList'
import { InCallChat } from './InCallChat'
import { VideoGrid } from './VideoGrid'
import { InviteDialog } from './InviteDialog'
import { callsApi } from '../../../lib/api/calls'

interface Props {
  slug: string
  onLeave: () => void
  isHost?: boolean
  hostId?: string
}

function CallRoomInner({ slug, onLeave, isHost = false, hostId }: Props) {
  const [showParticipants, setShowParticipants] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)

  const handleMuteParticipantAudio = async (identity: string) => {
    try {
      await callsApi.muteParticipant(slug, identity, 'audio')
    } catch {
      // non-critical: ignore silently
    }
  }

  const handleMuteParticipantScreenShare = async (identity: string) => {
    try {
      await callsApi.muteParticipant(slug, identity, 'screenshare')
    } catch {
      // non-critical: ignore silently
    }
  }

  const handleToggleRecording = async () => {
    setRecordingError(null)
    try {
      if (isRecording) {
        await callsApi.stopRecording(slug)
        setIsRecording(false)
      } else {
        await callsApi.startRecording(slug)
        setIsRecording(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setRecordingError(msg.includes('egress') || msg.includes('worker')
        ? 'Сервис записи недоступен. Убедитесь что egress запущен.'
        : `Ошибка записи: ${msg}`)
      setTimeout(() => setRecordingError(null), 5000)
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">
      <RoomAudioRenderer />

      {/* Recording badge */}
      {isRecording && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 bg-red-600/90 rounded-full">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-[11px] font-semibold text-white tracking-wide">REC</span>
        </div>
      )}

      {/* Main area: video + optional sidebar */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Video grid */}
        <div className="flex-1 overflow-hidden relative">
          <VideoGrid
            isHost={isHost}
            onMuteParticipantAudio={isHost ? handleMuteParticipantAudio : undefined}
            onMuteParticipantScreenShare={isHost ? handleMuteParticipantScreenShare : undefined}
          />
        </div>

        {/* Control bar — always docked to bottom, never scrolls */}
        <CallControls
          onLeave={onLeave}
          onToggleParticipants={() => { setShowParticipants((v) => !v); setShowChat(false) }}
          participantsOpen={showParticipants}
          onToggleChat={() => { setShowChat((v) => !v); setShowParticipants(false) }}
          chatOpen={showChat}
          onToggleRecording={handleToggleRecording}
          isRecording={isRecording}
          isHost={isHost}
          recordingError={recordingError}
          onInvite={() => setShowInvite(true)}
        />
      </div>

      {/* Sidebars — slide in from right on desktop, overlay on mobile */}
      {showChat && (
        <div className="absolute inset-y-0 right-0 z-20 flex md:relative md:inset-auto">
          <InCallChat onClose={() => setShowChat(false)} />
        </div>
      )}
      {showParticipants && (
        <div className="absolute inset-y-0 right-0 z-20 flex md:relative md:inset-auto">
          <ParticipantList
            onClose={() => setShowParticipants(false)}
            isHost={isHost}
            hostId={hostId}
            onMuteAudio={isHost ? handleMuteParticipantAudio : undefined}
          />
        </div>
      )}

      {showInvite && (
        <InviteDialog slug={slug} onClose={() => setShowInvite(false)} />
      )}
    </div>
  )
}

export function CallRoom({ slug, onLeave, isHost = false }: Omit<Props, 'hostId'>) {
  const { token, liveKitUrl, hostId, isLoading, error, joinRoom, leaveRoom } = useCallRoom()

  // Only join on mount — do NOT call leaveRoom in cleanup.
  // Cleanup would fire on page refresh and incorrectly mark the user as left.
  // LiveKit handles disconnection via departure_timeout; the webhook updates the DB.
  useEffect(() => {
    void joinRoom(slug)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleLeave = async () => {
    await leaveRoom(slug)
    onLeave()
  }

  // Full-screen overlay — escapes AppLayout (sidebar, header, bottom-nav)
  return (
    <div className="fixed inset-0 z-[100] bg-zinc-950">
      {error && (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-white">
          <p className="text-red-400 text-sm">Ошибка подключения: {error}</p>
          <button
            onClick={onLeave}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-sm"
          >
            Вернуться
          </button>
        </div>
      )}

      {!error && (isLoading || !token || !liveKitUrl) && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-white/50 text-sm">Подключение...</p>
          </div>
        </div>
      )}

      {!error && token && liveKitUrl && (
        <LiveKitRoom
          serverUrl={liveKitUrl}
          token={token}
          connect={true}
          audio={false}
          video={false}
          onDisconnected={handleLeave}
          className="h-full"
        >
          <CallRoomInner slug={slug} onLeave={handleLeave} isHost={isHost} hostId={hostId ?? undefined} />
        </LiveKitRoom>
      )}
    </div>
  )
}
