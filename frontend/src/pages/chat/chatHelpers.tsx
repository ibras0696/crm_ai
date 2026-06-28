import { isAxiosError } from 'axios'

import { type ChatAttachmentInfo, type ChatInfo, type ChatMessageInfo } from '@/lib/api'

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
export const CHAT_ATTACHMENT_MAX_MB = 5
export const CHAT_ATTACHMENT_MAX_BYTES = CHAT_ATTACHMENT_MAX_MB * 1024 * 1024
export const VOICE_NOTE_MAX_DURATION_MS = 60_000
export const VOICE_NOTE_TICK_MS = 250

export interface SensitiveTextScan {
  hasSensitive: boolean
  maskedText: string
  labels: string[]
}

interface SensitivePattern {
  label: string
  re: RegExp
  mask: (value: string) => string
}

function maskMiddle(value: string, visibleStart = 4, visibleEnd = 4): string {
  if (value.length <= visibleStart + visibleEnd + 3) return '••••••'
  return `${value.slice(0, visibleStart)}••••••${value.slice(-visibleEnd)}`
}

function maskUrlLikeSecret(value: string): string {
  const schemeMatch = value.match(/^([a-z][a-z0-9+.-]*:\/\/)/i)
  const scheme = schemeMatch?.[1] || ''
  const rest = scheme ? value.slice(scheme.length) : value
  return `${scheme}${maskMiddle(rest, 6, 6)}`
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    label: 'конфигурация подключения',
    re: /\b(?:vless|vmess|trojan|ss|ssr|wireguard):\/\/[^\s<>"'`]+/gi,
    mask: maskUrlLikeSecret,
  },
  {
    label: 'bearer token',
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    mask: (value) => value.replace(/^(Bearer\s+)(.+)$/i, (_all, prefix: string, token: string) => `${prefix}${maskMiddle(token, 4, 4)}`),
  },
  {
    label: 'JWT',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    mask: (value) => maskMiddle(value, 8, 8),
  },
  {
    label: 'API token',
    re: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd|token)\s*[:=]\s*[^\s,;]{8,}/gi,
    mask: (value) => value.replace(/^([^:=]+[:=]\s*)(.+)$/i, (_all, prefix: string, secret: string) => `${prefix}${maskMiddle(secret, 2, 4)}`),
  },
  {
    label: 'OpenAI token',
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    mask: (value) => maskMiddle(value, 6, 4),
  },
  {
    label: 'pairing code',
    re: /\b(pairing\s+(?:approve|code|telegram|whatsapp|connect)\s+(?:telegram\s+|whatsapp\s+)?)([A-Z0-9]{6,16})\b/gi,
    mask: (value) => value.replace(
      /\b(pairing\s+(?:approve|code|telegram|whatsapp|connect)\s+(?:telegram\s+|whatsapp\s+)?)([A-Z0-9]{6,16})\b/i,
      (_all, prefix: string, code: string) => `${prefix}${maskMiddle(code, 2, 2)}`,
    ),
  },
  {
    label: 'длинный ключ',
    re: /\b[A-Za-z0-9+/=_-]{40,}\b/g,
    mask: (value) => maskMiddle(value, 6, 6),
  },
]

export function scanSensitiveText(text: string): SensitiveTextScan {
  if (!text) return { hasSensitive: false, maskedText: text, labels: [] }

  let maskedText = text
  const labels = new Set<string>()

  for (const pattern of SENSITIVE_PATTERNS) {
    maskedText = maskedText.replace(pattern.re, (value) => {
      labels.add(pattern.label)
      return pattern.mask(value)
    })
  }

  return {
    hasSensitive: labels.size > 0,
    maskedText,
    labels: Array.from(labels),
  }
}

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

export interface MediaPreviewState {
  kind: MediaPreviewKind
  url: string
  originalName: string
}

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

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

function pickPreviewMeta(item: Record<string, unknown>): Record<string, unknown> | null {
  const value = item.preview_meta ?? item.previewMeta
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
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
    filename: pickFirstString(item, ['filename', 'name', 'title']) || undefined,
    original_name: originalName,
    content_type: contentType,
    size: parseAttachmentSize(item),
    status,
    preview_status: pickFirstString(item, ['preview_status', 'previewStatus']) || null,
    preview_content_type: pickFirstString(item, ['preview_content_type', 'previewContentType']) || null,
    preview_size: parseOptionalNumber(item.preview_size ?? item.previewSize),
    preview_meta: pickPreviewMeta(item),
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
