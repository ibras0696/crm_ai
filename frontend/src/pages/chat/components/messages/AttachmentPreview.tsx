import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { Pause, Play } from '@phosphor-icons/react'

import { chatApi, type ChatAttachmentInfo } from '@/lib/api'

import {
  clamp01,
  formatClockSeconds,
  formatFileSize,
  inferMediaKind,
  normalizeAttachmentMimeForPlayback,
  type MediaPreviewState,
} from '../../chatHelpers'
import {
  resolveCachedMediaObjectUrl,
  resolveCachedMediaObjectUrlFromCache,
  revokeCachedMediaObjectUrl,
} from '../../chatMediaCache'
import { useAttachmentDownloadUrl } from '../../hooks/useAttachmentDownloadUrl'

const ATTACHMENT_PRELOAD_ROOT_MARGIN = '240px'
const WAVEFORM_BARS = 32
const PREVIEW_URL_REFRESH_BUFFER_MS = 60_000
const PREVIEW_STATUS_CACHE_TTL_MS = 10 * 60_000

interface CachedAttachmentPreview {
  data: {
    status: string
    url?: string | null
    expires_in?: number | null
    content_type?: string | null
    size?: number | null
    meta?: Record<string, unknown> | null
  }
  expiresAt: number
  promise?: Promise<CachedAttachmentPreview['data']>
}

const attachmentPreviewCache = new Map<string, CachedAttachmentPreview>()

function getPreviewCacheKey(chatId: string, fileId: string): string {
  return `${chatId}:${fileId}`
}

function shouldRequestPreviewUrl(status: string, hasAttachmentPreviewMeta: boolean): boolean {
  if (status === 'ready') return true
  if (status === 'pending' || status === 'processing' || status === 'unsupported' || status === 'failed') return false
  return hasAttachmentPreviewMeta
}

function getPreviewDataExpiresAt(data: CachedAttachmentPreview['data']): number {
  const now = Date.now()
  if (data.url && typeof data.expires_in === 'number' && Number.isFinite(data.expires_in)) {
    return now + Math.max(30_000, data.expires_in * 1000 - PREVIEW_URL_REFRESH_BUFFER_MS)
  }
  return now + PREVIEW_STATUS_CACHE_TTL_MS
}

async function fetchAttachmentPreview(
  chatId: string,
  fileId: string,
  cacheKey: string,
): Promise<CachedAttachmentPreview['data']> {
  const existing = attachmentPreviewCache.get(cacheKey)
  const promise = (async () => {
    const response = await chatApi.getAttachmentPreview(chatId, fileId)
    const payload = response.data?.data
    if (!payload) throw new Error('Не удалось получить preview')
    const data = {
      status: payload.status,
      url: payload.url,
      expires_in: payload.expires_in,
      content_type: payload.content_type,
      size: payload.size,
      meta: payload.meta,
    }
    attachmentPreviewCache.set(cacheKey, {
      data,
      expiresAt: getPreviewDataExpiresAt(data),
    })
    return data
  })()

  attachmentPreviewCache.set(cacheKey, {
    data: existing?.data ?? { status: 'pending' },
    expiresAt: existing?.expiresAt ?? 0,
    promise,
  })

  try {
    return await promise
  } catch (error) {
    attachmentPreviewCache.delete(cacheKey)
    throw error
  }
}

async function resolveAttachmentPreview(
  chatId: string,
  fileId: string,
): Promise<CachedAttachmentPreview['data']> {
  const cacheKey = getPreviewCacheKey(chatId, fileId)
  const cached = attachmentPreviewCache.get(cacheKey)
  const now = Date.now()
  if (cached?.promise) return cached.promise
  if (cached?.data && cached.expiresAt > now) return cached.data
  return fetchAttachmentPreview(chatId, fileId, cacheKey)
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

function buildPreviewCacheId(chatId: string, fileId: string, contentType?: string | null, size?: number | null): string {
  return `preview:${chatId}:${fileId}:${contentType || 'unknown'}:${size ?? 0}`
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
  const [isOpeningMedia, setIsOpeningMedia] = useState(false)
  const [cachedMediaUrl, setCachedMediaUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewStatus, setPreviewStatus] = useState(attachment.preview_status || '')
  const [previewMetaOverride, setPreviewMetaOverride] = useState<Record<string, unknown> | null>(null)

  const containerRef = useRef<HTMLElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cachedMediaUrlRef = useRef('')
  const previewUrlRef = useRef('')
  const setContainerElement = useCallback((node: HTMLDivElement | HTMLButtonElement | null) => {
    containerRef.current = node
  }, [])

  const mediaKind = inferMediaKind(attachment.content_type, attachment.original_name)
  const playbackType = normalizeAttachmentMimeForPlayback(attachment.content_type)
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
  const previewMeta = previewMetaOverride ?? attachment.preview_meta
  const hasPreviewMeta = Boolean(previewMeta)
  const initialPreviewCacheId = buildPreviewCacheId(
    chatId,
    attachment.file_id,
    attachment.preview_content_type,
    attachment.preview_size,
  )
  const waveformBars = Array.isArray(previewMeta?.waveform)
    ? previewMeta.waveform
      .map((value) => (typeof value === 'number' ? clamp01(value) : 0))
      .slice(0, WAVEFORM_BARS)
    : null
  const previewDurationMs = typeof previewMeta?.duration_ms === 'number' ? previewMeta.duration_ms : undefined

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
  }, [attachment.file_id, attachment.preview_status])

  useEffect(() => {
    cachedMediaUrlRef.current = cachedMediaUrl
  }, [cachedMediaUrl])

  useEffect(() => {
    previewUrlRef.current = previewUrl
  }, [previewUrl])

  useEffect(() => () => {
    if (cachedMediaUrlRef.current) {
      revokeCachedMediaObjectUrl(cachedMediaUrlRef.current)
    }
    if (previewUrlRef.current) {
      revokeCachedMediaObjectUrl(previewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    setCachedMediaUrl((previousUrl) => {
      if (previousUrl) revokeCachedMediaObjectUrl(previousUrl)
      return ''
    })
    setPreviewUrl((previousUrl) => {
      if (previousUrl) revokeCachedMediaObjectUrl(previousUrl)
      return ''
    })
    setPreviewStatus(attachment.preview_status || '')
    setPreviewMetaOverride(null)
  }, [attachment.file_id, attachment.preview_status])

  useEffect(() => {
    if (!['image', 'video', 'audio'].includes(mediaKind) || (!forceEagerLoad && !isElementVisible)) return
    if ((mediaKind === 'image' || mediaKind === 'video') && !previewUrl) {
      let cancelled = false
      void resolveCachedMediaObjectUrlFromCache(initialPreviewCacheId).then((objectUrl) => {
        if (!objectUrl || cancelled) {
          if (objectUrl) revokeCachedMediaObjectUrl(objectUrl)
          return
        }
        setPreviewUrl((previousUrl) => {
          if (previousUrl && previousUrl !== objectUrl) revokeCachedMediaObjectUrl(previousUrl)
          return objectUrl
        })
      })
      return () => {
        cancelled = true
      }
    }
  }, [forceEagerLoad, initialPreviewCacheId, isElementVisible, mediaKind, previewUrl])

  useEffect(() => {
    if (!['image', 'video', 'audio'].includes(mediaKind) || (!forceEagerLoad && !isElementVisible)) return
    if (previewUrl || previewStatus === 'unsupported' || previewStatus === 'failed') return
    if (mediaKind === 'audio' && previewStatus === 'ready' && hasPreviewMeta) return
    if (!shouldRequestPreviewUrl(previewStatus, hasPreviewMeta)) return

    let cancelled = false
    void resolveAttachmentPreview(chatId, attachment.file_id).then((data) => {
      if (cancelled) return
      if (!data) return
      setPreviewStatus(data.status)
      if (data.meta) setPreviewMetaOverride(data.meta)
      if (data.status === 'ready' && data.url) {
        const previewCacheId = buildPreviewCacheId(chatId, attachment.file_id, data.content_type, data.size)
        if (mediaKind === 'image' || mediaKind === 'video') {
          void resolveCachedMediaObjectUrl({
            cacheId: previewCacheId,
            fileId: attachment.file_id,
            sourceUrl: data.url,
            contentType: data.content_type || attachment.preview_content_type || 'application/octet-stream',
            sizeBytes: data.size ?? attachment.preview_size ?? undefined,
          }).then((objectUrl) => {
            if (!objectUrl || cancelled) {
              if (objectUrl) revokeCachedMediaObjectUrl(objectUrl)
              return
            }
            setPreviewUrl((previousUrl) => {
              if (previousUrl && previousUrl !== objectUrl) revokeCachedMediaObjectUrl(previousUrl)
              return objectUrl
            })
          })
        }
      }
    }).catch(() => {
      if (!cancelled) setErrorText('Не удалось получить preview')
    })

    return () => {
      cancelled = true
    }
  }, [
    attachment.file_id,
    attachment.preview_content_type,
    attachment.preview_size,
    chatId,
    forceEagerLoad,
    isElementVisible,
    mediaKind,
    previewStatus,
    previewUrl,
    hasPreviewMeta,
    setErrorText,
  ])

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
  const effectiveDuration = audioDuration > 0 ? audioDuration : (previewDurationMs ?? hintDurationMs ?? 0) / 1000

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
    setErrorText('')
    if (kind === 'image' && previewUrl) {
      onOpenMediaPreview?.({
        kind,
        url: previewUrl,
        originalName: attachment.original_name,
      })
      void resolveMediaPreviewUrlForAction().then((url) => {
        if (!url || url === previewUrl) return
        window.requestAnimationFrame(() => {
          onOpenMediaPreview?.({
            kind,
            url,
            originalName: attachment.original_name,
          })
        })
      }).catch((error: unknown) => {
        setErrorText(error instanceof Error ? error.message : 'Не удалось открыть оригинал')
      })
      return
    }

    if (isOpeningMedia) return
    setIsOpeningMedia(true)
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
    } finally {
      setIsOpeningMedia(false)
    }
  }

  if (mediaKind === 'image' && !forceEagerLoad && !isElementVisible) {
    return (
      <div ref={setContainerElement} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Вложение готово к загрузке
      </div>
    )
  }

  if (loading && !downloadUrl && mediaKind !== 'audio') {
    return (
      <div ref={setContainerElement} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Загрузка вложения...
      </div>
    )
  }

  if (errorText && !downloadUrl) {
    return (
      <div ref={setContainerElement} className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {errorText}
      </div>
    )
  }

  if (mediaKind === 'image' && previewUrl) {
    return (
      <div ref={setContainerElement}>
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

  if (mediaKind === 'image') {
    return (
      <button
        ref={setContainerElement}
        type="button"
        onClick={() => void openMediaPreview('image')}
        disabled={isOpeningMedia}
        className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/35 disabled:cursor-wait disabled:opacity-70"
      >
        {isOpeningMedia ? 'Открытие...' : previewStatus === 'failed' ? 'Открыть фото' : 'Preview готовится'}
        {errorText && <span className="mt-1 block text-[11px] text-destructive">{errorText}</span>}
      </button>
    )
  }

  if (mediaKind === 'video' && previewUrl) {
    return (
      <div ref={setContainerElement} className="max-w-full">
        <button
          type="button"
          className="group relative block max-w-full overflow-hidden rounded-lg border border-border/60 bg-background/20"
          onClick={() => void openMediaPreview('video')}
        >
          <img
            src={previewUrl}
            alt={attachment.original_name}
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onError={() => setErrorText('Не удалось загрузить preview')}
            className="max-h-80 max-w-full object-contain"
          />
          <span
            className={`absolute left-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
              isOutgoing
                ? 'bg-white/25 text-white group-hover:bg-white/35'
                : 'bg-primary text-primary-foreground group-hover:bg-primary/90'
            }`}
            aria-hidden="true"
          >
            <Play size={18} weight="fill" className="translate-x-px" />
          </span>
        </button>
        {errorText && <div className="mt-1 text-[11px] text-destructive">{errorText}</div>}
      </div>
    )
  }

  if (mediaKind === 'video' && renderMediaUrl) {
    return (
      <div ref={setContainerElement} className="max-w-full rounded-lg border border-border/60 bg-background/20 p-2">
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
      <div ref={setContainerElement} className="max-w-full rounded-lg border border-border/60 bg-background/20 p-3">
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
      <div ref={setContainerElement} className="max-w-full">
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
                {(waveformBars ?? generateWaveformBars(attachment.file_id, WAVEFORM_BARS)).map((height, i) => {
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
    <div ref={setContainerElement}>
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
