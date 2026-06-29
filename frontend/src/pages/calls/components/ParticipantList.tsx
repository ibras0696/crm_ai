import { useParticipants } from '@livekit/components-react'
import { Microphone, MicrophoneSlash, Camera, CameraSlash, X, Crown } from '@phosphor-icons/react'
import type { Participant } from 'livekit-client'

interface Props {
  onClose: () => void
  isHost?: boolean
  hostId?: string
  onMuteAudio?: (identity: string) => void
  onMuteScreenShare?: (identity: string) => void
}

interface RowProps {
  participant: Participant
  isRoomHost: boolean
  isHostViewer: boolean
  onMuteAudio?: (identity: string) => void
}

function ParticipantRow({ participant, isRoomHost, isHostViewer, onMuteAudio }: RowProps) {
  const isMicOn = participant.isMicrophoneEnabled
  const isCamOn = participant.isCameraEnabled
  const isLocal = participant.isLocal

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors">
      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
        {(participant.identity || '?').charAt(0).toUpperCase()}
        {isRoomHost && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400">
            <Crown size={9} weight="fill" className="text-amber-900" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          {participant.name || participant.identity}
          {isLocal && <span className="ml-1.5 text-xs text-muted-foreground">(вы)</span>}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {isMicOn ? (
          <Microphone size={14} className="text-success" />
        ) : (
          <MicrophoneSlash size={14} className="text-destructive" />
        )}
        {isCamOn ? (
          <Camera size={14} className="text-success" />
        ) : (
          <CameraSlash size={14} className="text-destructive" />
        )}

        {/* Host-only: mute mic button, hidden until row hover */}
        {isHostViewer && !isLocal && onMuteAudio && (
          <button
            onClick={() => onMuteAudio(participant.identity)}
            title="Заглушить микрофон"
            className="ml-1 hidden h-6 w-6 items-center justify-center rounded bg-white/10 text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive group-hover:flex"
          >
            <MicrophoneSlash size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

export function ParticipantList({ onClose, isHost = false, hostId, onMuteAudio }: Props) {
  const participants = useParticipants()

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">
          Участники ({participants.length})
        </h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {participants.map((participant: Participant) => (
          <ParticipantRow
            key={participant.sid}
            participant={participant}
            isRoomHost={hostId ? participant.identity === hostId : false}
            isHostViewer={isHost}
            onMuteAudio={onMuteAudio}
          />
        ))}
      </div>
    </div>
  )
}
