import { type DragEvent as ReactDragEvent } from 'react'
import { type DocsAIGenerationJob, type DocsAIGenerationJobStatus, type DocsFile, type DocsFolder } from '@/lib/api'

export const MAX_DEPTH = 2
export const STATUS_POLL_INTERVAL_MS = 2000
export const STATUS_POLL_TIMEOUT_MS = 120000
export const AI_JOB_POLL_INTERVAL_MS = 2000
export const AI_JOB_POLL_TIMEOUT_MS = 180000
export const AI_JOB_HISTORY_LIMIT = 30

export type DocsVisualStatus = DocsFile['status'] | 'ai_queued' | 'ai_running' | 'ai_scanning' | 'ai_failed'

export function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function depthOf(folderId: string, map: Map<string, DocsFolder>): number {
  let depth = 0
  let cursor = map.get(folderId)
  while (cursor?.parent_id) {
    depth += 1
    cursor = map.get(cursor.parent_id)
  }
  return depth
}

export function isFolderInOwnBranch(
  folderId: string,
  candidateParentId: string | null,
  map: Map<string, DocsFolder>,
): boolean {
  if (!candidateParentId) return false
  if (folderId === candidateParentId) return true
  let cursor = map.get(candidateParentId)
  while (cursor?.parent_id) {
    if (cursor.parent_id === folderId) return true
    cursor = map.get(cursor.parent_id)
  }
  return false
}

export function fileTypeLabel(file: DocsFile): string {
  return (file.type || 'file').toUpperCase()
}

export function statusLabel(status: DocsFile['status']): string {
  if (status === 'uploading') return 'Загрузка'
  if (status === 'scanning') return 'На проверке'
  if (status === 'ready') return 'Готов'
  if (status === 'blocked') return 'Заблокирован'
  if (status === 'draft') return 'Генерируется'
  return status || 'unknown'
}

export function statusClass(status: DocsVisualStatus): string {
  if (status === 'ready') return 'text-emerald-600'
  if (
    status === 'scanning' ||
    status === 'uploading' ||
    status === 'draft' ||
    status === 'ai_queued' ||
    status === 'ai_running' ||
    status === 'ai_scanning'
  ) {
    return 'text-amber-600'
  }
  if (status === 'blocked' || status === 'ai_failed') return 'text-destructive'
  return 'text-muted-foreground'
}

export function aiJobStatusLabel(status: DocsAIGenerationJobStatus): string {
  if (status === 'queued') return 'В очереди'
  if (status === 'running') return 'Генерация'
  if (status === 'scanning') return 'Проверка AV'
  if (status === 'ready') return 'Готово'
  if (status === 'blocked') return 'Заблокирован'
  if (status === 'failed') return 'Ошибка'
  return status
}

export function aiJobStatusClass(status: DocsAIGenerationJobStatus): string {
  if (status === 'ready') return 'text-emerald-600'
  if (status === 'scanning' || status === 'running' || status === 'queued') return 'text-amber-600'
  return 'text-destructive'
}

export function isStoppedAiJob(job: DocsAIGenerationJob): boolean {
  if (job.error_message?.trim() === 'Остановлено пользователем') return true
  return Boolean(job.meta_json && typeof job.meta_json === 'object' && job.meta_json.stopped_by_user === true)
}

export function aiJobDisplayLabel(job: DocsAIGenerationJob): string {
  if (isStoppedAiJob(job)) return 'Остановлено'
  return aiJobStatusLabel(job.status)
}

export function aiJobDisplayClass(job: DocsAIGenerationJob): string {
  if (isStoppedAiJob(job)) return 'text-muted-foreground'
  return aiJobStatusClass(job.status)
}

export function isActiveAiJob(job: DocsAIGenerationJob): boolean {
  return job.status === 'queued' || job.status === 'running'
}

export function isInProgressAiJob(job: DocsAIGenerationJob): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'scanning'
}

export function visualStatusLabel(status: DocsVisualStatus): string {
  if (status === 'ai_queued') return 'В очереди'
  if (status === 'ai_running') return 'Генерация'
  if (status === 'ai_scanning') return 'Проверка AV'
  if (status === 'ai_failed') return 'Ошибка генерации'
  return statusLabel(status)
}

export function deriveFileVisualState(file: DocsFile, job: DocsAIGenerationJob | null): {
  status: DocsVisualStatus
  helperText: string | null
} {
  if (!job || job.file_id !== file.id) {
    if (file.status === 'scanning') {
      return {
        status: 'scanning',
        helperText: 'Файл на проверке. Скачивание будет доступно после сканирования.',
      }
    }
    if (file.status === 'blocked') {
      return {
        status: 'blocked',
        helperText: 'Заблокирован. Обратитесь к администратору.',
      }
    }
    return { status: file.status, helperText: null }
  }

  if (job.status === 'failed') {
    return {
      status: 'ai_failed',
      helperText: job.error_message?.trim() || 'AI-генерация завершилась ошибкой.',
    }
  }
  if (job.status === 'queued') {
    return {
      status: 'ai_queued',
      helperText: 'Документ принят в очередь на генерацию.',
    }
  }
  if (job.status === 'running') {
    return {
      status: 'ai_running',
      helperText: 'AI сейчас готовит содержимое документа.',
    }
  }
  if (job.status === 'scanning') {
    return {
      status: 'ai_scanning',
      helperText: 'Документ сгенерирован и проходит антивирусную проверку.',
    }
  }
  if (job.status === 'blocked') {
    return {
      status: 'blocked',
      helperText: 'Сгенерированный документ заблокирован после проверки.',
    }
  }
  if (file.status === 'ready') {
    return { status: 'ready', helperText: null }
  }
  return { status: file.status, helperText: null }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function resolveDraggedDocsPayload(
  event: ReactDragEvent<HTMLElement>,
  draggedFileId: string | null,
  draggedFolderId: string | null,
): { fileId: string | null; folderId: string | null } {
  const fileId = draggedFileId?.trim() || event.dataTransfer.getData('application/x-docs-file-id').trim() || null
  const folderId = draggedFolderId?.trim() || event.dataTransfer.getData('application/x-docs-folder-id').trim() || null
  return { fileId, folderId }
}
