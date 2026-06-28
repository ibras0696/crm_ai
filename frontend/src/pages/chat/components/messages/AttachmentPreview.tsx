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
import { resolveCachedMediaObjectUrl, revokeCachedMediaObjectUrl } from '../../chatMediaCache'
import { useAttachmentDownloadUrl } from '../../hooks/useAttachmentDownloadUrl'

const ATTACHMENT_PRELOAD_ROOT_MARGIN = '240px'
const WAVEFORM_BARS = 32

function buildAttachmentPreviewUrl(chatId: string, fileId: string): string {
  return `/api/v1/chat/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(fileId)}/preview`
}

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
  hintDurationMs,
  isOutgoing = false,
}: {
  chatId: string
  attachment: ChatAttachmentInfo
  onOpenMediaPreview?: (preview: MediaPreviewState) => void
  isMessageVisible: boolean
  forceEagerLoad?: boolean
  telemetryEnabled?: boolean
  hintDurationMs?: number
  isOutgoing?: boolean
}) {
  const [isElementVisible, setIsElementVisible] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)
  const [cachedMediaUrl, setCachedMediaUrl] = useState('')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cachedMediaUrlRef = useRef('')

  const mediaKind = inferMediaKind(attachment.content_type, attachment.original_name)
  const playbackType = normalizeAttachmentMimeForPlayback(attachment.content_type)
  const previewUrl = mediaKind === 'image' ? buildAttachmentPreviewUrl(chatId, attachment.file_id) : ''
  const autoLoadEnabled = false

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
  const renderMediaUrl = cachedMediaUrl || downloadUrl

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
    cachedMediaUrlRef.current = cachedMediaUrl
  }, [cachedMediaUrl])

  useEffect(() => () => {
    if (cachedMediaUrlRef.current) {
      revokeCachedMediaObjectUrl(cachedMediaUrlRef.current)
    }
  }, [])

  useEffect(() => {
    setCachedMediaUrl((previousUrl) => {
      if (previousUrl) revokeCachedMediaObjectUrl(previousUrl)
      return ''
    })
  }, [attachment.file_id])

  useEffect(() => {
    if (!downloadUrl || mediaKind !== 'video') return
    let cancelled = false
    void resolveCachedMediaObjectUrl({
      cacheId: `${chatId}:${attachment.file_id}`,
      fileId: attachment.file_id,
      sourceUrl: downloadUrl,
      contentType: playbackType || attachment.content_type,
      sizeBytes: attachment.size,
    }).then((objectUrl) => {
      if (!objectUrl || cancelled) {
        if (objectUrl) revokeCachedMediaObjectUrl(objectUrl)
        return
      }
      setCachedMediaUrl((previousUrl) => {
        if (previousUrl && previousUrl !== objectUrl) revokeCachedMediaObjectUrl(previousUrl)
        return objectUrl
      })
    })
    return () => {
      cancelled = true
    }
  }, [attachment.content_type, attachment.file_id, attachment.size, chatId, downloadUrl, mediaKind, playbackType])

  useEffect(() => {
    if (!previewUrl || mediaKind !== 'image') return
    runOnIdle(() => {
      const image = new Image()
      image.decoding = 'async'
      image.src = previewUrl
    })
  }, [previewUrl, mediaKind])

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

  const resolveMediaPreviewUrlForAction = async () => {
    if (mediaKind === 'image' && previewUrl) return previewUrl
    if (cachedMediaUrl) return cachedMediaUrl
    const url = await resolveUrlForAction()
    if (mediaKind !== 'image' && mediaKind !== 'video') return url

    const objectUrl = await resolveCachedMediaObjectUrl({
      cacheId: `${chatId}:${attachment.file_id}`,
      fileId: attachment.file_id,
      sourceUrl: url,
      contentType: playbackType || attachment.content_type,
      sizeBytes: attachment.size,
    })
    if (!objectUrl) return url

    setCachedMediaUrl((previousUrl) => {
      if (previousUrl && previousUrl !== objectUrl) revokeCachedMediaObjectUrl(previousUrl)
      return objectUrl
    })
    return objectUrl
  }

  const toggleAudioPlayback = async () => {
    try {
      const url = downloadUrl || await resolveUrlForAction()
      const audio = audioRef.current
      if (!audio || audioFailed) return
      if (audio.src !== url) {
        audio.src = url
        audio.load()
      }
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

  // WebM/Opus recordings often have NaN duration in metadata — use server hint as fallback
  const effectiveDuration = audioDuration > 0 ? audioDuration : (hintDurationMs ?? 0) / 1000

  const audioProgressPercent = (() => {
    if (effectiveDuration <= 0) return 0
    return clamp01(audioCurrentTime / effectiveDuration) * 100
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
      const url = await resolveMediaPreviewUrlForAction()
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

  if (mediaKind === 'image' && !forceEagerLoad && !isElementVisible) {
    return (
      <div ref={containerRef} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Вложение готово к загрузке
      </div>
    )
  }

  if (loading && !downloadUrl && mediaKind !== 'audio') {
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

  if (mediaKind === 'image' && previewUrl) {
    return (
      <div ref={containerRef}>
        <button
          type="button"
          className="block max-w-full"
          onClick={() => void openMediaPreview('image')}
        >
          <img
            src={previewUrl}
            alt={attachment.original_name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onError={() => setErrorText('Не удалось загрузить preview')}
            className="max-h-72 max-w-full rounded-lg border border-border/60 object-contain"
          />
        </button>
        {errorText && <div className="mt-1 text-[11px] text-destructive">{errorText}</div>}
      </div>
    )
  }

  if (mediaKind === 'video' && renderMediaUrl) {
    return (
      <div ref={containerRef} className="max-w-full rounded-lg border border-border/60 bg-background/20 p-2">
        <video
          controls
          preload="metadata"
          src={renderMediaUrl}
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

  if (mediaKind === 'video') {
    return (
      <div ref={containerRef} className="max-w-full rounded-lg border border-border/60 bg-background/20 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void openMediaPreview('video')}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 ${
              isOutgoing
                ? 'bg-white/25 text-white hover:bg-white/35'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
            aria-label="Открыть видео"
          >
            <Play size={18} weight="fill" className="translate-x-px" />
          </button>
          <div className="min-w-0 flex-1">
            <div className={`truncate text-xs font-medium ${isOutgoing ? 'text-white' : 'text-foreground'}`}>
              {attachment.original_name}
            </div>
            <div className={`text-[11px] ${isOutgoing ? 'text-white/65' : 'text-muted-foreground'}`}>
              Видео · {formatFileSize(attachment.size)}
            </div>
          </div>
        </div>
        {errorText && <div className="mt-2 text-[11px] text-destructive">{errorText}</div>}
      </div>
    )
  }

  if (mediaKind === 'audio') {
    return (
      <div ref={containerRef} className="max-w-full">
        <audio
          ref={audioRef}
          preload="none"
          className="hidden"
          onError={() => setAudioFailed(true)}
        />
        {!audioFailed ? (
          <div className="flex w-full min-w-0 max-w-full items-center gap-2.5">
            {/* Circular play/pause */}
            <button
              type="button"
              onClick={() => void toggleAudioPlayback()}
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 ${
                isOutgoing
                  ? 'bg-white/25 text-white hover:bg-white/35'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              aria-label={isAudioPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              {isAudioPlaying
                ? <Pause size={18} weight="fill" />
                : <Play size={18} weight="fill" className="translate-x-px" />}
            </button>

            <div className="w-44 min-w-0 flex-none sm:w-52">
              <button
                type="button"
                onClick={handleAudioTrackSeek}
                className="flex h-9 w-full cursor-pointer items-center gap-[3px] rounded-md px-0.5"
                aria-label="Перемотать голосовое сообщение"
              >
                {generateWaveformBars(attachment.file_id, WAVEFORM_BARS).map((height, i) => {
                  const ratio = (i + 0.5) / WAVEFORM_BARS
                  const progress = audioProgressPercent / 100
                  const played = ratio < progress
                  const distanceFromProgress = Math.abs(ratio - progress)
                  const activeRange = 4 / WAVEFORM_BARS
                  const isCursor = isAudioPlaying && distanceFromProgress < 1.5 / WAVEFORM_BARS
                  const isNearCursor = isAudioPlaying && distanceFromProgress < activeRange
                  const activeBoost = isNearCursor ? 1 + (1 - distanceFromProgress / activeRange) * 0.45 : 1
                  const barH = Math.round(height * 22)
                  return (
                    <span
                      key={i}
                      className={`block flex-1 rounded-full transition-all duration-100 ${
                        played
                          ? isOutgoing ? 'bg-white' : 'bg-primary'
                          : isOutgoing ? 'bg-white/40' : 'bg-muted-foreground/25'
                      } ${isCursor ? 'motion-safe:animate-pulse' : ''}`}
                      style={{
                        height: `${Math.min(barH * activeBoost, 30)}px`,
                        minHeight: isCursor ? '8px' : '4px',
                        opacity: played || isNearCursor ? 1 : (isOutgoing ? 0.65 : 0.5),
                        transform: `scaleY(${isNearCursor ? activeBoost : 1})`,
                        transformOrigin: 'center',
                      }}
                    />
                  )
                })}
              </button>
              <div className={`flex items-center justify-between text-[11px] ${isOutgoing ? 'text-white/70' : 'text-muted-foreground'}`}>
                <span>{formatClockSeconds(audioCurrentTime)}</span>
                <span>{formatClockSeconds(effectiveDuration)}</span>
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
