import { useEffect, useRef, useState } from 'react'
import { createLocalVideoTrack } from 'livekit-client'
import type { LocalVideoTrack } from 'livekit-client'
import { Microphone, MicrophoneSlash, Camera, CameraSlash, ArrowRight, Drop, X } from '@phosphor-icons/react'
import type { RoomOut } from '../../../lib/api/calls'

interface Props {
  slug: string
  room: RoomOut | null
  onJoin: () => void
  onCancel: () => void
}

export function PreCallLobby({ room, onJoin, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [videoTrack, setVideoTrack] = useState<LocalVideoTrack | null>(null)
  const [blurEnabled, setBlurEnabled] = useState(false)

  useEffect(() => {
    let track: LocalVideoTrack | null = null

    if (camOn) {
      createLocalVideoTrack({ resolution: { width: 1280, height: 720 } })
        .then((t: LocalVideoTrack) => {
          track = t
          setVideoTrack(t)
          if (videoRef.current) t.attach(videoRef.current)
        })
        .catch(() => setCamOn(false))
    }

    return () => {
      void track?.stopProcessor()
      track?.stop()
      setVideoTrack(null)
    }
  }, [camOn])

  useEffect(() => {
    if (!videoTrack) return
    if (blurEnabled) {
      import('@livekit/track-processors').then(({ BackgroundProcessor }) => {
        const processor = BackgroundProcessor({ mode: 'background-blur', blurRadius: 10 })
        void videoTrack.setProcessor(processor)
      }).catch(() => setBlurEnabled(false))
    } else {
      void videoTrack.stopProcessor()
    }
  }, [blurEnabled, videoTrack])

  const handleToggleCam = () => {
    if (camOn && videoTrack) {
      videoTrack.stop()
      setVideoTrack(null)
    }
    setCamOn((v) => !v)
  }

  return (
    // fixed overlay — escapes AppLayout on all screen sizes
    <div className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col items-center justify-center p-4 gap-5">
      {/* Close */}
      <button
        onClick={onCancel}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        aria-label="Отмена"
      >
        <X size={18} />
      </button>

      {/* Title */}
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">{room?.title ?? 'Созвон'}</h2>
        <p className="text-white/40 text-sm mt-0.5">Проверьте камеру и микрофон</p>
      </div>

      {/* Camera preview */}
      <div className="relative w-full max-w-sm aspect-video bg-white/5 rounded-2xl overflow-hidden">
        {camOn ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover [transform:scaleX(-1)]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <CameraSlash size={40} className="text-white/20" />
          </div>
        )}

        {/* Mic/cam status pills inside preview */}
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
          {!micOn && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/60 rounded-full">
              <MicrophoneSlash size={12} className="text-red-400" />
              <span className="text-[10px] text-white/70">Микрофон выкл</span>
            </div>
          )}
          {!camOn && (
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/60 rounded-full">
              <CameraSlash size={12} className="text-red-400" />
              <span className="text-[10px] text-white/70">Камера выкл</span>
            </div>
          )}
        </div>
      </div>

      {/* Toggle controls */}
      <div className="flex gap-3">
        {/* Mic */}
        <button
          onClick={() => setMicOn((v) => !v)}
          className={`flex flex-col items-center gap-1.5 w-14 h-14 rounded-2xl justify-center transition-colors ${
            micOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-destructive/90 hover:bg-destructive text-white'
          }`}
          aria-label={micOn ? 'Выключить микрофон' : 'Включить микрофон'}
        >
          {micOn ? <Microphone size={22} weight="fill" /> : <MicrophoneSlash size={22} weight="fill" />}
        </button>

        {/* Camera */}
        <button
          onClick={handleToggleCam}
          className={`flex flex-col items-center gap-1.5 w-14 h-14 rounded-2xl justify-center transition-colors ${
            camOn ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-destructive/90 hover:bg-destructive text-white'
          }`}
          aria-label={camOn ? 'Выключить камеру' : 'Включить камеру'}
        >
          {camOn ? <Camera size={22} weight="fill" /> : <CameraSlash size={22} weight="fill" />}
        </button>

        {/* Blur */}
        <button
          onClick={() => setBlurEnabled((v) => !v)}
          disabled={!camOn}
          className={`flex flex-col items-center gap-1.5 w-14 h-14 rounded-2xl justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            blurEnabled ? 'bg-primary/90 hover:bg-primary text-primary-foreground' : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
          aria-label={blurEnabled ? 'Выключить размытие' : 'Включить размытие фона'}
        >
          <Drop size={22} weight={blurEnabled ? 'fill' : 'regular'} />
        </button>
      </div>

      {/* Join button */}
      <button
        onClick={onJoin}
        className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl font-medium transition-colors text-sm"
      >
        Войти в созвон
        <ArrowRight size={16} weight="bold" />
      </button>
    </div>
  )
}
