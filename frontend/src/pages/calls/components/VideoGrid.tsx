import { useState } from 'react'
import { useTracks, useSpeakingParticipants } from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { X, Users } from '@phosphor-icons/react'
import { VideoTile } from './VideoTile'

interface Props {
  isHost: boolean
  onMuteParticipantAudio?: (identity: string) => void
  onMuteParticipantScreenShare?: (identity: string) => void
}

function gridColsClass(count: number): string {
  if (count === 1) return 'grid-cols-1'
  if (count <= 4) return 'grid-cols-2'
  if (count <= 9) return 'grid-cols-3'
  return 'grid-cols-4'
}

const trackKey = (t: TrackReferenceOrPlaceholder) =>
  `${t.participant.identity}:${t.source}`

export function VideoGrid({ isHost, onMuteParticipantAudio, onMuteParticipantScreenShare }: Props) {
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  const speakingParticipants = useSpeakingParticipants()
  const speakingIds = new Set(speakingParticipants.map((p) => p.identity))

  // Resolve effective pin:
  // 1. User's explicit pin (if that track still exists in the room)
  // 2. Auto-spotlight the active screen share
  // 3. null → equal grid mode
  const screenShareTrack = allTracks.find((t) => t.source === Track.Source.ScreenShare)
  const resolvedPinnedId: string | null = (() => {
    if (pinnedId && allTracks.some((t) => trackKey(t) === pinnedId)) return pinnedId
    if (screenShareTrack) return trackKey(screenShareTrack)
    return null
  })()

  const handlePin = (key: string) => {
    setPinnedId((prev) => {
      if (prev === key) return null   // toggle off
      setSidebarOpen(true)
      return key
    })
  }

  // ── Pinned / spotlight mode ─────────────────────────────────────────────
  if (resolvedPinnedId) {
    const pinnedTrack = allTracks.find((t) => trackKey(t) === resolvedPinnedId) ?? allTracks[0]
    const otherTracks = allTracks.filter((t) => trackKey(t) !== resolvedPinnedId)

    return (
      <div className="flex h-full gap-1 p-1">
        {/* Main featured tile */}
        <div className="min-w-0 flex-1">
          {pinnedTrack && (
            <VideoTile
              trackRef={pinnedTrack}
              isPinned={resolvedPinnedId === pinnedId}
              isSpeaking={speakingIds.has(pinnedTrack.participant.identity)}
              onPin={() => handlePin(trackKey(pinnedTrack))}
              isHost={isHost}
              onMuteAudio={
                onMuteParticipantAudio
                  ? () => onMuteParticipantAudio(pinnedTrack.participant.identity)
                  : undefined
              }
              onMuteScreenShare={
                onMuteParticipantScreenShare
                  ? () => onMuteParticipantScreenShare(pinnedTrack.participant.identity)
                  : undefined
              }
              className="h-full"
            />
          )}
        </div>

        {/* Right sidebar strip of thumbnails */}
        {sidebarOpen && otherTracks.length > 0 && (
          <div className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto">
            <button
              onClick={() => setSidebarOpen(false)}
              title="Скрыть панель"
              className="flex h-6 shrink-0 items-center justify-end pr-0.5 text-white/40 transition-colors hover:text-white/70"
            >
              <X size={14} />
            </button>
            {otherTracks.map((track) => (
              <div key={trackKey(track)} className="aspect-video shrink-0">
                <VideoTile
                  trackRef={track}
                  isPinned={false}
                  isSpeaking={speakingIds.has(track.participant.identity)}
                  onPin={() => handlePin(trackKey(track))}
                  isHost={isHost}
                  onMuteAudio={
                    onMuteParticipantAudio
                      ? () => onMuteParticipantAudio(track.participant.identity)
                      : undefined
                  }
                  onMuteScreenShare={
                    onMuteParticipantScreenShare
                      ? () => onMuteParticipantScreenShare(track.participant.identity)
                      : undefined
                  }
                  className="h-full w-full"
                />
              </div>
            ))}
          </div>
        )}

        {/* Collapsed sidebar toggle */}
        {!sidebarOpen && otherTracks.length > 0 && (
          <button
            onClick={() => setSidebarOpen(true)}
            title="Показать участников"
            className="flex w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <Users size={16} />
          </button>
        )}
      </div>
    )
  }

  // ── Equal grid mode ─────────────────────────────────────────────────────
  return (
    <div className={`grid h-full gap-1 p-1 ${gridColsClass(allTracks.length)}`}>
      {allTracks.map((track) => (
        <VideoTile
          key={trackKey(track)}
          trackRef={track}
          isPinned={false}
          isSpeaking={speakingIds.has(track.participant.identity)}
          onPin={() => handlePin(trackKey(track))}
          isHost={isHost}
          onMuteAudio={
            onMuteParticipantAudio
              ? () => onMuteParticipantAudio(track.participant.identity)
              : undefined
          }
          onMuteScreenShare={
            onMuteParticipantScreenShare
              ? () => onMuteParticipantScreenShare(track.participant.identity)
              : undefined
          }
        />
      ))}
    </div>
  )
}
