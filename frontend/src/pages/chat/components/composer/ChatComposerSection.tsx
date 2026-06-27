import { useRef, useState, useEffect } from 'react'
import {
  Camera,
  FilePlus,
  Image,
  Lock,
  Microphone,
  PaperclipHorizontal,
  PaperPlaneTilt,
  Plus,
  SpinnerGap,
  Trash,
  VideoCamera,
  X,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'

import {
  MESSAGE_MAX_CHARS,
  formatDurationLabel,
  formatFileSize,
  getMessageAttachments,
  isVoiceAttachment,
  scanSensitiveText,
} from '../../chatHelpers'

const LOCK_Y = 55   // px upward to lock recording
const CANCEL_X = 65 // px leftward to cancel recording
const RECORD_BARS = 28

export function ChatComposerSection(props: Record<string, unknown>) {
  const {
    replyToMessage,
    getMessageOwnerLabel,
    setReplyToMessageId,
    composerAttachments,
    handleRemoveComposerAttachment,
    isRecordingVoice,
    voiceRecordingElapsedMs,
    mediaAttachmentInputRef,
    handleMediaInputChange,
    cameraPhotoAttachmentInputRef,
    handleCameraPhotoInputChange,
    cameraVideoAttachmentInputRef,
    handleCameraVideoInputChange,
    fileAttachmentInputRef,
    handleFileInputChange,
    attachMenuRef,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    selectedChatId,
    sending,
    hasUploadingAttachments,
    openMediaPicker,
    openCameraPhotoPicker,
    openCameraVideoPicker,
    openFilePicker,
    composerRef,
    draft,
    setDraft,
    touchTypingActivity,
    stopTyping,
    handleComposerPaste,
    readyComposerAttachments,
    selectedChat,
    canSendMessage,
    handleSend,
    startVoiceRecording,
    stopVoiceRecording,
    voiceStreamRef,
  } = props as any

  // ── Telegram-style hold/lock recording ────────────────────────────────────
  const [micState, setMicState] = useState<'idle' | 'holding' | 'locked'>('idle')
  const [lockProgress, setLockProgress] = useState(0) // 0–1 as user slides up
  const holdStartRef = useRef<{ x: number; y: number } | null>(null)
  const pendingActionRef = useRef<false | 'send' | 'cancel'>(false)

  // Real-time audio levels for waveform (updated via AnalyserNode)
  const [recordBars, setRecordBars] = useState<number[]>(() =>
    Array.from({ length: RECORD_BARS }, () => 0.15),
  )
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)

  // Wire up AnalyserNode to the hook's live mic stream
  useEffect(() => {
    if (!isRecordingVoice) {
      cancelAnimationFrame(animFrameRef.current)
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      analyserRef.current = null
      setRecordBars(Array.from({ length: RECORD_BARS }, () => 0.15))
      return
    }
    const stream = (voiceStreamRef as React.MutableRefObject<MediaStream | null>)?.current
    if (!stream) return

    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.6
    ctx.createMediaStreamSource(stream).connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser

    const data = new Uint8Array(analyser.frequencyBinCount)
    let running = true
    const tick = () => {
      if (!running) return
      analyser.getByteTimeDomainData(data)
      const chunk = Math.max(1, Math.floor(data.length / RECORD_BARS))
      const bars = Array.from({ length: RECORD_BARS }, (_, i) => {
        let sum = 0
        for (let j = i * chunk; j < Math.min((i + 1) * chunk, data.length); j++) {
          sum += Math.abs((data[j] ?? 128) - 128)
        }
        return Math.max(0.08, Math.min(1, (sum / chunk / 128) * 8))
      })
      setRecordBars(bars)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(animFrameRef.current)
      ctx.close().catch(() => {})
    }
  }, [isRecordingVoice, voiceStreamRef])

  // Handle pending action once recording actually starts
  useEffect(() => {
    if (!isRecordingVoice || !pendingActionRef.current) return
    const action = pendingActionRef.current
    pendingActionRef.current = false
    stopVoiceRecording(action === 'send')
    setMicState('idle')
    setLockProgress(0)
  }, [isRecordingVoice, stopVoiceRecording])

  // If recording stops externally (e.g. 1-min timeout), reset lock state
  useEffect(() => {
    if (!isRecordingVoice && micState === 'locked') {
      setMicState('idle')
      setLockProgress(0)
    }
  }, [isRecordingVoice, micState])

  const handleMicPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    holdStartRef.current = { x: e.clientX, y: e.clientY }
    setMicState('holding')
    setLockProgress(0)
    void startVoiceRecording()
  }

  const handleMicPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (micState !== 'holding' || !holdStartRef.current) return
    const dx = holdStartRef.current.x - e.clientX  // positive = moved left
    const dy = holdStartRef.current.y - e.clientY  // positive = moved up

    const progress = Math.min(1, Math.max(0, dy / LOCK_Y))
    setLockProgress(progress)

    if (dy >= LOCK_Y) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      holdStartRef.current = null
      setMicState('locked')
      setLockProgress(1)
    } else if (dx >= CANCEL_X) {
      e.currentTarget.releasePointerCapture(e.pointerId)
      holdStartRef.current = null
      if (isRecordingVoice) {
        stopVoiceRecording(false)
      } else {
        pendingActionRef.current = 'cancel'
      }
      setMicState('idle')
      setLockProgress(0)
    }
  }

  const handleMicPointerUp = () => {
    if (micState !== 'holding') return
    holdStartRef.current = null
    if (isRecordingVoice) {
      stopVoiceRecording(true)
    } else {
      pendingActionRef.current = 'send'
    }
    setMicState('idle')
    setLockProgress(0)
  }

  const handleLockedSend = () => {
    stopVoiceRecording(true)
    setMicState('idle')
    setLockProgress(0)
  }

  const handleLockedCancel = () => {
    stopVoiceRecording(false)
    setMicState('idle')
    setLockProgress(0)
  }

  const micDisabled = !selectedChatId || sending || composerAttachments.length >= 1 || hasUploadingAttachments

  return (
    <div className="sticky bottom-0 border-t border-border/60 bg-background/92 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3.25rem)] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4 md:pb-3">

      {replyToMessage && (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
          <div className="truncate">
            Ответ на: <span className="text-muted-foreground">{getMessageOwnerLabel(replyToMessage)}</span> ·{' '}
            {scanSensitiveText(replyToMessage.body.trim()).maskedText || (getMessageAttachments(replyToMessage).length > 0 ? 'Вложение' : '')}
          </div>
          <button type="button" onClick={() => setReplyToMessageId(null)} className="ml-2 rounded px-1 hover:bg-muted/50">
            ×
          </button>
        </div>
      )}

      {composerAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {composerAttachments.map((attachment: any) => {
            const isUploading = attachment.status === 'uploading'
            const isReady = attachment.status === 'ready'
            const isError = attachment.status === 'error'
            const isVoice = isVoiceAttachment(attachment.contentType)
            return (
              <div
                key={attachment.clientId}
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                  isReady
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                    : isError
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-primary/30 bg-primary/10 text-primary'
                }`}
              >
                {isUploading ? <SpinnerGap size={14} className="animate-spin" /> : <PaperclipHorizontal size={14} />}
                <div className="min-w-0">
                  <div className="max-w-[220px] truncate">
                    {isVoice ? 'Голосовое сообщение' : attachment.originalName}
                  </div>
                  <div className="text-[10px] opacity-80">
                    {isUploading
                      ? 'Загрузка...'
                      : isReady
                        ? isVoice
                          ? `${formatDurationLabel(attachment.durationMs || 0)} · ${formatFileSize(attachment.size)}`
                          : formatFileSize(attachment.size)
                        : attachment.error || 'Ошибка'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveComposerAttachment(attachment.clientId)}
                  className="ml-1 rounded-full p-0.5 hover:bg-black/10"
                  aria-label={`Удалить вложение ${attachment.originalName}`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <input ref={mediaAttachmentInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => void handleMediaInputChange(e)} />
      <input ref={cameraPhotoAttachmentInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void handleCameraPhotoInputChange(e)} />
      <input ref={cameraVideoAttachmentInputRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => void handleCameraVideoInputChange(e)} />
      <input ref={fileAttachmentInputRef} type="file" className="hidden" onChange={(e) => void handleFileInputChange(e)} />

      {/* ── LOCKED RECORDING BAR (Telegram style) ── */}
      {micState === 'locked' ? (
        <div className="flex items-center gap-3 rounded-3xl border border-border/70 bg-background/95 px-4 py-2.5 shadow-sm">
          {/* Cancel */}
          <button
            type="button"
            onClick={handleLockedCancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-destructive transition-colors"
          >
            <Trash size={17} />
          </button>

          {/* Animated waveform + timer */}
          <div className="flex flex-1 items-center gap-2.5 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />
            <div className="flex flex-1 items-end gap-[2px] h-7 overflow-hidden">
              {recordBars.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-full bg-primary/80 transition-all"
                  style={{
                    height: `${Math.max(3, Math.round(h * 24))}px`,
                    transitionDuration: '80ms',
                  }}
                />
              ))}
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
              {formatDurationLabel(voiceRecordingElapsedMs)}
            </span>
          </div>

          {/* Send */}
          <button
            type="button"
            onClick={handleLockedSend}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:scale-95 transition-all"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </button>
        </div>
      ) : (
        /* ── NORMAL COMPOSER ── */
        <div className="relative flex items-end gap-2 rounded-3xl border border-border/70 bg-background/95 p-2 shadow-sm" ref={attachMenuRef}>
          {/* Attach button */}
          <div className="relative shrink-0">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-full border border-border/70 bg-background/80"
              onClick={() => setIsAttachMenuOpen((prev: boolean) => !prev)}
              disabled={!selectedChatId || sending || isRecordingVoice || micState === 'holding' || composerAttachments.length >= 1 || hasUploadingAttachments}
              aria-label="Открыть меню вложений"
              title="Вложения"
            >
              <Plus size={20} />
            </Button>
            {isAttachMenuOpen && (
              <div className="absolute bottom-12 left-0 z-40 w-[min(280px,calc(100vw-4rem))] rounded-xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur">
                <div className="grid grid-cols-2 gap-1.5">
                  <button type="button" className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30" onClick={openMediaPicker}>
                    <Image size={16} /> Фото/Видео
                  </button>
                  <button type="button" className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30" onClick={openCameraPhotoPicker}>
                    <Camera size={16} /> Камера
                  </button>
                  <button type="button" className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30" onClick={openCameraVideoPicker}>
                    <VideoCamera size={16} /> Видео
                  </button>
                  <button type="button" className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30" onClick={openFilePicker}>
                    <FilePlus size={16} /> Файл
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Text area — hidden while holding mic */}
          {micState === 'holding' ? (
            <div className="flex flex-1 items-center gap-2.5 px-2 min-w-0">
              {/* Slide-left-to-cancel hint */}
              <div className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground select-none">
                <X size={12} className="shrink-0 opacity-60" />
                <span className="truncate opacity-70">← Отмена</span>
              </div>
              {/* Lock icon that rises as user slides up */}
              <div className="relative flex shrink-0 flex-col items-center">
                <Lock
                  size={14}
                  weight={lockProgress > 0.5 ? 'fill' : 'regular'}
                  className="transition-colors text-primary"
                  style={{ opacity: 0.4 + lockProgress * 0.6 }}
                />
                {lockProgress > 0.15 && (
                  <span className="mt-0.5 text-[9px] text-primary/70 font-medium">
                    {Math.round(lockProgress * 100)}%
                  </span>
                )}
              </div>
            </div>
          ) : (
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                touchTypingActivity()
              }}
              maxLength={MESSAGE_MAX_CHARS}
              rows={1}
              placeholder={selectedChat ? 'Напишите сообщение...' : 'Выберите чат'}
              disabled={!selectedChat || sending || isRecordingVoice}
              className="max-h-40 min-h-[40px] flex-1 resize-none rounded-2xl border border-transparent bg-transparent px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onBlur={() => stopTyping()}
              onPaste={handleComposerPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && (draft.trim().length > 0 || readyComposerAttachments.length > 0)) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
            />
          )}

          {/* Right action button */}
          {canSendMessage && micState === 'idle' ? (
            <Button
              type="button"
              size="icon"
              className="h-10 w-10 rounded-full bg-primary shadow-sm hover:bg-primary/90 shrink-0"
              onClick={() => void handleSend()}
              disabled={sending || draft.trim().length > MESSAGE_MAX_CHARS || hasUploadingAttachments}
              aria-label="Отправить сообщение"
              title="Отправить"
            >
              <PaperPlaneTilt size={16} weight="fill" />
            </Button>
          ) : (
            /* Mic button — hold to record, slide up to lock, slide left to cancel */
            <div className="relative shrink-0">
              {/* Lock progress indicator above mic button */}
              {micState === 'holding' && lockProgress > 0.05 && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 flex flex-col items-center gap-1 pointer-events-none"
                  style={{ opacity: lockProgress }}
                >
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/15 border border-primary/30">
                    <Lock size={14} weight="fill" className="text-primary" />
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={micDisabled}
                onPointerDown={handleMicPointerDown}
                onPointerMove={handleMicPointerMove}
                onPointerUp={handleMicPointerUp}
                onPointerCancel={() => {
                  if (micState === 'holding') {
                    holdStartRef.current = null
                    if (isRecordingVoice) stopVoiceRecording(false)
                    else pendingActionRef.current = 'cancel'
                    setMicState('idle')
                    setLockProgress(0)
                  }
                }}
                className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all select-none touch-none ${
                  micState === 'holding'
                    ? 'border-primary/40 bg-primary/15 scale-110 shadow-lg shadow-primary/20'
                    : isRecordingVoice
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-border/70 bg-background/80 hover:bg-muted/40'
                } disabled:opacity-40`}
                aria-label={micState !== 'idle' ? 'Запись...' : 'Записать голосовое'}
                title={micState === 'idle' ? 'Удержите для записи' : undefined}
              >
                <Microphone
                  size={16}
                  weight={micState === 'holding' ? 'fill' : 'regular'}
                  className={micState === 'holding' ? 'text-primary' : isRecordingVoice ? 'text-red-500' : ''}
                />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hint text while holding */}
      {micState === 'holding' && (
        <p className="mt-1 text-center text-[10px] text-muted-foreground select-none pointer-events-none">
          Отпустите — отправить · Вверх — зафиксировать · Влево — отмена
        </p>
      )}
    </div>
  )
}
