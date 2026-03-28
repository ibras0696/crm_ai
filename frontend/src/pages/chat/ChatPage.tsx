import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { isAxiosError } from 'axios'
import { ArrowDown, Camera, ChevronLeft, ChevronRight, Image, Loader2, MessageSquare, Mic, Paperclip, Pause, Play, Plus, Search, SendHorizontal, Square, Video, X } from 'lucide-react'
import { chatApi, type ChatAttachmentInfo, type ChatInfo, type ChatMemberInfo, type ChatMessageInfo, type ChatMessageMeta } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

function extractApiError(e: unknown, fallback: string): string {
  if (!isAxiosError(e)) return fallback
  const apiError = (e.response?.data as { error?: { message?: string } } | undefined)?.error
  if (apiError?.message) return apiError.message
  if (e.response?.status === 429) return 'Слишком много запросов. Попробуйте позже.'
  return fallback
}

function toDayKey(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDayDivider(value: string): string {
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

function getInitials(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase()
}

const MESSAGE_PAGE_SIZE = 50
const MESSAGE_MAX_CHARS = 500
const TYPING_TTL_MS = 3000
const CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat.sidebar.collapsed.v1'
const ATTACHMENT_URL_REFRESH_BUFFER_MS = 30_000
const CHAT_ATTACHMENT_MAX_MB = 5
const CHAT_ATTACHMENT_MAX_BYTES = CHAT_ATTACHMENT_MAX_MB * 1024 * 1024
const VOICE_NOTE_MAX_DURATION_MS = 60_000
const VOICE_NOTE_TICK_MS = 250

type ComposerAttachmentStatus = 'uploading' | 'ready' | 'error'
type ComposerAttachmentSource = 'media' | 'file' | 'paste' | 'voice'
type MediaPreviewKind = 'image' | 'video'

interface ComposerAttachment {
  clientId: string
  fileId: string
  originalName: string
  contentType: string
  size: number
  durationMs: number | null
  status: ComposerAttachmentStatus
  error: string | null
}

interface CachedAttachmentDownloadUrl {
  url: string
  expiresAt: number
  promise?: Promise<string>
}

interface MediaPreviewState {
  kind: MediaPreviewKind
  url: string
  originalName: string
}

const attachmentDownloadUrlCache = new Map<string, CachedAttachmentDownloadUrl>()

function chatTypeLabel(chatType: ChatInfo['chat_type']): string {
  if (chatType === 'direct') return 'Личный'
  if (chatType === 'group') return 'Группа'
  return 'Канал'
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function pickFirstString(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseAttachmentSize(item: Record<string, unknown>): number {
  const value = item.size ?? item.bytes ?? item.size_bytes
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 0
}

function inferContentTypeFromName(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  if (!ext) return 'application/octet-stream'
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

function normalizeAttachmentRecord(
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

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function getMessageAttachments(message: ChatMessageInfo): ChatAttachmentInfo[] {
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

function inferMediaKind(contentType: string, originalName: string): 'image' | 'video' | 'audio' | 'file' {
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

function normalizeAttachmentMimeForPlayback(contentType: string): string {
  const normalized = String(contentType || '')
    .trim()
    .toLowerCase()
  if (!normalized) return ''
  const [base] = normalized.split(';')
  return (base || normalized).trim()
}

function isMediaAttachment(contentType: string): boolean {
  const normalized = contentType.toLowerCase()
  return normalized.startsWith('image/') || normalized.startsWith('video/')
}

function isVoiceAttachment(contentType: string): boolean {
  return String(contentType || '').trim().toLowerCase().startsWith('audio/')
}

function formatDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatClockSeconds(secondsValue: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(secondsValue) ? secondsValue : 0))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function resolveVoiceRecorderMimeType(): string {
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

function getVoiceFileExtension(mimeType: string): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('mpeg')) return 'mp3'
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mp4')) return 'm4a'
  return 'ogg'
}

function formatFileSize(size: number): string {
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

function AttachmentPreview({
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
          <div className="flex min-w-[230px] items-center gap-2">
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
          <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <span className="truncate text-xs text-muted-foreground">Не удалось воспроизвести</span>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              download={attachment.original_name}
              className="shrink-0 text-xs text-primary hover:underline"
            >
              Скачать
            </a>
          </div>
        )}
      </div>
    )
  }

  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noreferrer"
      download={attachment.original_name}
      className="inline-flex max-w-full items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-primary hover:bg-primary/5"
    >
      <span className="truncate">{attachment.original_name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
    </a>
  )
}

export default function ChatPage() {
  const { members, user } = useAuth()
  const [chats, setChats] = useState<ChatInfo[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageInfo[]>([])
  const [chatMembers, setChatMembers] = useState<ChatMemberInfo[]>([])
  const [presence, setPresence] = useState<Record<string, boolean>>({})
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null)
  const [menuOpenMessageId, setMenuOpenMessageId] = useState<string | null>(null)
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({})
  const [ackedOwnMessages, setAckedOwnMessages] = useState<Record<string, boolean>>({})
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [newMessagesCount, setNewMessagesCount] = useState(0)
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [errorText, setErrorText] = useState('')

  const [newChatTitle, setNewChatTitle] = useState('')
  const [newChatType, setNewChatType] = useState<'direct' | 'group' | 'channel'>('group')
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [createChatOpen, setCreateChatOpen] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([])
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceRecordingElapsedMs, setVoiceRecordingElapsedMs] = useState(0)
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 1023px)').matches
  })
  const [isMobileDialogsOpen, setIsMobileDialogsOpen] = useState(false)
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null)
  const selectedChatIdRef = useRef<string | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const mediaAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const cameraPhotoAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const cameraVideoAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const fileAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentUploadControllersRef = useRef<Record<string, AbortController>>({})
  const typingStopTimerRef = useRef<number | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStopTimerRef = useRef<number | null>(null)
  const voiceTickTimerRef = useRef<number | null>(null)
  const voiceShouldUploadOnStopRef = useRef(true)
  const voiceDurationOnStopRef = useRef(0)
  const voiceElapsedMsRef = useRef(0)

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
    setIsAttachMenuOpen(false)
    setMediaPreview(null)
  }, [selectedChatId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 1023px)')
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches)
      if (!event.matches) setIsMobileDialogsOpen(false)
    }
    setIsMobileViewport(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY, isDesktopSidebarCollapsed ? '1' : '0')
  }, [isDesktopSidebarCollapsed])

  useEffect(() => {
    if (!isAttachMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (attachMenuRef.current && target && !attachMenuRef.current.contains(target)) {
        setIsAttachMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [isAttachMenuOpen])

  useEffect(() => {
    if (!mediaPreview) return
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMediaPreview(null)
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [mediaPreview])

  const membersById = useMemo(() => {
    return new Map(
      members.map((m) => [m.user_id, `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id]),
    )
  }, [members])

  const selectedChat = useMemo(() => {
    return chats.find((x) => x.id === selectedChatId) || null
  }, [chats, selectedChatId])

  const selectedChatMembers = useMemo(() => {
    if (!selectedChat) return []
    return selectedChat.member_ids.map((id) => {
      const label = membersById.get(id) || id
      return { userId: id, label, initials: getInitials(label), online: Boolean(presence[id]) }
    })
  }, [membersById, presence, selectedChat])

  const getChatDisplayTitle = useCallback(
    (chat: ChatInfo): string => {
      if (chat.title?.trim()) return chat.title.trim()
      if (chat.chat_type === 'direct') {
        const peerIds = chat.member_ids.filter((id) => id !== user?.id)
        if (peerIds.length > 0) {
          const peerLabels = peerIds.map((id) => membersById.get(id) || id)
          return peerLabels.join(', ')
        }
        return 'Личный чат'
      }
      if (chat.chat_type === 'group') return 'Группа без названия'
      return 'Канал без названия'
    },
    [membersById, user?.id],
  )

  const visibleMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((message) => message.body.toLowerCase().includes(q))
  }, [messages, searchQuery])

  const replyToMessage = useMemo(
    () => messages.find((message) => message.id === replyToMessageId) || null,
    [messages, replyToMessageId],
  )

  const typingLabels = useMemo(() => {
    const now = Date.now()
    return Object.entries(typingUsers)
      .filter(([, expiresAt]) => expiresAt > now)
      .map(([userId]) => membersById.get(userId) || userId)
  }, [membersById, typingUsers])

  const scrollMessagesToBottom = () => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }

  const adjustComposerHeight = () => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 160
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }

  const getMessageOwnerLabel = (message: ChatMessageInfo): string => {
    return membersById.get(message.sender_id) || message.sender_id
  }

  const getOwnMessageStatus = (message: ChatMessageInfo): string => {
    if (!user || message.sender_id !== user.id) return ''
    const readByOther = chatMembers.some((member) => member.user_id !== user.id && member.last_read_seq_no >= message.seq_no)
    if (readByOther) return 'Прочитано'
    const hasOnlinePeer = chatMembers.some((member) => member.user_id !== user.id && presence[member.user_id])
    if (ackedOwnMessages[message.id] || hasOnlinePeer) return 'Доставлено'
    return 'Отправлено'
  }

  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const isExpandableMessage = (body: string): boolean => {
    if (body.length > 280) return true
    if (/(https?:\/\/\S{80,})/i.test(body)) return true
    if (/^(?:\[|\{)/.test(body.trim()) && body.length > 120) return true
    return false
  }

  const readyComposerAttachments = useMemo(
    () => composerAttachments.filter((item) => item.status === 'ready'),
    [composerAttachments],
  )
  const hasUploadingAttachments = useMemo(
    () => composerAttachments.some((item) => item.status === 'uploading'),
    [composerAttachments],
  )
  const canSendMessage = Boolean(selectedChatId) && !sending && (draft.trim().length > 0 || readyComposerAttachments.length > 0)

  const clearVoiceRecordingTimers = () => {
    if (voiceStopTimerRef.current !== null) {
      window.clearTimeout(voiceStopTimerRef.current)
      voiceStopTimerRef.current = null
    }
    if (voiceTickTimerRef.current !== null) {
      window.clearInterval(voiceTickTimerRef.current)
      voiceTickTimerRef.current = null
    }
  }

  const stopVoiceStreamTracks = () => {
    const stream = voiceStreamRef.current
    if (!stream) return
    for (const track of stream.getTracks()) {
      track.stop()
    }
    voiceStreamRef.current = null
  }

  const resetComposerAttachments = useCallback(() => {
    for (const controller of Object.values(attachmentUploadControllersRef.current)) {
      controller.abort()
    }
    attachmentUploadControllersRef.current = {}
    clearVoiceRecordingTimers()
    const recorder = voiceRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      voiceShouldUploadOnStopRef.current = false
      recorder.stop()
    }
    voiceRecorderRef.current = null
    voiceChunksRef.current = []
    voiceElapsedMsRef.current = 0
    setIsRecordingVoice(false)
    setVoiceRecordingElapsedMs(0)
    stopVoiceStreamTracks()
    setComposerAttachments([])
    if (mediaAttachmentInputRef.current) mediaAttachmentInputRef.current.value = ''
    if (cameraPhotoAttachmentInputRef.current) cameraPhotoAttachmentInputRef.current.value = ''
    if (cameraVideoAttachmentInputRef.current) cameraVideoAttachmentInputRef.current.value = ''
    if (fileAttachmentInputRef.current) fileAttachmentInputRef.current.value = ''
  }, [])

  useEffect(() => {
    return () => {
      resetComposerAttachments()
    }
  }, [resetComposerAttachments, selectedChatId])

  const handleRemoveComposerAttachment = async (clientId: string) => {
    const attachment = composerAttachments.find((item) => item.clientId === clientId)
    if (!attachment) return

    const controller = attachmentUploadControllersRef.current[clientId]
    if (controller) {
      controller.abort()
      delete attachmentUploadControllersRef.current[clientId]
    }

    if (attachment.status === 'uploading' && selectedChatId && attachment.fileId) {
      try {
        await chatApi.abortAttachmentUpload(selectedChatId, attachment.fileId)
      } catch {
        // ignore abort cleanup errors
      }
    }

    setComposerAttachments((prev) => prev.filter((item) => item.clientId !== clientId))
    if (mediaAttachmentInputRef.current) mediaAttachmentInputRef.current.value = ''
    if (cameraPhotoAttachmentInputRef.current) cameraPhotoAttachmentInputRef.current.value = ''
    if (cameraVideoAttachmentInputRef.current) cameraVideoAttachmentInputRef.current.value = ''
    if (fileAttachmentInputRef.current) fileAttachmentInputRef.current.value = ''
  }

  const uploadComposerAttachment = async (
    file: File,
    source: ComposerAttachmentSource,
    options?: { durationMs?: number | null },
  ) => {
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Остановите запись голосового перед добавлением другого вложения')
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }

    const contentType = file.type || 'application/octet-stream'
    if (source === 'media' || source === 'paste') {
      if (!isMediaAttachment(contentType)) {
        setErrorText('Кнопка "Фото/Видео" принимает только фото и видео')
        return
      }
    }
    if (source === 'voice') {
      if (!isVoiceAttachment(contentType)) {
        setErrorText('Голосовые сообщения должны быть в аудио-формате')
        return
      }
      const durationMs = Number(options?.durationMs || 0)
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > VOICE_NOTE_MAX_DURATION_MS) {
        setErrorText('Голосовое сообщение не должно превышать 1 минуту')
        return
      }
    }
    if (source === 'paste' && !contentType.startsWith('image/')) {
      setErrorText('Из буфера можно вставлять только изображения')
      return
    }
    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      setErrorText(`Максимальный размер файла: ${CHAT_ATTACHMENT_MAX_MB} MB`)
      return
    }

    const clientId = crypto.randomUUID()
    setComposerAttachments((prev) => [
      ...prev,
      {
        clientId,
        fileId: '',
        originalName: file.name,
        contentType,
        size: file.size,
        durationMs: typeof options?.durationMs === 'number' ? options.durationMs : null,
        status: 'uploading',
        error: null,
      },
    ])

    const controller = new AbortController()
    attachmentUploadControllersRef.current[clientId] = controller
    let uploadedFileId = ''

    try {
      const initResponse = await chatApi.initAttachmentUpload(selectedChatId, {
        filename: file.name,
        size_bytes: file.size,
        content_type: contentType,
      })
      if (!initResponse.data.ok || !initResponse.data.data) {
        throw new Error(initResponse.data.error?.message || 'Не удалось инициировать загрузку файла')
      }

      const initData = initResponse.data.data
      uploadedFileId = initData.file_id
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                fileId: initData.file_id,
              }
            : item,
        ),
      )

      const headers = new Headers(initData.upload_headers)
      if (contentType && !headers.has('Content-Type')) {
        headers.set('Content-Type', contentType)
      }

      const uploadResponse = await fetch(initData.upload_url, {
        method: 'PUT',
        headers,
        body: file,
        signal: controller.signal,
      })
      if (!uploadResponse.ok) {
        throw new Error(`Не удалось загрузить файл (${uploadResponse.status})`)
      }

      const finishResponse = await chatApi.finishAttachmentUpload(selectedChatId, {
        file_id: initData.file_id,
        size_bytes: file.size,
      })
      if (!finishResponse.data.ok || !finishResponse.data.data) {
        throw new Error(finishResponse.data.error?.message || 'Не удалось завершить загрузку файла')
      }

      const finished = finishResponse.data.data
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                fileId: finished.file_id,
                originalName: finished.original_name,
                contentType: finished.content_type,
                size: finished.size,
                durationMs: item.durationMs,
                status: 'ready',
                error: null,
              }
            : item,
        ),
      )
    } catch (error: unknown) {
      if (uploadedFileId) {
        try {
          await chatApi.abortAttachmentUpload(selectedChatId, uploadedFileId)
        } catch {
          // ignore cleanup errors
        }
      }

      let message = controller.signal.aborted ? 'Загрузка отменена' : extractApiError(error, 'Не удалось загрузить файл')
      if (error instanceof TypeError && /fetch/i.test(error.message)) {
        message = 'Не удалось загрузить файл в хранилище. Проверьте сеть/CORS и повторите попытку.'
      }
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.clientId === clientId
            ? {
                ...item,
                status: 'error',
                error: message,
              }
            : item,
        ),
      )
    } finally {
      if (attachmentUploadControllersRef.current[clientId] === controller) {
        delete attachmentUploadControllersRef.current[clientId]
      }
    }
  }

  const handleAttachmentInputChange = async (event: ChangeEvent<HTMLInputElement>, source: ComposerAttachmentSource) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Сначала остановите запись голосового')
      return
    }
    if (files.length > 1 || composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    await uploadComposerAttachment(files[0]!, source)
  }

  const handleMediaInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachmentInputChange(event, 'media')
  }

  const handleCameraPhotoInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachmentInputChange(event, 'media')
  }

  const handleCameraVideoInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachmentInputChange(event, 'media')
  }

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleAttachmentInputChange(event, 'file')
  }

  const openMediaPicker = () => {
    setIsAttachMenuOpen(false)
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Остановите запись голосового перед добавлением другого вложения')
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    mediaAttachmentInputRef.current?.click()
  }

  const openCameraPhotoPicker = () => {
    setIsAttachMenuOpen(false)
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Остановите запись голосового перед добавлением другого вложения')
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    cameraPhotoAttachmentInputRef.current?.click()
  }

  const openCameraVideoPicker = () => {
    setIsAttachMenuOpen(false)
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Остановите запись голосового перед добавлением другого вложения')
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    cameraVideoAttachmentInputRef.current?.click()
  }

  const openFilePicker = () => {
    setIsAttachMenuOpen(false)
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      setErrorText('Остановите запись голосового перед добавлением другого вложения')
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    fileAttachmentInputRef.current?.click()
  }

  const stopVoiceRecording = (uploadAfterStop = true) => {
    const recorder = voiceRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      clearVoiceRecordingTimers()
      setIsRecordingVoice(false)
      setVoiceRecordingElapsedMs(0)
      voiceElapsedMsRef.current = 0
      stopVoiceStreamTracks()
      return
    }
    voiceShouldUploadOnStopRef.current = uploadAfterStop
    voiceDurationOnStopRef.current = Math.min(voiceElapsedMsRef.current, VOICE_NOTE_MAX_DURATION_MS)
    recorder.stop()
  }

  const startVoiceRecording = async () => {
    setIsAttachMenuOpen(false)
    if (!selectedChatId) {
      setErrorText('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      stopVoiceRecording(true)
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      setErrorText('В сообщении может быть только 1 вложение')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorText('Запись голосовых не поддерживается в этом браузере')
      return
    }

    setErrorText('')
    setVoiceRecordingElapsedMs(0)
    voiceElapsedMsRef.current = 0
    voiceChunksRef.current = []
    voiceShouldUploadOnStopRef.current = true
    voiceDurationOnStopRef.current = 0

    const mimeType = resolveVoiceRecorderMimeType()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      voiceStreamRef.current = stream

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      voiceRecorderRef.current = recorder
      setIsRecordingVoice(true)

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          voiceChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        setErrorText('Ошибка записи голосового сообщения')
        clearVoiceRecordingTimers()
        setIsRecordingVoice(false)
        setVoiceRecordingElapsedMs(0)
        stopVoiceStreamTracks()
      }

      recorder.onstop = () => {
        clearVoiceRecordingTimers()
        setIsRecordingVoice(false)
        stopVoiceStreamTracks()
        const durationMs = Math.min(
          voiceDurationOnStopRef.current || voiceElapsedMsRef.current,
          VOICE_NOTE_MAX_DURATION_MS,
        )
        setVoiceRecordingElapsedMs(0)
        voiceElapsedMsRef.current = 0
        const shouldUpload = voiceShouldUploadOnStopRef.current
        const chunks = [...voiceChunksRef.current]
        voiceChunksRef.current = []
        voiceRecorderRef.current = null

        if (!shouldUpload || chunks.length === 0) return
        if (durationMs <= 0) {
          setErrorText('Не удалось определить длительность голосового сообщения')
          return
        }

        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm'
        const extension = getVoiceFileExtension(finalMimeType)
        const voiceBlob = new Blob(chunks, { type: finalMimeType })
        const voiceFile = new File([voiceBlob], `voice-${Date.now()}.${extension}`, { type: finalMimeType })
        void uploadComposerAttachment(voiceFile, 'voice', { durationMs })
      }

      recorder.start(VOICE_NOTE_TICK_MS)
      voiceTickTimerRef.current = window.setInterval(() => {
        setVoiceRecordingElapsedMs((prev) => {
          const next = prev + VOICE_NOTE_TICK_MS
          voiceElapsedMsRef.current = next
          if (next >= VOICE_NOTE_MAX_DURATION_MS) {
            stopVoiceRecording(true)
            return VOICE_NOTE_MAX_DURATION_MS
          }
          return next
        })
      }, VOICE_NOTE_TICK_MS)
      voiceStopTimerRef.current = window.setTimeout(() => {
        stopVoiceRecording(true)
      }, VOICE_NOTE_MAX_DURATION_MS)
    } catch {
      clearVoiceRecordingTimers()
      setIsRecordingVoice(false)
      setVoiceRecordingElapsedMs(0)
      voiceElapsedMsRef.current = 0
      stopVoiceStreamTracks()
      setErrorText('Не удалось получить доступ к микрофону')
    }
  }

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    setIsAttachMenuOpen(false)
    const items = Array.from(event.clipboardData?.items || [])
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    if (!imageItem) return
    const pastedFile = imageItem.getAsFile()
    if (!pastedFile) return

    event.preventDefault()
    const extension = pastedFile.type.split('/')[1] || 'png'
    const file = new File([pastedFile], `screenshot-${Date.now()}.${extension}`, {
      type: pastedFile.type || 'image/png',
    })
    void uploadComposerAttachment(file, 'paste')
  }

  useEffect(() => {
    const loadChats = async () => {
      setLoadingChats(true)
      setErrorText('')
      try {
        const response = await chatApi.listChats()
        if (response.data.ok && response.data.data) {
          const nextChats = response.data.data
          setChats(nextChats)
          if (nextChats.length > 0) {
            setSelectedChatId((prev) => prev ?? nextChats[0]?.id ?? null)
          } else {
            setSelectedChatId(null)
          }
        } else {
          setChats([])
          setSelectedChatId(null)
          setErrorText(response.data.error?.message || 'Не удалось загрузить чаты')
        }
      } catch (e) {
        setChats([])
        setSelectedChatId(null)
        setErrorText(extractApiError(e, 'Не удалось загрузить чаты'))
      } finally {
        setLoadingChats(false)
      }
    }
    void loadChats()
  }, [])

  useEffect(() => {
    adjustComposerHeight()
  }, [draft])

  useEffect(() => {
    const loadMessages = async () => {
      if (!selectedChatId) {
        setMessages([])
        setChatMembers([])
        setPresence({})
        setTypingUsers({})
        setReplyToMessageId(null)
        setMenuOpenMessageId(null)
        setAckedOwnMessages({})
        setNewMessagesCount(0)
        setHasMoreMessages(true)
        return
      }
      setLoadingMessages(true)
      setLoadingOlderMessages(false)
      setHasMoreMessages(true)
      setErrorText('')
      try {
        const [messagesResponse, membersResponse, presenceResponse] = await Promise.all([
          chatApi.listMessages(selectedChatId, {
            limit: MESSAGE_PAGE_SIZE,
            latest: true,
          }),
          chatApi.listMembers(selectedChatId),
          chatApi.getPresence(selectedChatId),
        ])
        if (messagesResponse.data.ok && messagesResponse.data.data) {
          const nextMessages = messagesResponse.data.data
          setMessages(nextMessages)
          setHasMoreMessages(nextMessages.length === MESSAGE_PAGE_SIZE)
          const ownDelivered = Object.fromEntries(
            nextMessages
              .filter((message) => message.sender_id === user?.id)
              .map((message) => [message.id, true]),
          )
          setAckedOwnMessages(ownDelivered)
          setNewMessagesCount(0)
          const lastSeqNo = nextMessages[nextMessages.length - 1]?.seq_no
          if (typeof lastSeqNo === 'number') {
            await chatApi.updateReadCursor(selectedChatId, { last_read_seq_no: lastSeqNo })
          }
          requestAnimationFrame(scrollMessagesToBottom)
        } else {
          setMessages([])
          setHasMoreMessages(true)
          setErrorText(messagesResponse.data.error?.message || 'Не удалось загрузить сообщения')
        }

        if (membersResponse.data.ok && membersResponse.data.data) {
          setChatMembers(membersResponse.data.data)
        } else {
          setChatMembers([])
        }

        if (presenceResponse.data.ok && presenceResponse.data.data) {
          setPresence(presenceResponse.data.data)
        } else {
          setPresence({})
        }
      } catch (e) {
        setMessages([])
        setChatMembers([])
        setPresence({})
        setTypingUsers({})
        setAckedOwnMessages({})
        setHasMoreMessages(true)
        setErrorText(extractApiError(e, 'Не удалось загрузить сообщения'))
      } finally {
        setLoadingMessages(false)
      }
    }
    void loadMessages()
  }, [selectedChatId])

  useEffect(() => {
    if (!selectedChatId) return
    let cancelled = false
    const refreshPresence = async () => {
      try {
        const response = await chatApi.getPresence(selectedChatId)
        if (!cancelled && response.data.ok && response.data.data) {
          setPresence(response.data.data)
        }
      } catch {
        // ignore background presence polling errors
      }
    }

    void refreshPresence()
    const intervalId = window.setInterval(() => {
      void refreshPresence()
    }, 20_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [selectedChatId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTypingUsers((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, expiresAt]) => expiresAt > now))
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current)
      }
      if (selectedChatIdRef.current) {
        void chatApi.sendTyping(selectedChatIdRef.current, false)
      }
    }
  }, [])

  const loadOlderMessages = async () => {
    if (!selectedChatId || loadingMessages || loadingOlderMessages || !hasMoreMessages || messages.length === 0) return
    const beforeSeqNo = messages[0]?.seq_no
    if (typeof beforeSeqNo !== 'number') return

    const viewport = messagesViewportRef.current
    const prevScrollHeight = viewport?.scrollHeight ?? 0
    const prevScrollTop = viewport?.scrollTop ?? 0

    setLoadingOlderMessages(true)
    setErrorText('')
    try {
      const response = await chatApi.listMessages(selectedChatId, {
        limit: MESSAGE_PAGE_SIZE,
        before_seq_no: beforeSeqNo,
      })
      if (response.data.ok && response.data.data) {
        const older = response.data.data
        setMessages((prev) => {
          const existingIds = new Set(prev.map((x) => x.id))
          const uniqueOlder = older.filter((x) => !existingIds.has(x.id))
          return [...uniqueOlder, ...prev]
        })
        setHasMoreMessages(older.length === MESSAGE_PAGE_SIZE)

        requestAnimationFrame(() => {
          const el = messagesViewportRef.current
          if (!el) return
          const newScrollHeight = el.scrollHeight
          el.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop
        })
      } else {
        setErrorText(response.data.error?.message || 'Не удалось загрузить предыдущие сообщения')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось загрузить предыдущие сообщения'))
    } finally {
      setLoadingOlderMessages(false)
    }
  }

  const handleMessagesScroll = () => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
    setIsNearBottom(nearBottom)
    if (nearBottom && newMessagesCount > 0) {
      setNewMessagesCount(0)
    }
    if (viewport.scrollTop <= 64) {
      void loadOlderMessages()
    }
  }

  const sendTypingEvent = (isTyping: boolean) => {
    if (!selectedChatId) return
    void chatApi.sendTyping(selectedChatId, isTyping)
  }

  const touchTypingActivity = () => {
    if (!selectedChatId) return
    const now = Date.now()
    if (now - lastTypingSentAtRef.current > 1200) {
      sendTypingEvent(true)
      lastTypingSentAtRef.current = now
    }
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current)
    }
    typingStopTimerRef.current = window.setTimeout(() => {
      sendTypingEvent(false)
      typingStopTimerRef.current = null
    }, 1800)
  }

  const stopTyping = () => {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
    }
    sendTypingEvent(false)
  }

  const scrollToLatest = () => {
    requestAnimationFrame(scrollMessagesToBottom)
    setNewMessagesCount(0)
  }

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const response = await chatApi.deleteMessage(messageId)
      if (response.data.ok) {
        setMessages((prev) => prev.filter((message) => message.id !== messageId))
        setMenuOpenMessageId(null)
      } else {
        setErrorText(response.data.error?.message || 'Не удалось удалить сообщение')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось удалить сообщение'))
    }
  }

  const handleCopyMessage = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMenuOpenMessageId(null)
    } catch {
      setErrorText('Не удалось скопировать сообщение')
    }
  }

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let pingTimer: number | null = null
    let closedByEffectCleanup = false

    const clearTimers = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer)
        pingTimer = null
      }
    }

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const wsUrl = `${protocol}://${window.location.host}/api/v1/ws/notifications`
      socket = new WebSocket(wsUrl)

      socket.onopen = () => {
        clearTimers()
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send('ping')
          }
        }, 25_000)
      }

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        if (event.data === 'pong') return

        try {
          const payload = JSON.parse(event.data) as {
            type?: string
            chat_id?: string
            message?: ChatMessageInfo
            user_id?: string
            is_typing?: boolean
            last_read_seq_no?: number
          }
          if (payload.type === 'chat.message.created' && payload.chat_id && payload.message) {
            const incomingMessage = payload.message
            setChats((prev) => {
              const index = prev.findIndex((x) => x.id === payload.chat_id)
              if (index === -1) return prev
              const next = [...prev]
              const chat = next[index]
              if (!chat) return prev
              const updatedChat: ChatInfo = {
                ...chat,
                updated_at: incomingMessage.created_at,
              }
              next.splice(index, 1)
              next.unshift(updatedChat)
              return next
            })

            if (selectedChatIdRef.current !== payload.chat_id) return
            const viewport = messagesViewportRef.current
            const shouldStickToBottom = viewport
              ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
              : false
            setMessages((prev) => {
              if (prev.some((x) => x.id === incomingMessage.id)) return prev
              return [...prev, incomingMessage]
            })
            if (incomingMessage.sender_id === user?.id) {
              setAckedOwnMessages((prev) => ({ ...prev, [incomingMessage.id]: true }))
            }
            if (shouldStickToBottom) {
              requestAnimationFrame(scrollMessagesToBottom)
            } else {
              setNewMessagesCount((prev) => prev + 1)
            }
            return
          }

          if (payload.type === 'chat.typing.updated' && payload.chat_id === selectedChatIdRef.current && payload.user_id) {
            if (payload.user_id === user?.id) return
            if (payload.is_typing) {
              setTypingUsers((prev) => ({ ...prev, [payload.user_id!]: Date.now() + TYPING_TTL_MS }))
            } else {
              setTypingUsers((prev) => {
                const next = { ...prev }
                delete next[payload.user_id!]
                return next
              })
            }
            return
          }

          if (
            payload.type === 'chat.read.cursor.updated'
            && payload.chat_id === selectedChatIdRef.current
            && payload.user_id
            && typeof payload.last_read_seq_no === 'number'
          ) {
            setChatMembers((prev) =>
              prev.map((member) =>
                member.user_id === payload.user_id
                  ? { ...member, last_read_seq_no: Math.max(member.last_read_seq_no, payload.last_read_seq_no!) }
                  : member,
              ),
            )
          }
        } catch {
          // Ignore non-JSON and unrelated ws frames.
        }
      }

      socket.onerror = () => {
        socket?.close()
      }

      socket.onclose = () => {
        clearTimers()
        if (closedByEffectCleanup) return
        reconnectTimer = window.setTimeout(connect, 3000)
      }
    }

    connect()
    return () => {
      closedByEffectCleanup = true
      clearTimers()
      socket?.close()
    }
  }, [])

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) => {
      if (newChatType === 'direct') {
        if (prev.includes(memberId)) return []
        return [memberId]
      }
      if (prev.includes(memberId)) return prev.filter((x) => x !== memberId)
      return [...prev, memberId]
    })
  }

  useEffect(() => {
    if (newChatType !== 'direct') return
    setSelectedMemberIds((prev) => (prev.length > 1 ? [prev[0]!] : prev))
    setNewChatTitle('')
  }, [newChatType])

  const handleCreateChat = async () => {
    if (creatingChat) return
    if (newChatType !== 'direct' && !newChatTitle.trim()) {
      setErrorText('Укажите название чата')
      return
    }
    if (newChatType === 'direct' && selectedMemberIds.length !== 1) {
      setErrorText('Для личного чата выберите одного участника')
      return
    }

    setCreatingChat(true)
    setErrorText('')
    try {
      const response = await chatApi.createChat({
        chat_type: newChatType,
        title: newChatType === 'direct' ? undefined : newChatTitle.trim() || undefined,
        member_ids: selectedMemberIds,
      })
      if (response.data.ok && response.data.data) {
        const created = response.data.data
        setChats((prev) => [created, ...prev])
        setSelectedChatId(created.id)
        setNewChatTitle('')
        setNewChatType('group')
        setSelectedMemberIds([])
        setCreateChatOpen(false)
      } else {
        setErrorText(response.data.error?.message || 'Не удалось создать чат')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось создать чат'))
    } finally {
      setCreatingChat(false)
    }
  }

  const handleSend = async () => {
    const trimmedDraft = draft.trim()
    if (!selectedChatId || sending) return
    setIsAttachMenuOpen(false)
    if (isRecordingVoice) {
      setErrorText('Сначала остановите запись голосового')
      return
    }
    if (hasUploadingAttachments) {
      setErrorText('Дождитесь завершения загрузки вложений')
      return
    }
    if (!trimmedDraft && readyComposerAttachments.length === 0) return
    if (trimmedDraft.length > MESSAGE_MAX_CHARS) {
      setErrorText(`Сообщение не должно превышать ${MESSAGE_MAX_CHARS} символов`)
      return
    }
    setSending(true)
    setErrorText('')
    try {
      const attachmentIds = readyComposerAttachments.map((attachment) => attachment.fileId)
      const voiceAttachment = readyComposerAttachments.find((attachment) => isVoiceAttachment(attachment.contentType)) || null
      const meta: ChatMessageMeta | undefined =
        replyToMessageId || attachmentIds.length > 0 || Boolean(voiceAttachment)
          ? {
              ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
              ...(attachmentIds.length > 0 ? { attachment_ids: attachmentIds } : {}),
              ...(voiceAttachment
                ? {
                    voice_note: {
                      file_id: voiceAttachment.fileId,
                      duration_ms: Math.min(
                        VOICE_NOTE_MAX_DURATION_MS,
                        Math.max(1, voiceAttachment.durationMs || VOICE_NOTE_MAX_DURATION_MS),
                      ),
                    },
                  }
                : {}),
            }
          : undefined
      const response = await chatApi.sendMessage(selectedChatId, { body: trimmedDraft, meta })
      if (response.data.ok && response.data.data) {
        const created = response.data.data
        setMessages((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]))
        if (created.sender_id === user?.id) {
          setAckedOwnMessages((prev) => ({ ...prev, [created.id]: false }))
        }
        setDraft('')
        setReplyToMessageId(null)
        resetComposerAttachments()
        stopTyping()
        requestAnimationFrame(scrollMessagesToBottom)
        await chatApi.updateReadCursor(selectedChatId, { last_read_seq_no: created.seq_no })
        setChatMembers((prev) =>
          prev.map((member) =>
            member.user_id === user?.id
              ? { ...member, last_read_seq_no: Math.max(member.last_read_seq_no, created.seq_no) }
              : member,
          ),
        )
      } else {
        setErrorText(response.data.error?.message || 'Не удалось отправить сообщение')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось отправить сообщение'))
    } finally {
      setSending(false)
    }
  }

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
    setIsMobileDialogsOpen(false)
  }

  const renderChatList = (compact: boolean) => {
    if (loadingChats) {
      return <div className="p-2 text-sm text-muted-foreground">Загрузка...</div>
    }
    if (chats.length === 0) {
      return <div className="p-2 text-sm text-muted-foreground">Чатов пока нет</div>
    }

    return chats.map((chat) => {
      const isActive = chat.id === selectedChatId
      const title = getChatDisplayTitle(chat)

      if (compact) {
        const compactLabel = getInitials(title).slice(0, 1)
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => handleSelectChat(chat.id)}
            title={title}
            className={`mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold transition ${
              isActive
                ? 'border-primary/50 bg-primary/15 text-primary'
                : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/30'
            }`}
          >
            {compactLabel}
          </button>
        )
      }

      return (
        <button
          key={chat.id}
          type="button"
          onClick={() => handleSelectChat(chat.id)}
          className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-sm transition ${
            isActive
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-transparent hover:border-border hover:bg-muted/40'
          }`}
        >
          <div className="truncate font-medium">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {chatTypeLabel(chat.chat_type)} · {chat.member_ids.length} участников
          </div>
        </button>
      )
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Чат</h1>
        <Button
          type="button"
          size="icon"
          onClick={() => setCreateChatOpen(true)}
          aria-label="Создать чат"
          title="Создать чат"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {errorText && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {createChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreateChatOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Создание чата"
            className="w-full max-w-xl border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Создать чат</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setCreateChatOpen(false)}
                aria-label="Закрыть окно создания чата"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Тип</label>
                <select
                  value={newChatType}
                  onChange={(e) => {
                    const value = e.target.value as 'direct' | 'group' | 'channel'
                    setNewChatType(value)
                    if (value === 'direct') {
                      setNewChatTitle('')
                      setSelectedMemberIds((prev) => prev.slice(0, 1))
                    }
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="group">Группа</option>
                  <option value="direct">Личный чат</option>
                  <option value="channel">Канал</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Название</label>
                <Input
                  value={newChatTitle}
                  onChange={(e) => setNewChatTitle(e.target.value)}
                  placeholder={newChatType === 'direct' ? 'Для личного чата не обязательно' : 'Название чата'}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Участники {newChatType === 'direct' ? '(выберите одного)' : '(опционально)'}
                </label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                  {members
                    .filter((m) => m.user_id !== user?.id)
                    .map((m) => {
                      const caption = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id
                      const checked = selectedMemberIds.includes(m.user_id)
                      return (
                        <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                          <input
                            type={newChatType === 'direct' ? 'radio' : 'checkbox'}
                            name={newChatType === 'direct' ? 'direct-chat-member' : undefined}
                            checked={checked}
                            onChange={() => handleToggleMember(m.user_id)}
                          />
                          <span className="truncate">{caption}</span>
                        </label>
                      )
                    })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateChatOpen(false)} disabled={creatingChat}>
                  Отмена
                </Button>
                <Button type="button" onClick={handleCreateChat} disabled={creatingChat}>
                  {creatingChat ? 'Создание...' : 'Создать чат'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Диалоги</CardTitle>
          <Button
            type="button"
            className="h-8 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs text-primary hover:bg-primary/20 lg:hidden"
            variant="ghost"
            onClick={() => setIsMobileDialogsOpen(true)}
            aria-label="Открыть диалоги"
          >
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            Чаты
          </Button>
        </CardHeader>
        <CardContent className="relative h-[70vh] min-h-[520px] max-h-[760px] p-0">
          <div className={`relative h-full min-h-0 p-4 ${isDesktopSidebarCollapsed ? 'lg:pl-16' : ''}`}>
            {isDesktopSidebarCollapsed ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute left-4 top-6 z-30 hidden h-9 w-9 rounded-full border border-border/70 bg-background/90 shadow-sm backdrop-blur lg:flex"
                onClick={() => setIsDesktopSidebarCollapsed(false)}
                aria-label="Открыть панель чатов"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Закрыть панель чатов"
                  onClick={() => setIsDesktopSidebarCollapsed(true)}
                  className="absolute inset-0 z-10 hidden bg-black/20 lg:block"
                />
                <div className="absolute inset-y-4 left-4 z-20 hidden w-[280px] lg:block">
                  <div className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background/95 shadow-xl backdrop-blur">
                    <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                      <span className="text-xs text-muted-foreground">Чаты</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setIsDesktopSidebarCollapsed(true)}
                        aria-label="Свернуть панель чатов"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                      {renderChatList(false)}
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="flex h-full min-h-0 min-w-0 flex-col rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {selectedChat ? getChatDisplayTitle(selectedChat) : 'Выберите чат'}
                    </div>
                    {selectedChat && (
                      isMobileViewport ? (
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <div className="flex -space-x-1">
                            {selectedChatMembers.slice(0, 3).map((member) => (
                              <span
                                key={member.userId}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-muted/20 text-[9px] font-medium"
                                title={member.label}
                              >
                                {member.initials}
                              </span>
                            ))}
                          </div>
                          <span>{selectedChatMembers.length} участников</span>
                          <span className="text-emerald-400">
                            {selectedChatMembers.filter((member) => member.online).length} онлайн
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {selectedChatMembers.slice(0, 5).map((member) => (
                              <span key={member.userId} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${member.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                                <span className="max-w-[120px] truncate">{member.label}</span>
                              </span>
                            ))}
                          </div>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Онлайн: {selectedChatMembers.filter((member) => member.online).length}/{selectedChatMembers.length}
                          </div>
                        </>
                      )
                    )}
                    {typingLabels.length > 0 && (
                      <div className="mt-1 text-[11px] text-primary">
                        {typingLabels.join(', ')} печатает...
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" onClick={() => setSearchOpen((prev) => !prev)} aria-label="Поиск по сообщениям">
                      <Search className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {searchOpen && (
                  <div className="mt-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Поиск в текущем чате..."
                    />
                  </div>
                )}
              </div>

              <div
                ref={messagesViewportRef}
                onScroll={handleMessagesScroll}
                className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
              >
                {loadingOlderMessages && (
                  <div className="pb-1 text-center text-xs text-muted-foreground">Загрузка предыдущих сообщений...</div>
                )}
                {!selectedChat ? (
                  <div className="text-sm text-muted-foreground">{isMobileViewport ? 'Откройте список через кнопку "Чаты"' : 'Откройте чат слева'}</div>
                ) : loadingMessages ? (
                  <div className="text-sm text-muted-foreground">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Сообщений пока нет</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Поиск не дал результатов</div>
                ) : (
                  <>
                    {!hasMoreMessages && (
                      <div className="pb-1 text-center text-xs text-muted-foreground">Начало переписки</div>
                    )}
                    {visibleMessages.map((message, index) => {
                      const own = message.sender_id === user?.id
                      const prev = visibleMessages[index - 1]
                      const showDayDivider = !prev || toDayKey(prev.created_at) !== toDayKey(message.created_at)
                      const senderLabel = getMessageOwnerLabel(message)
                      const ownStatus = getOwnMessageStatus(message)
                      const attachments = getMessageAttachments(message)
                      const hasAttachments = attachments.length > 0
                      const bodyText = message.body.trim()
                      const hasBody = bodyText.length > 0
                      const syntheticAttachmentBody = hasAttachments && attachments.length === 1 && bodyText === attachments[0]?.original_name
                      const shouldRenderBody = hasBody && !syntheticAttachmentBody
                      const expanded = Boolean(expandedMessages[message.id])
                      const expandable = shouldRenderBody && isExpandableMessage(message.body)
                      const metaReplyToId = message.meta?.reply_to_message_id
                      const replyTarget = metaReplyToId ? messages.find((m) => m.id === metaReplyToId) || null : null
                      const showMenu = menuOpenMessageId === message.id
                      const replyPreviewText = replyTarget
                        ? (() => {
                          const replyAttachments = getMessageAttachments(replyTarget)
                          const replyBody = replyTarget.body.trim()
                          const isSyntheticReplyBody =
                              replyAttachments.length === 1 && replyBody === replyAttachments[0]?.original_name
                          return (!isSyntheticReplyBody && replyBody) || (replyAttachments.length > 0 ? 'Вложение' : '')
                        })()
                        : ''

                      return (
                        <div key={message.id}>
                          {showDayDivider && (
                            <div className="my-2 text-center text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border/60 px-2 py-0.5">{formatDayDivider(message.created_at)}</span>
                            </div>
                          )}
                          <div className={`group flex w-full ${own ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-fit ${own ? 'max-w-[82%] sm:max-w-[62%] text-right' : 'max-w-[90%] sm:max-w-[68%] text-left'}`}>
                              {!own && (
                                <div className="mb-1 flex items-center gap-2 px-1">
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                                    {getInitials(senderLabel)}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">{senderLabel}</div>
                                </div>
                              )}
                              <div
                                className={`relative w-fit max-w-full rounded-xl border px-3 py-2 text-sm ${
                                  own
                                    ? 'ml-auto border-primary/35 bg-primary/[0.14] text-right'
                                    : 'mr-auto border-border/70 bg-muted/25 text-left'
                                }`}
                              >
                                {replyTarget && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const indexInFull = messages.findIndex((m) => m.id === replyTarget.id)
                                      if (indexInFull >= 0) {
                                        setExpandedMessages((prev) => ({ ...prev, [replyTarget.id]: true }))
                                      }
                                    }}
                                    className={`mb-2 block w-full overflow-hidden rounded border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground ${
                                      own ? 'text-right' : 'text-left'
                                    }`}
                                  >
                                    <div>Ответ на: {(membersById.get(replyTarget.sender_id) || replyTarget.sender_id)} ·</div>
                                    <div className="mt-0.5 break-all">
                                      {replyPreviewText.slice(0, 80)}
                                      {replyPreviewText.length > 80 ? '…' : ''}
                                    </div>
                                  </button>
                                )}

                                {shouldRenderBody && (
                                  <div
                                    className={`whitespace-pre-wrap break-all ${expandable && !expanded ? 'max-h-28 overflow-hidden' : ''} ${
                                      own ? 'text-right' : 'text-left'
                                    }`}
                                  >
                                    {message.body}
                                  </div>
                                )}
                                {expandable && (
                                  <button
                                    type="button"
                                    onClick={() => toggleMessageExpanded(message.id)}
                                    className={`mt-1 text-[11px] text-primary hover:underline ${own ? 'ml-auto block text-right' : ''}`}
                                  >
                                    {expanded ? 'Свернуть' : 'Развернуть'}
                                  </button>
                                )}

                                {hasAttachments && (
                                  <div className={`mt-2 space-y-2 ${own ? 'text-right' : 'text-left'}`}>
                                    {attachments.map((attachment) => (
                                      <AttachmentPreview
                                        key={attachment.file_id}
                                        chatId={message.chat_id}
                                        attachment={attachment}
                                        onOpenMediaPreview={setMediaPreview}
                                      />
                                    ))}
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setMenuOpenMessageId((prev) => (prev === message.id ? null : message.id))}
                                  className={`absolute top-1 hidden rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-background/40 group-hover:block ${
                                    own ? 'right-1' : 'left-1'
                                  }`}
                                  aria-label="Действия с сообщением"
                                >
                                  ⋯
                                </button>
                                {showMenu && (
                                  <div
                                    className={`absolute top-7 z-20 min-w-[150px] rounded-md border border-border/70 bg-background p-1 shadow-lg ${
                                      own ? 'right-1' : 'left-1'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => void handleCopyMessage(message.body)}
                                      className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                                    >
                                      Копировать
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplyToMessageId(message.id)
                                        setMenuOpenMessageId(null)
                                        composerRef.current?.focus()
                                      }}
                                      className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted/40"
                                    >
                                      Ответить
                                    </button>
                                    {own && (
                                      <button
                                        type="button"
                                        onClick={() => void handleDeleteMessage(message.id)}
                                        className="w-full rounded px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
                                      >
                                        Удалить
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className={`mt-1 px-1 text-[10px] text-muted-foreground ${own ? 'text-right' : 'text-left'}`}>
                                #{message.seq_no} · {new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                {ownStatus && ` · ${ownStatus}`}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
                {newMessagesCount > 0 && !isNearBottom && (
                  <div className="sticky bottom-2 mt-2 flex justify-center">
                    <Button type="button" size="sm" onClick={scrollToLatest} className="h-8 rounded-full px-3">
                      <ArrowDown className="mr-1 h-3.5 w-3.5" />
                      {newMessagesCount} новых
                    </Button>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 border-t border-border/60 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                {replyToMessage && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-xs">
                    <div className="truncate">
                      Ответ на: <span className="text-muted-foreground">{getMessageOwnerLabel(replyToMessage)}</span> ·{' '}
                      {replyToMessage.body.trim() || (getMessageAttachments(replyToMessage).length > 0 ? 'Вложение' : '')}
                    </div>
                    <button type="button" onClick={() => setReplyToMessageId(null)} className="ml-2 rounded px-1 hover:bg-muted/50">
                      ×
                    </button>
                  </div>
                )}

                {composerAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {composerAttachments.map((attachment) => {
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
                          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
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
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="mb-2 hidden text-[11px] text-muted-foreground sm:block">
                  До {CHAT_ATTACHMENT_MAX_MB} MB, 1 вложение на сообщение. Голосовое до 1 минуты.
                </div>
                {isRecordingVoice && (
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                    Идет запись: {formatDurationLabel(voiceRecordingElapsedMs)} / 01:00
                  </div>
                )}

                <input
                  ref={mediaAttachmentInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(event) => void handleMediaInputChange(event)}
                />
                <input
                  ref={cameraPhotoAttachmentInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => void handleCameraPhotoInputChange(event)}
                />
                <input
                  ref={cameraVideoAttachmentInputRef}
                  type="file"
                  accept="video/*"
                  capture="environment"
                  className="hidden"
                  onChange={(event) => void handleCameraVideoInputChange(event)}
                />
                <input
                  ref={fileAttachmentInputRef}
                  type="file"
                  className="hidden"
                  onChange={(event) => void handleFileInputChange(event)}
                />

                <div className="relative flex items-end gap-2" ref={attachMenuRef}>
                  <div className="relative shrink-0">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-10 w-10 rounded-full"
                      onClick={() => setIsAttachMenuOpen((prev) => !prev)}
                      disabled={!selectedChatId || sending || isRecordingVoice || composerAttachments.length >= 1 || hasUploadingAttachments}
                      aria-label="Открыть меню вложений"
                      title="Вложения"
                    >
                      <Plus className="h-5 w-5" />
                    </Button>
                    {isAttachMenuOpen && (
                      <div className="absolute bottom-12 left-0 z-40 w-[min(280px,calc(100vw-4rem))] rounded-xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur">
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                            onClick={openMediaPicker}
                          >
                            <Image className="h-4 w-4" />
                            Фото/Видео
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                            onClick={openCameraPhotoPicker}
                          >
                            <Camera className="h-4 w-4" />
                            Камера
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                            onClick={openCameraVideoPicker}
                          >
                            <Video className="h-4 w-4" />
                            Видео
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                            onClick={openFilePicker}
                          >
                            <Paperclip className="h-4 w-4" />
                            Файл
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      touchTypingActivity()
                    }}
                    maxLength={MESSAGE_MAX_CHARS}
                    rows={1}
                    placeholder={selectedChat ? 'Пишите сообщение' : 'Выберите чат'}
                    disabled={!selectedChat || sending || isRecordingVoice}
                    className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onBlur={() => stopTyping()}
                    onPaste={handleComposerPaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && (draft.trim().length > 0 || readyComposerAttachments.length > 0)) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                  />
                  {isRecordingVoice ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="destructive"
                      className="h-10 w-10 rounded-full"
                      onClick={() => stopVoiceRecording(true)}
                      aria-label="Остановить запись голосового"
                      title="Стоп запись"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : canSendMessage ? (
                    <Button
                      type="button"
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      onClick={() => void handleSend()}
                      disabled={sending || draft.trim().length > MESSAGE_MAX_CHARS || hasUploadingAttachments}
                      aria-label="Отправить сообщение"
                      title="Отправить"
                    >
                      <SendHorizontal className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-10 w-10 rounded-full"
                      onClick={() => void startVoiceRecording()}
                      disabled={!selectedChatId || sending || composerAttachments.length >= 1 || hasUploadingAttachments}
                      aria-label="Записать голосовое сообщение"
                      title="Голосовое"
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {selectedChat && (
                  <div className="mt-2 text-right text-xs text-muted-foreground">
                    {draft.trim().length}/{MESSAGE_MAX_CHARS}
                  </div>
                )}
              </div>
            </div>
          </div>

          {mediaPreview && (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4"
              onClick={() => setMediaPreview(null)}
            >
              <div
                className="relative w-full max-w-6xl rounded-xl border border-white/20 bg-black/40 p-3"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  onClick={() => setMediaPreview(null)}
                  aria-label="Закрыть просмотр"
                >
                  <X className="h-5 w-5" />
                </button>
                {mediaPreview.kind === 'image' ? (
                  <img
                    src={mediaPreview.url}
                    alt={mediaPreview.originalName}
                    className="mx-auto max-h-[82vh] max-w-full rounded-lg object-contain"
                  />
                ) : (
                  <video
                    src={mediaPreview.url}
                    controls
                    autoPlay
                    className="mx-auto max-h-[82vh] max-w-full rounded-lg"
                  >
                    Ваш браузер не поддерживает видео.
                  </video>
                )}
              </div>
            </div>
          )}

          {isMobileDialogsOpen && (
            <div
              className="fixed inset-0 z-50 lg:hidden"
              onClick={() => setIsMobileDialogsOpen(false)}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" />
              <div className="absolute inset-y-0 left-0 w-[88vw] max-w-[340px] p-3" onClick={(e) => e.stopPropagation()}>
                <div className="flex h-full min-h-0 flex-col rounded-xl border border-border/70 bg-background shadow-2xl">
                  <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Чаты</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setIsMobileDialogsOpen(false)}
                      aria-label="Закрыть список диалогов"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {renderChatList(false)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
