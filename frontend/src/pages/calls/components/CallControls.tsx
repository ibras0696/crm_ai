import { useState } from 'react'
import { useConnectionState, useLocalParticipant } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import {
  Microphone,
  MicrophoneSlash,
  Camera,
  CameraSlash,
  Monitor,
  Screencast,
  PhoneDisconnect,
  Users,
  ChatCircle,
  Record,
  DotsThree,
  UserPlus,
  X,
} from '@phosphor-icons/react'

interface Props {
  onLeave: () => void
  onToggleParticipants: () => void
  participantsOpen: boolean
  onToggleChat: () => void
  chatOpen: boolean
  onToggleRecording: () => void
  isRecording: boolean
  isHost: boolean
  recordingError?: string | null
  onInvite?: () => void
}

export function CallControls({
  onLeave,
  onToggleParticipants,
  participantsOpen,
  onToggleChat,
  chatOpen,
  onToggleRecording,
  isRecording,
  isHost,
  recordingError,
  onInvite,
}: Props) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant()
  const connectionState = useConnectionState()
  const [screenShareError, setScreenShareError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [micPending, setMicPending] = useState(false)
  const [cameraPending, setCameraPending] = useState(false)
  const [screenSharePending, setScreenSharePending] = useState(false)
  const controlsDisabled = connectionState !== ConnectionState.Connected

  const toggleMic = async () => {
    if (controlsDisabled || micPending) return
    setMicPending(true)
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch {
      // permission denied or device error
    } finally {
      setMicPending(false)
    }
  }

  const toggleCamera = async () => {
    if (controlsDisabled || cameraPending) return
    setCameraPending(true)
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled)
    } catch {
      // permission denied or device error
    } finally {
      setCameraPending(false)
    }
  }

  const toggleScreenShare = async () => {
    if (controlsDisabled || screenSharePending) return
    setScreenShareError(null)
    setScreenSharePending(true)
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const isCancelled =
        msg.includes('Permission denied') ||
        msg.includes('NotAllowedError') ||
        msg.includes('cancelled') ||
        msg.includes('canceled')
      if (!isCancelled) {
        setScreenShareError('Демонстрация экрана недоступна в этом браузере')
      }
    } finally {
      setScreenSharePending(false)
    }
  }

  const handleMoreAction = (fn: () => void | Promise<void>) => {
    void fn()
    setShowMore(false)
  }

  return (
    <div className="relative flex flex-col">
      {/* Error strip */}
      {(screenShareError || recordingError) && (
        <div className="py-1 text-center text-xs text-destructive bg-destructive/10">
          {screenShareError ?? recordingError}
        </div>
      )}

      {/* More menu — mobile only overlay above bar */}
      {showMore && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMore(false)}
          />
          <div className="absolute bottom-full left-0 right-0 z-20 mb-2 mx-2 rounded-2xl bg-black/90 backdrop-blur-sm border border-white/10 p-3 grid grid-cols-3 gap-2">
            {/* Screen share */}
            <button
              onClick={() => handleMoreAction(toggleScreenShare)}
              disabled={controlsDisabled || screenSharePending}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl transition-colors disabled:cursor-wait disabled:opacity-60 ${
                isScreenShareEnabled
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {isScreenShareEnabled ? <Screencast size={20} weight="fill" /> : <Monitor size={20} />}
              <span className="text-[10px] font-medium">{screenSharePending ? '...' : 'Экран'}</span>
            </button>

            {/* Chat */}
            <button
              onClick={() => handleMoreAction(onToggleChat)}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl transition-colors ${
                chatOpen ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <ChatCircle size={20} />
              <span className="text-[10px] font-medium">Чат</span>
            </button>

            {/* Participants */}
            <button
              onClick={() => handleMoreAction(onToggleParticipants)}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl transition-colors ${
                participantsOpen ? 'bg-primary text-primary-foreground' : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <Users size={20} />
              <span className="text-[10px] font-medium">Участники</span>
            </button>

            {/* Invite */}
            {onInvite && (
              <button
                onClick={() => handleMoreAction(onInvite)}
                className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                <UserPlus size={20} />
                <span className="text-[10px] font-medium">Пригласить</span>
              </button>
            )}

            {/* Recording — host only */}
            {isHost && (
              <button
                onClick={() => handleMoreAction(onToggleRecording)}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl transition-colors ${
                  isRecording
                    ? 'bg-destructive text-white animate-pulse'
                    : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <Record size={20} weight={isRecording ? 'fill' : 'regular'} />
                <span className="text-[10px] font-medium">Запись</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* ─── Control bar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-center gap-2 px-3 py-3 bg-black/80 backdrop-blur-sm border-t border-white/10 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">

        {/* Mic — always visible */}
        <button
          onClick={toggleMic}
          disabled={controlsDisabled || micPending}
          title={isMicrophoneEnabled ? 'Выключить микрофон' : 'Включить микрофон'}
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors disabled:cursor-wait disabled:opacity-60 ${
            isMicrophoneEnabled
              ? 'bg-white/10 hover:bg-white/20 text-white'
              : 'bg-destructive hover:bg-destructive/90 text-white'
          }`}
        >
          {isMicrophoneEnabled ? <Microphone size={20} weight="fill" /> : <MicrophoneSlash size={20} weight="fill" />}
          <span className="text-[10px] font-medium">{micPending ? '...' : isMicrophoneEnabled ? 'Микро' : 'Выкл'}</span>
        </button>

        {/* Camera — always visible */}
        <button
          onClick={toggleCamera}
          disabled={controlsDisabled || cameraPending}
          title={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}
          className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors disabled:cursor-wait disabled:opacity-60 ${
            isCameraEnabled
              ? 'bg-white/10 hover:bg-white/20 text-white'
              : 'bg-destructive hover:bg-destructive/90 text-white'
          }`}
        >
          {isCameraEnabled ? <Camera size={20} weight="fill" /> : <CameraSlash size={20} weight="fill" />}
          <span className="text-[10px] font-medium">{cameraPending ? '...' : isCameraEnabled ? 'Камера' : 'Выкл'}</span>
        </button>

        {/* ── Desktop-only buttons ──────────────────────────── */}
        <button
          onClick={toggleScreenShare}
          disabled={controlsDisabled || screenSharePending}
          title={isScreenShareEnabled ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
          className={`hidden md:flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors disabled:cursor-wait disabled:opacity-60 ${
            isScreenShareEnabled
              ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          {isScreenShareEnabled ? <Screencast size={20} weight="fill" /> : <Monitor size={20} />}
          <span className="text-[10px] font-medium">{screenSharePending ? '...' : 'Экран'}</span>
        </button>

        {isHost && (
          <button
            onClick={onToggleRecording}
            title={isRecording ? 'Остановить запись' : 'Начать запись'}
            className={`hidden md:flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${
              isRecording
                ? 'bg-destructive hover:bg-destructive/90 text-white animate-pulse'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
          >
            <Record size={20} weight={isRecording ? 'fill' : 'regular'} />
            <span className="text-[10px] font-medium">Запись</span>
          </button>
        )}

        <button
          onClick={onToggleChat}
          title="Чат звонка"
          className={`hidden md:flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${
            chatOpen
              ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          <ChatCircle size={20} />
          <span className="text-[10px] font-medium">Чат</span>
        </button>

        <button
          onClick={onToggleParticipants}
          title="Участники"
          className={`hidden md:flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${
            participantsOpen
              ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
              : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          <Users size={20} />
          <span className="text-[10px] font-medium">Участники</span>
        </button>

        {onInvite && (
          <button
            onClick={onInvite}
            title="Пригласить участника"
            className="hidden md:flex flex-col items-center gap-1 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <UserPlus size={20} />
            <span className="text-[10px] font-medium">Пригласить</span>
          </button>
        )}

        {/* ── More button — mobile only ─────────────────────── */}
        <button
          onClick={() => setShowMore((v) => !v)}
          className={`flex md:hidden flex-col items-center gap-1 px-3 py-2 rounded-xl transition-colors ${
            showMore ? 'bg-white/20 text-white' : 'bg-white/10 hover:bg-white/20 text-white'
          }`}
        >
          {showMore ? <X size={20} /> : <DotsThree size={20} weight="bold" />}
          <span className="text-[10px] font-medium">Ещё</span>
        </button>

        {/* End call — always visible, right-most */}
        <button
          onClick={onLeave}
          title="Завершить звонок"
          className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl bg-destructive hover:bg-destructive/90 text-white transition-colors ml-2 md:ml-4"
        >
          <PhoneDisconnect size={20} weight="fill" />
          <span className="text-[10px] font-medium">Завершить</span>
        </button>
      </div>
    </div>
  )
}
