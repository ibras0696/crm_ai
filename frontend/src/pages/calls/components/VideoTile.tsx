import { useState } from 'react'
import { VideoTrack } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { PushPin, PushPinSimpleSlash, MicrophoneSlash, CameraSlash } from '@phosphor-icons/react'
import { cn } from '../../../lib/utils'

interface Props {
  trackRef: TrackReferenceOrPlaceholder
  isPinned: boolean
  isSpeaking: boolean
  onPin: () => void
  isHost: boolean
  onMuteAudio?: () => void
  onMuteScreenShare?: () => void
  className?: string
}

export function VideoTile({
  trackRef,
  isPinned,
  isSpeaking,
  onPin,
  isHost,
  onMuteAudio,
  onMuteScreenShare,
  className,
}: Props) {
  const [hovered, setHovered] = useState(false)
  const { participant, source } = trackRef
  const isLocal = participant.isLocal
  const isCamOn = participant.isCameraEnabled
  const isMicOn = participant.isMicrophoneEnabled
  const isScreenShare = source === Track.Source.ScreenShare

  // Show video when publication exists and track is not muted
  const hasVideo = !!trackRef.publication && !trackRef.publication.isMuted

  const displayName = participant.name || '?'
  const initial = displayName.charAt(0).toUpperCase()

  // Avatar from LiveKit participant metadata: {"avatar_url": "..."}
  let avatarUrl: string | null = null
  try {
    if (participant.metadata) {
      const meta = JSON.parse(participant.metadata) as { avatar_url?: string }
      avatarUrl = meta.avatar_url ?? null
    }
  } catch {
    // invalid JSON — ignore
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-zinc-900 transition-[box-shadow]',
        isSpeaking && 'ring-2 ring-primary ring-offset-1 ring-offset-zinc-950',
        className,
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hasVideo ? (
        <VideoTrack
          trackRef={trackRef}
          className="h-full w-full object-cover"
          style={isLocal && !isScreenShare ? { transform: 'scaleX(-1)' } : undefined}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-16 w-16 rounded-full object-cover ring-2 ring-white/10"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement)?.style.setProperty('display', 'flex') }}
            />
          ) : null}
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-xl font-semibold text-white"
            style={{ display: avatarUrl ? 'none' : 'flex' }}
          >
            {initial}
          </div>
        </div>
      )}

      {/* Bottom overlay: name + status */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5">
        <div className="flex items-center gap-1">
          {!isMicOn && !isScreenShare && (
            <MicrophoneSlash size={11} className="shrink-0 text-red-400" />
          )}
          <span className="truncate text-[11px] font-medium leading-none text-white">
            {isScreenShare ? `Экран: ${displayName}` : displayName}
            {isLocal && !isScreenShare && (
              <span className="ml-1 text-white/50">(вы)</span>
            )}
          </span>
        </div>
      </div>

      {/* Camera off badge (top-left) */}
      {!isCamOn && !isScreenShare && (
        <div className="absolute left-2 top-2">
          <CameraSlash size={13} className="text-white/40" />
        </div>
      )}

      {/* Hover controls (top-right) */}
      {hovered && (
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onPin() }}
            title={isPinned ? 'Открепить' : 'Закрепить'}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white transition-colors hover:bg-black/80"
          >
            {isPinned ? <PushPinSimpleSlash size={13} /> : <PushPin size={13} />}
          </button>

          {isHost && !isLocal && (
            <>
              {onMuteAudio && !isScreenShare && (
                <button
                  onClick={(e) => { e.stopPropagation(); onMuteAudio() }}
                  title="Заглушить микрофон"
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white transition-colors hover:bg-destructive"
                >
                  <MicrophoneSlash size={13} />
                </button>
              )}
              {onMuteScreenShare && isScreenShare && (
                <button
                  onClick={(e) => { e.stopPropagation(); onMuteScreenShare() }}
                  title="Остановить демонстрацию"
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-white transition-colors hover:bg-destructive"
                >
                  <CameraSlash size={13} />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
