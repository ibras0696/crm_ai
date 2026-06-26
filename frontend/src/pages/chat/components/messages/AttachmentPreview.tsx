import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { Pause, Play } from '@phosphor-icons/react'

import type { ChatAttachmentInfo } from '@/lib/api'

import {
  clamp01,
  formatClockSeconds,
  formatFileSize,
  inferMediaKind,
  normalizeAttachmentMimeForPlayback,
  type MediaPreviewState,
} from '../../chatHelpers'
import { useAttachmentDownloadUrl } from '../../hooks/useAttachmentDownloadUrl'

const ATTACHMENT_PRELOAD_ROOT_MARGIN = '240px'
const WAVEFORM_BARS = 40

function generateWaveformBars(seed: string, count: number): number[] {
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) + seed.charCodeAt(i)
    hash |= 0
  }
  return Array.from({ length: count }, (_, i) => {
    const x = Math.sin(hash * 9301 + i * 49297 + 233) * 0.5 + 0.5
    const envelope = 1 - Math.abs((i / count) - 0.5) * 0.4
    return Math.max(0.15, x * envelope)
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download'
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function forceDownloadAttachment(url: string, filename: string, contentType: string) {
  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Не удалось скачать вложение (${response.status})`)
  }
  const blob = await response.blob()
  const normalizedType = normalizeAttachmentMimeForPlayback(contentType) || blob.type || 'application/octet-stream'
  const finalBlob = blob.type === normalizedType ? blob : new Blob([blob], { type: normalizedType })
  downloadBlob(finalBlob, filename)
}

function runOnIdle(task: () => void) {
  if (typeof window === 'undefined') return
  const idle = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof idle.requestIdleCallback === 'function') {
    idle.requestIdleCallback(() => task(), { timeout: 200 })
    return
  }
  window.setTimeout(task, 16)
}

export function AttachmentPreview({
  chatId,
  attachment,
  onOpenMediaPreview,
  isMessageVisible,
  forceEagerLoad = false,
  telemetryEnabled = true,
}: {
  chatId: string
  attachment: ChatAttachmentInfo
  onOpenMediaPreview?: (preview: MediaPreviewState) => void
  isMessageVisible: boolean
  forceEagerLoad?: boolean
  telemetryEnabled?: boolean
}) {
  const [isElementVisible, setIsElementVisible] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const mediaKind = inferMediaKind(attachment.content_type, attachment.original_name)
  const playbackType = normalizeAttachmentMimeForPlayback(attachment.content_type)
  const autoLoadEnabled = forceEagerLoad || (isMessageVisible && isElementVisible && mediaKind !== 'file')

  const {
    downloadUrl,
    loading,
    errorText,
    setErrorText,
    ensureDownloadUrl,
  } = useAttachmentDownloadUrl({
    chatId,
    fileId: attachment.file_id,
    enabled: autoLoadEnabled,
    telemetryEnabled,
  })

  useEffect(() => {
    if (!isMessageVisible) {
      setIsElementVisible(false)
    }
  }, [isMessageVisible])

  useEffect(() => {
    const node = containerRef.current
    if (!node || !isMessageVisible) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setIsElementVisible(true)
        }
      },
      { root: null, rootMargin: ATTACHMENT_PRELOAD_ROOT_MARGIN, threshold: 0.01 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [isMessageVisible])

  useEffect(() => {
    setAudioFailed(false)
    setIsAudioPlaying(false)
    setAudioCurrentTime(0)
    setAudioDuration(0)
  }, [attachment.file_id])

  useEffect(() => {
    if (!downloadUrl || mediaKind === 'file') return
    runOnIdle(() => {
      if (mediaKind === 'image') {
        const image = new Image()
        image.decoding = 'async'
        image.src = downloadUrl
        return
      }
      if (mediaKind === 'video') {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.src = downloadUrl
      }
    })
  }, [downloadUrl, mediaKind])

  useEffect(() => {
    if (loading || errorText || mediaKind !== 'audio') return
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0
      setAudioDuration(duration)
    }
    const onTimeUpdate = () => {
      setAudioCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0)
    }
    const onEnded = () => {
      setIsAudioPlaying(false)
      setAudioCurrentTime(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    const onPause = () => setIsAudioPlaying(false)
    const onPlay = () => setIsAudioPlaying(true)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('play', onPlay)
    onLoadedMetadata()

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('play', onPlay)
    }
  }, [downloadUrl, errorText, loading, mediaKind])

  useEffect(() => {
    if (mediaKind !== 'audio' || audioFailed || !isAudioPlaying) return
    let frameId = 0
    const tick = () => {
      const audio = audioRef.current
      if (!audio) return
      const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      setAudioCurrentTime((prev) => (Math.abs(prev - nextTime) >= 0.03 ? nextTime : prev))
      frameId = window.requestAnimationFrame(tick)
    }
    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [audioFailed, isAudioPlaying, mediaKind])

  const resolveUrlForAction = async () => {
    if (downloadUrl) return downloadUrl
    return ensureDownloadUrl(false)
  }

  const toggleAudioPlayback = async () => {
    try {
      if (!downloadUrl) {
        await resolveUrlForAction()
      }
      const audio = audioRef.current
      if (!audio || audioFailed) return
      if (audio.paused) {
        await audio.play()
      } else {
        audio.pause()
      }
    } catch {
      setAudioFailed(true)
    }
  }

  const handleAudioSeek = (nextValue: number) => {
    const audio = audioRef.current
    if (!audio || audioFailed) return
    audio.currentTime = Math.max(0, nextValue)
    setAudioCurrentTime(Math.max(0, nextValue))
  }

  const audioProgressPercent = (() => {
    if (audioDuration <= 0) return 0
    return clamp01(audioCurrentTime / audioDuration) * 100
  })()

  const handleAudioTrackSeek = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const audio = audioRef.current
    if (!audio || audioFailed) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = clamp01((event.clientX - rect.left) / rect.width)
    const duration = Math.max(audioDuration, Number.isFinite(audio.duration) ? audio.duration : 0)
    if (duration <= 0) return
    handleAudioSeek(ratio * duration)
  }

  const handleFileDownload = async () => {
    if (isDownloadingFile) return
    setIsDownloadingFile(true)
    setErrorText('')
    try {
      const url = await resolveUrlForAction()
      await forceDownloadAttachment(url, attachment.original_name, attachment.content_type)
    } catch (error: unknown) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось скачать вложение')
    } finally {
      setIsDownloadingFile(false)
    }
  }

  const openMediaPreview = async (kind: 'image' | 'video') => {
    try {
      const url = await resolveUrlForAction()
      window.requestAnimationFrame(() => {
        onOpenMediaPreview?.({
          kind,
          url,
          originalName: attachment.original_name,
        })
      })
    } catch (error: unknown) {
      setErrorText(error instanceof Error ? error.message : 'Не удалось открыть вложение')
    }
  }

  if (!forceEagerLoad && !isElementVisible && !downloadUrl) {
    return (
      <div ref={containerRef} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Вложение готово к загрузке
      </div>
    )
  }

  if (loading && !downloadUrl) {
    return (
      <div ref={containerRef} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Загрузка вложения...
      </div>
    )
  }

  if (errorText && !downloadUrl) {
    return (
      <div ref={containerRef} className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {errorText}
      </div>
    )
  }

  if (mediaKind === 'image' && downloadUrl) {
    return (
      <div ref={containerRef}>
        <button
          type="button"
          className="block max-w-full"
          onClick={() => void openMediaPreview('image')}
        >
          <img
            src={downloadUrl}
            alt={attachment.original_name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            className="max-h-72 max-w-full rounded-lg border border-border/60 object-contain"
          />
        </button>
      </div>
    )
  }

  if (mediaKind === 'video' && downloadUrl) {
    return (
      <div ref={containerRef} className="max-w-full rounded-lg border border-border/60 bg-background/20 p-2">
        <video
          controls
          preload="metadata"
          src={downloadUrl}
          className="max-h-80 max-w-full rounded-md"
        >
          Ваш браузер не поддерживает видео.
        </video>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void openMediaPreview('video')}
            className="rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/20"
          >
            Открыть
          </button>
        </div>
      </div>
    )
  }

  if (mediaKind === 'audio') {
    return (
      <div ref={containerRef} className="max-w-full">
        <audio
          ref={audioRef}
          preload="metadata"
          className="hidden"
          onError={() => setAudioFailed(true)}
        >
          {downloadUrl && <source src={downloadUrl} type={playbackType || undefined} />}
          {downloadUrl && <source src={downloadUrl} />}
        </audio>
        {!audioFailed ? (
          <div className="flex w-full min-w-0 max-w-full items-center gap-2.5">
            {/* Circular play/pause */}
            <button
              type="button"
              onClick={() => void toggleAudioPlayback()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 active:scale-95"
              aria-label={isAudioPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              {isAudioPlaying
                ? <Pause size={18} weight="fill" />
                : <Play size={18} weight="fill" className="translate-x-px" />}
            </button>

            {/* Waveform + time */}
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={handleAudioTrackSeek}
                className="flex h-8 w-full cursor-pointer items-center gap-px"
                aria-label="Перемотать голосовое сообщение"
              >
                {generateWaveformBars(attachment.file_id, WAVEFORM_BARS).map((height, i) => {
                  const played = i / WAVEFORM_BARS < audioProgressPercent / 100
                  return (
                    <span
                      key={i}
                      className={`flex-1 rounded-full transition-colors ${played ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                      style={{ height: `${Math.round(height * 24)}px`, minHeight: '3px' }}
                    />
                  )
                })}
              </button>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{formatClockSeconds(audioCurrentTime)}</span>
                <span>{formatClockSeconds(audioDuration)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <span className="truncate text-xs text-muted-foreground">Не удалось воспроизвести</span>
            <button
              type="button"
              onClick={() => void handleFileDownload()}
              disabled={isDownloadingFile}
              className="shrink-0 text-xs text-primary hover:underline"
            >
              {isDownloadingFile ? 'Скачивание...' : 'Скачать'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      <button
        type="button"
        onClick={() => void handleFileDownload()}
        disabled={isDownloadingFile}
        className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-primary hover:bg-primary/5"
      >
        <span className="min-w-0 flex-1 truncate">{attachment.original_name}</span>
        <span className="shrink-0 text-muted-foreground">
          {isDownloadingFile ? 'Скачивание...' : formatFileSize(attachment.size)}
        </span>
      </button>
      {errorText && <div className="mt-1 text-[11px] text-destructive">{errorText}</div>}
    </div>
  )
}
