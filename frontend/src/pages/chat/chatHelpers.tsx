import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { isAxiosError } from 'axios'
import { Pause, Play } from 'lucide-react'
import { chatApi, type ChatAttachmentInfo, type ChatInfo, type ChatMessageInfo } from '@/lib/api'

export function extractApiError(e: unknown, fallback: string): string {
  if (!isAxiosError(e)) return fallback
  const apiError = (e.response?.data as { error?: { message?: string } } | undefined)?.error
  if (apiError?.message) return apiError.message
  if (e.response?.status === 429) return 'Слишком много запросов. Попробуйте позже.'
  return fallback
}

export function toDayKey(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function formatDayDivider(value: string): string {
  const target = new Date(value)
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`
  const targetKey = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`
  if (targetKey === todayKey) return 'Сегодня'
  if (targetKey === yesterdayKey) return 'Вчера'
  return target.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
}

export function getInitials(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase()
}

export const MESSAGE_PAGE_SIZE = 50
export const MESSAGE_MAX_CHARS = 500
export const TYPING_TTL_MS = 3000
export const CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat.sidebar.collapsed.v1'
export const ATTACHMENT_URL_REFRESH_BUFFER_MS = 30_000
export const CHAT_ATTACHMENT_MAX_MB = 5
export const CHAT_ATTACHMENT_MAX_BYTES = CHAT_ATTACHMENT_MAX_MB * 1024 * 1024
export const VOICE_NOTE_MAX_DURATION_MS = 60_000
export const VOICE_NOTE_TICK_MS = 250

export type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'
export type ComposerAttachmentSource = 'media' | 'file' | 'paste' | 'voice'
export type MediaPreviewKind = 'image' | 'video'

export interface ComposerAttachment {
  clientId: string
  fileId: string
  originalName: string
  contentType: string
  size: number
  durationMs: number | null
  status: ComposerAttachmentStatus
  error: string | null
}

export interface CachedAttachmentDownloadUrl {
  url: string
  expiresAt: number
  promise?: Promise<string>
}

export interface MediaPreviewState {
  kind: MediaPreviewKind
  url: string
  originalName: string
}

export const attachmentDownloadUrlCache = new Map<string, CachedAttachmentDownloadUrl>()

export function chatTypeLabel(chatType: ChatInfo['chat_type']): string {
  if (chatType === 'direct') return 'Личный'
  if (chatType === 'group') return 'Группа'
  return 'Канал'
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function pickFirstString(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function parseAttachmentSize(item: Record<string, unknown>): number {
  const value = item.size ?? item.bytes ?? item.size_bytes
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 0
}

export function inferContentTypeFromName(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  if (!ext) return 'application/octet-stream'
  if (['md', 'markdown'].includes(ext)) return 'text/markdown'
  if (['txt', 'log'].includes(ext)) return 'text/plain'
  if (['csv'].includes(ext)) return 'text/csv'
  if (['json'].includes(ext)) return 'application/json'
  if (['xml'].includes(ext)) return 'application/xml'
  if (['yml', 'yaml'].includes(ext)) return 'application/yaml'
  if (['html', 'htm'].includes(ext)) return 'text/html'
  if (['png'].includes(ext)) return 'image/png'
  if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg'
  if (['gif'].includes(ext)) return 'image/gif'
  if (['webp'].includes(ext)) return 'image/webp'
  if (['bmp'].includes(ext)) return 'image/bmp'
  if (['svg'].includes(ext)) return 'image/svg+xml'
  if (['heic'].includes(ext)) return 'image/heic'
  if (['heif'].includes(ext)) return 'image/heif'
  if (['avif'].includes(ext)) return 'image/avif'
  if (['mp4'].includes(ext)) return 'video/mp4'
  if (['webm'].includes(ext)) return 'video/webm'
  if (['mov'].includes(ext)) return 'video/quicktime'
  if (['m4v'].includes(ext)) return 'video/x-m4v'
  if (['avi'].includes(ext)) return 'video/x-msvideo'
  if (['mkv'].includes(ext)) return 'video/x-matroska'
  if (['ogg', 'oga', 'opus'].includes(ext)) return 'audio/ogg'
  if (['mp3'].includes(ext)) return 'audio/mpeg'
  if (['m4a'].includes(ext)) return 'audio/mp4'
  if (['wav'].includes(ext)) return 'audio/wav'
  return 'application/octet-stream'
}

export function normalizeAttachmentRecord(
  item: Record<string, unknown>,
  bodyName: string,
  bodyLooksLikeFilename: boolean,
): ChatAttachmentInfo | null {
  const fileId = pickFirstString(item, ['file_id', 'fileId', 'id', 'attachment_id', 'attachmentId'])
  if (!fileId) return null

  const originalNameCandidate = pickFirstString(item, ['original_name', 'originalName', 'filename', 'name', 'title'])
  const originalName =
    originalNameCandidate || (bodyLooksLikeFilename ? bodyName : `file-${fileId.slice(0, 8)}`)

  const contentTypeCandidate = pickFirstString(item, ['content_type', 'contentType', 'mime_type', 'mimeType', 'mime'])
  const contentType = contentTypeCandidate || inferContentTypeFromName(originalName)
  const status = pickFirstString(item, ['status']) || 'ready'

  return {
    file_id: fileId,
    original_name: originalName,
    content_type: contentType,
    size: parseAttachmentSize(item),
    status,
  }
}

export function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

export function getMessageAttachments(message: ChatMessageInfo): ChatAttachmentInfo[] {
  const result: ChatAttachmentInfo[] = []
  const seen = new Set<string>()
  const bodyName = message.body.trim()
  const bodyLooksLikeFilename = /^.+\.[a-z0-9]{2,8}$/i.test(bodyName)
  const meta = (message.meta ?? {}) as Record<string, unknown>

  const rawAttachmentValues: unknown[] = []
  if (Array.isArray(meta.attachments)) rawAttachmentValues.push(...meta.attachments)
  if (meta.attachment && typeof meta.attachment === 'object') rawAttachmentValues.push(meta.attachment)
  if (Array.isArray(meta.files)) rawAttachmentValues.push(...meta.files)
  if (meta.file && typeof meta.file === 'object') rawAttachmentValues.push(meta.file)

  for (const candidate of rawAttachmentValues) {
    if (!candidate || typeof candidate !== 'object') continue
    const normalized = normalizeAttachmentRecord(candidate as Record<string, unknown>, bodyName, bodyLooksLikeFilename)
    if (!normalized) continue
    if (seen.has(normalized.file_id)) continue
    seen.add(normalized.file_id)
    result.push(normalized)
  }

  if (result.length > 0) {
    return result
  }

  const fallbackIds = [
    ...normalizeIdList(meta.attachment_ids),
    ...normalizeIdList(meta.attachmentIds),
    ...normalizeIdList(meta.file_ids),
    ...normalizeIdList(meta.fileIds),
  ]
  const fallbackContentTypeCandidate = pickFirstString(meta, [
    'content_type',
    'contentType',
    'mime_type',
    'mimeType',
    'mime',
  ])
  for (const fileId of fallbackIds) {
    if (seen.has(fileId)) continue
    seen.add(fileId)
    const originalName = bodyLooksLikeFilename ? bodyName : `Файл ${fileId.slice(0, 8)}`
    const contentType = fallbackContentTypeCandidate || inferContentTypeFromName(originalName)
    result.push({
      file_id: fileId,
      original_name: originalName,
      content_type: contentType,
      size: 0,
      status: 'ready',
    })
  }

  if (result.length === 0 && bodyLooksLikeFilename) {
    const directFileId = pickFirstString(meta, ['file_id', 'fileId'])
    if (directFileId) {
      result.push({
        file_id: directFileId,
        original_name: bodyName,
        content_type: inferContentTypeFromName(bodyName),
        size: 0,
        status: 'ready',
      })
    }
  }
  return result
}

export function inferMediaKind(contentType: string, originalName: string): 'image' | 'video' | 'audio' | 'file' {
  const mime = String(contentType || '').trim().toLowerCase()
  if (mime.startsWith('image/') || mime.includes('image/')) return 'image'
  if (mime.startsWith('video/') || mime.includes('video/')) return 'video'
  if (mime.startsWith('audio/') || mime.includes('audio/')) return 'audio'

  const name = safeDecodeURIComponent(String(originalName || ''))
    .trim()
    .toLowerCase()
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)(?:$|[?#\s])/i.test(name)) return 'image'
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(?:$|[?#\s])/i.test(name)) return 'video'
  if (/\.(ogg|oga|opus|mp3|m4a|wav)(?:$|[?#\s])/i.test(name)) return 'audio'
  return 'file'
}

export function normalizeAttachmentMimeForPlayback(contentType: string): string {
  const normalized = String(contentType || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''
  const [base] = normalized.split(';')
  return (base || normalized).trim()
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

export function isMediaAttachment(contentType: string): boolean {
  const normalized = contentType.toLowerCase()
  return normalized.startsWith('image/') || normalized.startsWith('video/')
}

export function isVoiceAttachment(contentType: string): boolean {
  return String(contentType || '').trim().toLowerCase().startsWith('audio/')
}

export function formatDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatClockSeconds(secondsValue: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(secondsValue) ? secondsValue : 0))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function resolveVoiceRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
  ]
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType
  }
  return ''
}

export function getVoiceFileExtension(mimeType: string): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('mpeg')) return 'mp3'
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mp4')) return 'm4a'
  return 'ogg'
}

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

async function getAttachmentDownloadUrl(chatId: string, fileId: string): Promise<string> {
  const cacheKey = `${chatId}:${fileId}`
  const now = Date.now()
  const cached = attachmentDownloadUrlCache.get(cacheKey)
  if (cached && cached.url && cached.expiresAt - ATTACHMENT_URL_REFRESH_BUFFER_MS > now) {
    return cached.url
  }
  if (cached?.promise) {
    return cached.promise
  }

  const promise = (async () => {
    const response = await chatApi.getAttachmentDownloadUrl(chatId, fileId)
    if (!response.data.ok || !response.data.data) {
      throw new Error(response.data.error?.message || 'Не удалось получить ссылку на вложение')
    }
    const next = response.data.data
    attachmentDownloadUrlCache.set(cacheKey, {
      url: next.url,
      expiresAt: Date.now() + next.expires_in * 1000,
    })
    return next.url
  })()

  attachmentDownloadUrlCache.set(cacheKey, {
    url: cached?.url || '',
    expiresAt: cached?.expiresAt || 0,
    promise,
  })

  try {
    return await promise
  } catch (error) {
    attachmentDownloadUrlCache.delete(cacheKey)
    throw error
  }
}

export function AttachmentPreview({
  chatId,
  attachment,
  onOpenMediaPreview,
}: {
  chatId: string
  attachment: ChatAttachmentInfo
  onOpenMediaPreview?: (preview: MediaPreviewState) => void
}) {
  const [downloadUrl, setDownloadUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [errorText, setErrorText] = useState('')
  const [audioFailed, setAudioFailed] = useState(false)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [isDownloadingFile, setIsDownloadingFile] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErrorText('')
    setDownloadUrl('')
    setAudioFailed(false)
    setIsAudioPlaying(false)
    setAudioCurrentTime(0)
    setAudioDuration(0)

    void getAttachmentDownloadUrl(chatId, attachment.file_id)
      .then((url) => {
        if (cancelled) return
        setDownloadUrl(url)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setErrorText(extractApiError(error, 'Не удалось загрузить вложение'))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [attachment.file_id, chatId])

  const mediaKind = inferMediaKind(attachment.content_type, attachment.original_name)
  const playbackType = normalizeAttachmentMimeForPlayback(attachment.content_type)
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

  if (loading) {
    return <div className="text-xs text-muted-foreground">Загрузка вложения...</div>
  }

  if (errorText) {
    return <div className="text-xs text-destructive">{errorText}</div>
  }

  const toggleAudioPlayback = async () => {
    const audio = audioRef.current
    if (!audio || audioFailed) return
    try {
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
    if (!downloadUrl || isDownloadingFile) return
    setIsDownloadingFile(true)
    setErrorText('')
    try {
      await forceDownloadAttachment(downloadUrl, attachment.original_name, attachment.content_type)
    } catch (error: unknown) {
      setErrorText(extractApiError(error, 'Не удалось скачать вложение'))
    } finally {
      setIsDownloadingFile(false)
    }
  }

  if (mediaKind === 'image') {
    return (
      <button
        type="button"
        className="block max-w-full"
        onClick={() =>
          onOpenMediaPreview?.({
            kind: 'image',
            url: downloadUrl,
            originalName: attachment.original_name,
          })
        }
      >
        <img
          src={downloadUrl}
          alt={attachment.original_name}
          className="max-h-72 max-w-full rounded-lg border border-border/60 object-contain"
        />
      </button>
    )
  }
  if (mediaKind === 'video') {
    return (
      <div className="max-w-full rounded-lg border border-border/60 bg-background/20 p-2">
        <video
          controls
          src={downloadUrl}
          className="max-h-80 max-w-full rounded-md"
        >
          Ваш браузер не поддерживает видео.
        </video>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() =>
              onOpenMediaPreview?.({
                kind: 'video',
                url: downloadUrl,
                originalName: attachment.original_name,
              })
            }
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
      <div className="max-w-full">
        <audio
          ref={audioRef}
          preload="metadata"
          className="hidden"
          onError={() => setAudioFailed(true)}
        >
          <source src={downloadUrl} type={playbackType || undefined} />
          <source src={downloadUrl} />
        </audio>
        {!audioFailed ? (
          <div className="flex w-full min-w-0 max-w-full items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleAudioPlayback()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/85 text-primary-foreground transition-colors hover:bg-primary"
              aria-label={isAudioPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              {isAudioPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={handleAudioTrackSeek}
                className="relative mt-0.5 block h-4 w-full cursor-pointer rounded-full"
                aria-label="Перемотать голосовое сообщение"
              >
                <span className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-background/70" />
                <span
                  className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/80"
                  style={{ width: `${audioProgressPercent}%` }}
                />
                <span
                  className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-primary/80 bg-primary shadow-[0_0_0_2px_rgba(2,6,23,0.45)] transition-[left] duration-100 ease-linear"
                  style={{ left: `calc(${audioProgressPercent}% - 0.4375rem)` }}
                />
              </button>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
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
  )
}
