import { type DragEvent as ReactDragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import {
  docsApi,
  type DocsAIGenerationJob,
  type DocsAIGenerationJobStatus,
  type DocsFile,
  type DocsFileType,
  type DocsFolder,
  type DocsUsageInfo,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FileText,
  FileType2,
  Folder,
  FolderPlus,
  HardDrive,
  Loader2,
  Pencil,
  Sparkles,
  Maximize2,
  Minimize2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { DocxEditorPanel } from './DocxEditorPanel'


const MAX_DEPTH = 2
const STATUS_POLL_INTERVAL_MS = 2000
const STATUS_POLL_TIMEOUT_MS = 120000
const AI_JOB_POLL_INTERVAL_MS = 2000
const AI_JOB_POLL_TIMEOUT_MS = 180000
const AI_JOB_HISTORY_LIMIT = 30
const AI_DOCUMENT_PRESETS: Array<{
  id: string
  title: string
  template: string
  prompt: string
  summary: string
}> = [
  {
    id: 'commercial-offer',
    title: 'Коммерческое предложение',
    template: 'Коммерческое предложение',
    summary: 'Короткое предложение с этапами, выгодой и стоимостью.',
    prompt:
      'Подготовь понятное коммерческое предложение. Нужны краткое описание задачи клиента, этапы запуска, сроки, ожидаемый результат, блок с выгодами и место под стоимость и реквизиты.',
  },
  {
    id: 'service-agreement',
    title: 'Договор на услуги',
    template: 'Договор',
    summary: 'Базовая структура договора с обязанностями сторон.',
    prompt:
      'Составь базовый договор на оказание услуг. Нужны разделы: предмет договора, обязанности сторон, сроки, стоимость, порядок оплаты, ответственность, реквизиты и подписи.',
  },
  {
    id: 'internal-regulation',
    title: 'Регламент работы',
    template: 'Регламент',
    summary: 'Внутренний документ с этапами и ответственными.',
    prompt:
      'Подготовь внутренний регламент работы. Нужны цель документа, роли участников, пошаговый порядок действий, сроки реакции, контроль качества и финальный чек-лист.',
  },
  {
    id: 'instruction',
    title: 'Инструкция для сотрудников',
    template: 'Инструкция',
    summary: 'Пошаговая инструкция простым языком.',
    prompt:
      'Сделай краткую инструкцию для сотрудников простым языком. Нужны шаги по порядку, частые ошибки, полезные советы и короткий итоговый список действий.',
  },
  {
    id: 'meeting-summary',
    title: 'Итоги встречи',
    template: 'Протокол встречи',
    summary: 'Сводка договоренностей, задач и сроков.',
    prompt:
      'Оформи итоги встречи в виде делового документа. Нужны участники, краткая повестка, принятые решения, список задач с ответственными и сроками, а также блок следующих шагов.',
  },
]

type DocsVisualStatus =
  | DocsFile['status']
  | 'ai_queued'
  | 'ai_running'
  | 'ai_scanning'
  | 'ai_failed'

function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function depthOf(folderId: string, map: Map<string, DocsFolder>): number {
  let depth = 0
  let cursor = map.get(folderId)
  while (cursor?.parent_id) {
    depth += 1
    cursor = map.get(cursor.parent_id)
  }
  return depth
}

function isFolderInOwnBranch(
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

function fileTypeLabel(file: DocsFile): string {
  return (file.type || 'file').toUpperCase()
}

function statusLabel(status: DocsFile['status']): string {
  if (status === 'uploading') return 'Загрузка'
  if (status === 'scanning') return 'На проверке'
  if (status === 'ready') return 'Готов'
  if (status === 'blocked') return 'Заблокирован'
  if (status === 'draft') return 'Генерируется'
  return status || 'unknown'
}

function statusClass(status: DocsVisualStatus): string {
  if (status === 'ready') return 'text-emerald-600'
  if (status === 'scanning' || status === 'uploading' || status === 'draft' || status === 'ai_queued' || status === 'ai_running' || status === 'ai_scanning') {
    return 'text-amber-600'
  }
  if (status === 'blocked' || status === 'ai_failed') return 'text-destructive'
  return 'text-muted-foreground'
}

function aiJobStatusLabel(status: DocsAIGenerationJobStatus): string {
  if (status === 'queued') return 'В очереди'
  if (status === 'running') return 'Генерация'
  if (status === 'scanning') return 'Проверка AV'
  if (status === 'ready') return 'Готово'
  if (status === 'blocked') return 'Заблокирован'
  if (status === 'failed') return 'Ошибка'
  return status
}

function aiJobStatusClass(status: DocsAIGenerationJobStatus): string {
  if (status === 'ready') return 'text-emerald-600'
  if (status === 'scanning' || status === 'running' || status === 'queued') return 'text-amber-600'
  return 'text-destructive'
}

function isStoppedAiJob(job: DocsAIGenerationJob): boolean {
  if (job.error_message?.trim() === 'Остановлено пользователем') return true
  return Boolean(job.meta_json && typeof job.meta_json === 'object' && job.meta_json.stopped_by_user === true)
}

function aiJobDisplayLabel(job: DocsAIGenerationJob): string {
  if (isStoppedAiJob(job)) return 'Остановлено'
  return aiJobStatusLabel(job.status)
}

function aiJobDisplayClass(job: DocsAIGenerationJob): string {
  if (isStoppedAiJob(job)) return 'text-muted-foreground'
  return aiJobStatusClass(job.status)
}

function isActiveAiJob(job: DocsAIGenerationJob): boolean {
  return job.status === 'queued' || job.status === 'running'
}

function visualStatusLabel(status: DocsVisualStatus): string {
  if (status === 'ai_queued') return 'В очереди'
  if (status === 'ai_running') return 'Генерация'
  if (status === 'ai_scanning') return 'Проверка AV'
  if (status === 'ai_failed') return 'Ошибка генерации'
  return statusLabel(status)
}

function deriveFileVisualState(file: DocsFile, job: DocsAIGenerationJob | null): {
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveDraggedDocsPayload(
  event: ReactDragEvent<HTMLElement>,
  draggedFileId: string | null,
  draggedFolderId: string | null,
): { fileId: string | null; folderId: string | null } {
  const fileId = draggedFileId?.trim() || event.dataTransfer.getData('application/x-docs-file-id').trim() || null
  const folderId = draggedFolderId?.trim() || event.dataTransfer.getData('application/x-docs-folder-id').trim() || null
  return { fileId, folderId }
}

export default function DocsPage() {
  const [folderDialog, setFolderDialog] = useState<{
    mode: 'create' | 'rename'
    folderId: string | null
    parentId: string | null
    initialName: string
  } | null>(null)
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [folderDialogSubmitting, setFolderDialogSubmitting] = useState(false)
  const [fileDialog, setFileDialog] = useState<{
    folderId: string | null
  } | null>(null)
  const [fileDialogSubmitting, setFileDialogSubmitting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{
    kind: 'file' | 'folder'
    id: string
    title: string
  } | null>(null)
  const [deletingTargetId, setDeletingTargetId] = useState<string | null>(null)
  const [folders, setFolders] = useState<DocsFolder[]>([])
  const [files, setFiles] = useState<DocsFile[]>([])
  const [usage, setUsage] = useState<DocsUsageInfo | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  const [docxEditorFile, setDocxEditorFile] = useState<DocsFile | null>(null)
  const [docxLoading, setDocxLoading] = useState(false)
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)
  const [docxConfig, setDocxConfig] = useState<Record<string, unknown> | null>(null)
  const [docxServerUrl, setDocxServerUrl] = useState('')
  const [aiType, setAiType] = useState<DocsFileType>('docx')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTemplate, setAiTemplate] = useState('')
  const [aiTitle, setAiTitle] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiJobs, setAiJobs] = useState<DocsAIGenerationJob[]>([])
  const [stoppingAiJobId, setStoppingAiJobId] = useState<string | null>(null)
  const [deletingAiJobId, setDeletingAiJobId] = useState<string | null>(null)
  const [emptyType, setEmptyType] = useState<DocsFileType>('docx')
  const [emptyTitle, setEmptyTitle] = useState('')
  const [creatingEmpty, setCreatingEmpty] = useState(false)
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null)
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null)
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const structureActionClass =
    'h-8 w-8 rounded-md p-0 text-muted-foreground shadow-none hover:bg-secondary/40 hover:text-foreground focus-visible:ring-0 focus-visible:ring-offset-0'


  const folderMap = useMemo(() => {
    const map = new Map<string, DocsFolder>()
    for (const folder of folders) map.set(folder.id, folder)
    return map
  }, [folders])

  const childrenMap = useMemo(() => {
    const acc: Record<string, DocsFolder[]> = {}
    for (const folder of folders) {
      const key = folder.parent_id ?? 'root'
      acc[key] = acc[key] ?? []
      acc[key].push(folder)
    }
    for (const key of Object.keys(acc)) {
      const bucket = acc[key]
      if (!bucket) continue
      bucket.sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position
        return a.created_at.localeCompare(b.created_at)
      })
    }
    return acc
  }, [folders])

  const visibleFiles = useMemo(
    () => files.filter((item) => item.folder_id === selectedFolderId),
    [files, selectedFolderId],
  )

  const latestAiJobByFileId = useMemo(() => {
    const map = new Map<string, DocsAIGenerationJob>()
    for (const job of aiJobs) {
      if (!job.file_id) continue
      const current = map.get(job.file_id)
      if (!current || current.updated_at < job.updated_at) {
        map.set(job.file_id, job)
      }
    }
    return map
  }, [aiJobs])

  const filesByFolder = useMemo(() => {
    const acc: Record<string, DocsFile[]> = {}
    for (const file of files) {
      const key = file.folder_id ?? 'root'
      acc[key] = acc[key] ?? []
      acc[key].push(file)
    }
    for (const key of Object.keys(acc)) {
      acc[key]?.sort((a, b) => {
        const left = (a.title || a.original_name).toLowerCase()
        const right = (b.title || b.original_name).toLowerCase()
        return left.localeCompare(right, 'ru')
      })
    }
    return acc
  }, [files])

  const extractError = (error: unknown, fallback: string): string => {
    if (!isAxiosError(error)) return fallback
    const message = error.response?.data?.error?.message
    if (typeof message === 'string' && message.trim()) return message
    return fallback
  }


  const loadTree = useCallback(async () => {
    const response = await docsApi.getTree()
    if (!response.data.ok || !response.data.data) {
      throw new Error(response.data.error?.message || 'Не удалось загрузить дерево документов')
    }
    setFolders(response.data.data.folders)
    setFiles(response.data.data.files)
  }, [])

  const loadUsage = useCallback(async () => {
    const response = await docsApi.getUsage()
    if (!response.data.ok || !response.data.data) {
      throw new Error(response.data.error?.message || 'Не удалось загрузить usage')
    }
    setUsage(response.data.data)
  }, [])

  const loadAiJobs = useCallback(async () => {
    const response = await docsApi.listAIGenerationJobs(AI_JOB_HISTORY_LIMIT)
    if (!response.data.ok || !response.data.data) {
      throw new Error(response.data.error?.message || 'Не удалось загрузить AI-задачи документов')
    }
    setAiJobs(response.data.data)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setErrorText('')
    try {
      await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось загрузить раздел документов'))
    } finally {
      setLoading(false)
    }
  }, [loadAiJobs, loadTree, loadUsage])

  useEffect(() => {
    void reload()
  }, [reload])




  const createFolder = async (parentId: string | null) => {
    if (parentId) {
      const depth = depthOf(parentId, folderMap)
      if (depth + 1 > MAX_DEPTH) {
        setErrorText('Нельзя создавать папку глубже 2 уровней')
        return
      }
    }

    setFolderDialog({ mode: 'create', folderId: null, parentId, initialName: '' })
    setFolderNameDraft('')
    setErrorText('')
  }

  const renameFolder = async (folder: DocsFolder) => {
    setFolderDialog({
      mode: 'rename',
      folderId: folder.id,
      parentId: folder.parent_id,
      initialName: folder.name,
    })
    setFolderNameDraft(folder.name)
    setErrorText('')
  }

  const closeFolderDialog = () => {
    if (folderDialogSubmitting) return
    setFolderDialog(null)
    setFolderNameDraft('')
  }

  const submitFolderDialog = async () => {
    if (!folderDialog) return
    const name = folderNameDraft.trim()
    if (!name) {
      setErrorText(folderDialog.mode === 'create' ? 'Введите название папки' : 'Введите новое название папки')
      return
    }
    if (folderDialog.mode === 'rename' && name === folderDialog.initialName) {
      setFolderDialog(null)
      setFolderNameDraft('')
      return
    }

    setErrorText('')
    setFolderDialogSubmitting(true)
    try {
      if (folderDialog.mode === 'create') {
        const response = await docsApi.createFolder({ name, parent_id: folderDialog.parentId })
        if (!response.data.ok || !response.data.data) {
          setErrorText(response.data.error?.message || 'Не удалось создать папку')
          return
        }
        setFolders((prev) => [...prev, response.data.data!])
        if (folderDialog.parentId) {
          setOpenFolders((prev) => ({ ...prev, [folderDialog.parentId!]: true }))
        }
      } else if (folderDialog.folderId) {
        const response = await docsApi.updateFolder(folderDialog.folderId, { name })
        if (!response.data.ok || !response.data.data) {
          setErrorText(response.data.error?.message || 'Не удалось переименовать папку')
          return
        }
        setFolders((prev) => prev.map((item) => (item.id === folderDialog.folderId ? response.data.data! : item)))
      }
      setFolderDialog(null)
      setFolderNameDraft('')
    } catch (error) {
      setErrorText(
        extractError(
          error,
          folderDialog.mode === 'create' ? 'Не удалось создать папку' : 'Не удалось переименовать папку',
        ),
      )
    } finally {
      setFolderDialogSubmitting(false)
    }
  }

  const requestDeleteFolder = (folder: DocsFolder) => {
    setPendingDelete({ kind: 'folder', id: folder.id, title: folder.name })
  }

  const requestDeleteFile = (file: DocsFile) => {
    setPendingDelete({ kind: 'file', id: file.id, title: file.title || file.original_name })
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setErrorText('')
    setDeletingTargetId(pendingDelete.id)
    try {
      if (pendingDelete.kind === 'folder') {
        const response = await docsApi.deleteFolder(pendingDelete.id)
        if (!response.data.ok) {
          setErrorText(response.data.error?.message || 'Не удалось удалить папку')
          return
        }
        setFolders((prev) => prev.filter((item) => item.id !== pendingDelete.id))
        if (selectedFolderId === pendingDelete.id) setSelectedFolderId(null)
      } else {
        const response = await docsApi.deleteFile(pendingDelete.id)
        if (!response.data.ok) {
          setErrorText(response.data.error?.message || 'Не удалось удалить файл')
          return
        }
        setFiles((prev) => prev.filter((item) => item.id !== pendingDelete.id))
        setAiJobs((prev) => prev.filter((item) => item.file_id !== pendingDelete.id))
        await loadUsage()
      }
      setPendingDelete(null)
    } catch (error) {
      setErrorText(
        extractError(
          error,
          pendingDelete.kind === 'folder' ? 'Не удалось удалить папку' : 'Не удалось удалить файл',
        ),
      )
    } finally {
      setDeletingTargetId(null)
    }
  }

  const uploadFiles = async (list: FileList | null, targetFolderId: string | null = selectedFolderId) => {
    if (!list || list.length === 0) return
    setErrorText('')
    setUploading(true)
    try {
      const uploadedIds: string[] = []
      for (const file of Array.from(list)) {
        let pendingFileId: string | null = null
        try {
          const init = await docsApi.initUpload({
            filename: file.name,
            size_bytes: file.size,
            content_type: file.type || 'application/octet-stream',
            folder_id: targetFolderId,
          })
          if (!init.data.ok || !init.data.data) {
            throw new Error(init.data.error?.message || `Не удалось инициализировать загрузку ${file.name}`)
          }
          pendingFileId = init.data.data.file_id

          const put = await fetch(init.data.data.upload_url, {
            method: 'PUT',
            headers: init.data.data.upload_headers,
            body: file,
          })
          if (!put.ok) {
            throw new Error(`Ошибка загрузки в S3: ${put.status}`)
          }

          const finish = await docsApi.finishUpload({ file_id: init.data.data.file_id, size_bytes: file.size })
          if (!finish.data.ok || !finish.data.data) {
            throw new Error(finish.data.error?.message || `Не удалось завершить загрузку ${file.name}`)
          }
          pendingFileId = null
          uploadedIds.push(finish.data.data.id)
          setFiles((prev) => {
            const next = prev.filter((item) => item.id !== finish.data.data!.id)
            return [finish.data.data!, ...next]
          })
        } catch (error) {
          if (pendingFileId) {
            try {
              await docsApi.abortUpload(pendingFileId)
            } catch {
              // best-effort rollback: если не вышло, запись останется для ручной очистки.
            }
          }
          throw error
        }
      }
      await loadUsage()
      if (uploadedIds.length > 0) {
        await pollFilesStatus(uploadedIds)
      }
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось загрузить файл'))
    } finally {
      setUploading(false)
      setUploadTargetFolderId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openCreateFileDialog = (folderId: string | null) => {
    setFileDialog({ folderId })
    setEmptyType('docx')
    setEmptyTitle('')
    setErrorText('')
  }

  const closeFileDialog = () => {
    if (fileDialogSubmitting || creatingEmpty) return
    setFileDialog(null)
    setEmptyTitle('')
    setEmptyType('docx')
  }

  const createEmptyFile = async () => {
    if (!fileDialog) return
    setCreatingEmpty(true)
    setFileDialogSubmitting(true)
    setErrorText('')
    try {
      const response = await docsApi.createEmptyFile({
        type: emptyType,
        title: emptyTitle.trim() || null,
        folder_id: fileDialog.folderId,
      })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось создать пустой файл')
        return
      }
      setFiles((prev) => {
        const next = prev.filter((item) => item.id !== response.data.data!.id)
        return [response.data.data!, ...next]
      })
      await loadUsage()
      if (fileDialog.folderId) {
        setOpenFolders((prev) => ({ ...prev, [fileDialog.folderId!]: true }))
      }
      setSelectedFolderId(fileDialog.folderId)
      setFileDialog(null)
      setEmptyTitle('')
      setEmptyType('docx')
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось создать пустой файл'))
    } finally {
      setCreatingEmpty(false)
      setFileDialogSubmitting(false)
    }
  }

  const moveFileToFolder = useCallback(
    async (fileId: string, folderId: string | null) => {
      const currentFile = files.find((item) => item.id === fileId)
      if (!currentFile || currentFile.folder_id === folderId) return
      try {
        const response = await docsApi.moveFile(fileId, { folder_id: folderId })
        if (!response.data.ok || !response.data.data) {
          setErrorText(response.data.error?.message || 'Не удалось переместить файл')
          return
        }
        setFiles((prev) => prev.map((item) => (item.id === fileId ? response.data.data! : item)))
      } catch (error) {
        setErrorText(extractError(error, 'Не удалось переместить файл'))
      }
    },
    [files],
  )

  const moveFolderToParent = useCallback(
    async (folderId: string, parentId: string | null) => {
      const currentFolder = folders.find((item) => item.id === folderId)
      if (!currentFolder || currentFolder.parent_id === parentId) return
      if (isFolderInOwnBranch(folderId, parentId, folderMap)) {
        setErrorText('Нельзя вложить папку в саму себя или в свою дочернюю папку')
        return
      }
      try {
        const response = await docsApi.updateFolder(folderId, { parent_id: parentId })
        if (!response.data.ok || !response.data.data) {
          setErrorText(response.data.error?.message || 'Не удалось переместить папку')
          return
        }
        setFolders((prev) => prev.map((item) => (item.id === folderId ? response.data.data! : item)))
        if (parentId) {
          setOpenFolders((prev) => ({ ...prev, [parentId]: true }))
        }
      } catch (error) {
        setErrorText(extractError(error, 'Не удалось переместить папку'))
      }
    },
    [folderMap, folders],
  )

  const handleDragStartFile = (fileId: string) => {
    setDraggedFolderId(null)
    setDraggedFileId(fileId)
  }

  const handleDragEndFile = () => {
    setDraggedFileId(null)
    setDropTargetFolderId(null)
  }

  const handleDragStartFolder = (folderId: string) => {
    setDraggedFileId(null)
    setDraggedFolderId(folderId)
  }

  const handleDragEndFolder = () => {
    setDraggedFolderId(null)
    setDropTargetFolderId(null)
  }

  const handleDropToFolder = async (
    folderId: string | null,
    payload?: { fileId: string | null; folderId: string | null },
  ) => {
    const activeFileId = payload?.fileId ?? draggedFileId
    const activeFolderId = payload?.folderId ?? draggedFolderId
    if (activeFileId) {
      await moveFileToFolder(activeFileId, folderId)
    } else if (activeFolderId) {
      await moveFolderToParent(activeFolderId, folderId)
    } else {
      return
    }
    setDraggedFileId(null)
    setDraggedFolderId(null)
    setDropTargetFolderId(null)
  }

  const pollFilesStatus = useCallback(
    async (fileIds: string[]) => {
      const pending = new Set(fileIds)
      const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS
      let hasBlocked = false

      while (pending.size > 0 && Date.now() < deadline) {
        await wait(STATUS_POLL_INTERVAL_MS)

        const responses = await Promise.all(
          Array.from(pending).map(async (fileId) => {
            try {
              const response = await docsApi.getFile(fileId)
              if (response.data.ok && response.data.data) return response.data.data
            } catch {
              return null
            }
            return null
          }),
        )

        const updatedFiles = responses.filter((item): item is DocsFile => Boolean(item))
        if (updatedFiles.length === 0) continue

        setFiles((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]))
          for (const item of updatedFiles) byId.set(item.id, item)
          return Array.from(byId.values())
        })

        for (const item of updatedFiles) {
          if (item.status !== 'scanning' && item.status !== 'uploading') {
            pending.delete(item.id)
          }
          if (item.status === 'blocked') hasBlocked = true
        }
      }

      await loadUsage()

      if (pending.size > 0) {
        setErrorText('Некоторые файлы всё ещё на проверке. Обновите список позже.')
        return
      }
      if (hasBlocked) {
        setErrorText('Некоторые файлы заблокированы после проверки. Обратитесь к администратору.')
      }
    },
    [loadUsage],
  )

  const upsertAiJob = useCallback((job: DocsAIGenerationJob) => {
    setAiJobs((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]))
      map.set(job.id, job)
      return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
    })
  }, [])

  const pollAiJobStatus = useCallback(
    async (jobId: string, fileId: string) => {
      const deadline = Date.now() + AI_JOB_POLL_TIMEOUT_MS
      while (Date.now() < deadline) {
        await wait(AI_JOB_POLL_INTERVAL_MS)
        try {
          const response = await docsApi.getAIGenerationJob(jobId)
          if (!response.data.ok || !response.data.data) continue
          const job = response.data.data
          upsertAiJob(job)
          if (job.status === 'failed') {
            if (!isStoppedAiJob(job)) {
              setErrorText(job.error_message || 'AI-генерация завершилась ошибкой')
            }
            await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
            return
          }
          if (job.status === 'blocked') {
            setErrorText('Сгенерированный документ заблокирован после проверки')
            await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
            return
          }
          if (job.status === 'ready') {
            await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
            return
          }
          if (job.status === 'scanning') {
            await pollFilesStatus([fileId])
            const finalJob = await docsApi.getAIGenerationJob(jobId)
            if (finalJob.data.ok && finalJob.data.data) {
              upsertAiJob(finalJob.data.data)
            }
            await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
            return
          }
        } catch {
          // keep polling until timeout
        }
      }
      setErrorText('AI-генерация заняла слишком много времени. Обновите раздел позже.')
    },
    [loadAiJobs, loadTree, loadUsage, pollFilesStatus, upsertAiJob],
  )

  const stopAiJob = useCallback(
    async (job: DocsAIGenerationJob) => {
      if (!isActiveAiJob(job)) return
      setStoppingAiJobId(job.id)
      setErrorText('')
      try {
        const response = await docsApi.stopAIGenerationJob(job.id)
        if (!response.data.ok || !response.data.data) {
          setErrorText(response.data.error?.message || 'Не удалось остановить AI-задачу')
          return
        }
        upsertAiJob(response.data.data)
        await Promise.all([loadTree(), loadUsage(), loadAiJobs()])
      } catch (error) {
        setErrorText(extractError(error, 'Не удалось остановить AI-задачу'))
      } finally {
        setStoppingAiJobId(null)
      }
    },
    [loadAiJobs, loadTree, loadUsage, upsertAiJob],
  )

  const deleteAiJob = useCallback(
    async (job: DocsAIGenerationJob) => {
      if (isActiveAiJob(job) || job.status === 'scanning') return
      setDeletingAiJobId(job.id)
      setErrorText('')
      try {
        const response = await docsApi.deleteAIGenerationJob(job.id)
        if (!response.data.ok) {
          setErrorText(response.data.error?.message || 'Не удалось удалить AI-задачу')
          return
        }
        setAiJobs((prev) => prev.filter((item) => item.id !== job.id))
      } catch (error) {
        setErrorText(extractError(error, 'Не удалось удалить AI-задачу'))
      } finally {
        setDeletingAiJobId(null)
      }
    },
    [],
  )

  const createAIDocument = async () => {
    const normalizedPrompt = aiPrompt.trim()
    if (!normalizedPrompt) {
      setErrorText('Введите prompt для AI-генерации документа')
      return
    }
    setAiGenerating(true)
    setErrorText('')
    try {
      const response = await docsApi.aiGenerate({
        type: aiType,
        prompt: normalizedPrompt,
        template: aiTemplate.trim() || null,
        folder_id: selectedFolderId,
        title: aiTitle.trim() || null,
        language: 'ru',
      })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось поставить AI-задачу')
        return
      }

      const jobId = response.data.data.job_id
      const fileId = response.data.data.file_id
      const placeholder = await docsApi.getFile(fileId)
      if (placeholder.data.ok && placeholder.data.data) {
        setFiles((prev) => {
          const next = prev.filter((item) => item.id !== fileId)
          return [placeholder.data.data!, ...next]
        })
      }

      const queuedJob = await docsApi.getAIGenerationJob(jobId)
      if (queuedJob.data.ok && queuedJob.data.data) {
        upsertAiJob(queuedJob.data.data)
      }

      setAiPrompt('')
      await pollAiJobStatus(jobId, fileId)
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось создать документ через AI'))
    } finally {
      setAiGenerating(false)
    }
  }

  const applyAiPreset = (presetId: string) => {
    const preset = AI_DOCUMENT_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    setAiTitle(preset.title)
    setAiTemplate(preset.template)
    setAiPrompt(preset.prompt)
    setErrorText('')
  }

  const downloadFile = async (file: DocsFile) => {
    setErrorText('')
    try {
      const response = await docsApi.getDownload(file.id)
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось получить ссылку скачивания')
        return
      }
      window.open(response.data.data.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось получить ссылку скачивания'))
    }
  }


  const abortUploadingFile = async (file: DocsFile) => {
    if (file.status !== 'uploading') return
    setErrorText('')
    try {
      const response = await docsApi.abortUpload(file.id)
      if (!response.data.ok) {
        setErrorText(response.data.error?.message || 'Не удалось отменить загрузку')
        return
      }
      setFiles((prev) => prev.filter((item) => item.id !== file.id))
      await loadUsage()
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось отменить загрузку'))
    }
  }

  const onDocxOpen = async (file: DocsFile) => {
    if (file.type !== 'docx') return
    if (file.status !== 'ready') {
      setErrorText('DOCX можно открыть только в статусе READY')
      return
    }
    setErrorText('')
    setDocxLoading(true)
    try {
      const response = await docsApi.openDocx(file.id)
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось открыть DOCX редактор')
        return
      }
      setDocxEditorFile(response.data.data.file)
      setDocxServerUrl(response.data.data.document_server_url)
      setDocxConfig((response.data.data?.config as Record<string, unknown>) || null)
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось открыть DOCX редактор'))
    } finally {
      setDocxLoading(false)
    }
  }

  const onFileUpdated = (nextFile: DocsFile) => {
    setFiles((prev) => prev.map((item) => (item.id === nextFile.id ? nextFile : item)))
    if (docxEditorFile?.id === nextFile.id) {
      setDocxEditorFile(nextFile)
    }
  }

  const onSelectFolder = (folderId: string | null) => {
    setSelectedFolderId(folderId)
  }

  const triggerUploadToFolder = (folderId: string | null) => {
    if (uploading) return
    setUploadTargetFolderId(folderId)
    fileInputRef.current?.click()
  }

  const renderTreeFile = (file: DocsFile, depth: number) => {
    const latestAiJob = latestAiJobByFileId.get(file.id) ?? null
    const visualState = deriveFileVisualState(file, latestAiJob)
    return (
      <div
        key={file.id}
        className={`group flex cursor-grab select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          draggedFileId === file.id ? 'opacity-50' : 'hover:bg-secondary/60'
        }`}
        style={{ paddingLeft: `${28 + depth * 16}px` }}
        draggable
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-docs-file-id', file.id)
          event.dataTransfer.setData('text/plain', file.id)
          handleDragStartFile(file.id)
        }}
        onDragEnd={handleDragEndFile}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelectFolder(file.folder_id ?? null)}
          title={file.title || file.original_name}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelectFolder(file.folder_id ?? null)
            }
          }}
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{file.title || file.original_name}</span>
        </div>
        <span className={`shrink-0 text-[11px] font-medium ${statusClass(visualState.status)}`}>
          {visualStatusLabel(visualState.status)}
        </span>
      </div>
    )
  }

  const renderFolder = (folder: DocsFolder, depth = 0) => {
    const isOpen = openFolders[folder.id] ?? true
    const children = childrenMap[folder.id] ?? []
    const folderFiles = filesByFolder[folder.id] ?? []
    const isSelected = folder.id === selectedFolderId
    const canCreateSubFolder = depth < MAX_DEPTH
    const isFolderDropInvalid = draggedFolderId !== null && isFolderInOwnBranch(draggedFolderId, folder.id, folderMap)
    const isDropActive = dropTargetFolderId === folder.id && !isFolderDropInvalid

    return (
      <div key={folder.id}>
        <div
          className={`group flex cursor-grab select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${isDropActive
            ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
            : dropTargetFolderId === folder.id && isFolderDropInvalid
              ? 'bg-destructive/10 text-destructive ring-1 ring-destructive/30'
            : isSelected
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-secondary/60'
            }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          draggable
          onDragStart={(event) => {
            event.stopPropagation()
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('application/x-docs-folder-id', folder.id)
            event.dataTransfer.setData('text/plain', folder.id)
            handleDragStartFolder(folder.id)
          }}
          onDragEnd={handleDragEndFolder}
          onDragEnter={(event) => {
            const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
            if (!payload.fileId && !payload.folderId) return
            if (payload.folderId && isFolderInOwnBranch(payload.folderId, folder.id, folderMap)) return
            event.preventDefault()
            setDropTargetFolderId(folder.id)
          }}
          onDragOver={(event) => {
            const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
            if (!payload.fileId && !payload.folderId) return
            if (payload.folderId && isFolderInOwnBranch(payload.folderId, folder.id, folderMap)) return
            event.preventDefault()
            setDropTargetFolderId(folder.id)
          }}
          onDrop={(event) => {
            const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
            if (!payload.fileId && !payload.folderId) return
            if (payload.folderId && isFolderInOwnBranch(payload.folderId, folder.id, folderMap)) return
            event.preventDefault()
            event.stopPropagation()
            void handleDropToFolder(folder.id, payload)
          }}
        >
          <button
            className="h-4 w-4 text-muted-foreground"
            onClick={() => setOpenFolders((prev) => ({ ...prev, [folder.id]: !isOpen }))}
            draggable={false}
          >
            {children.length > 0 ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
          </button>
          <div
            className="flex items-center gap-2 text-left"
            onClick={() => onSelectFolder(folder.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectFolder(folder.id)
              }
            }}
          >
            <Folder className="h-4 w-4 text-amber-500" />
            <span className="truncate">{folder.name}</span>
          </div>
          <div className="ml-auto hidden items-center gap-1 group-hover:flex">
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => openCreateFileDialog(folder.id)}
              title="Создать файл"
              disabled={uploading || creatingEmpty || fileDialogSubmitting}
            >
              <FilePlus2 className="h-4 w-4" />
            </button>
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => triggerUploadToFolder(folder.id)}
              title="Загрузить файл"
              disabled={uploading}
            >
              <Upload className="h-4 w-4" />
            </button>
            {canCreateSubFolder && (
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void createFolder(folder.id)}
                title="Создать вложенную папку"
                disabled={uploading || creatingEmpty || fileDialogSubmitting}
              >
                <FolderPlus className="h-4 w-4" />
              </button>
            )}
            <button className="text-muted-foreground hover:text-foreground" onClick={() => void renameFolder(folder)} title="Переименовать">
              <Pencil className="h-4 w-4" />
            </button>
              <button className="text-muted-foreground hover:text-destructive" onClick={() => requestDeleteFolder(folder)} title="Удалить">
                <Trash2 className="h-4 w-4" />
              </button>
          </div>
        </div>
        {isOpen && children.map((child) => renderFolder(child, depth + 1))}
        {isOpen && folderFiles.map((file) => renderTreeFile(file, depth + 1))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Документы</h1>
          <p className="text-sm text-muted-foreground">DOCX с загрузкой в S3 и версионированием. PDF при загрузке автоматически конвертируется в DOCX.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void reload()}>
            Обновить
          </Button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => void uploadFiles(event.target.files, uploadTargetFolderId ?? selectedFolderId)}
      />

      {usage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Использование хранилища
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={usage.percent_used} />
            <p className="text-sm text-muted-foreground">
              Занято: <span className="font-medium text-foreground">{formatBytes(usage.used_bytes)}</span>
              {' · '}Резерв: <span className="font-medium text-foreground">{formatBytes(usage.reserved_bytes)}</span>
              {' · '}Лимит: <span className="font-medium text-foreground">{usage.limit_bytes > 0 ? formatBytes(usage.limit_bytes) : 'Без лимита'}</span>
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Bot className="h-4 w-4" /> Создать документ через AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.95fr)]">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={aiType}
                  onChange={(event) => setAiType(event.target.value as DocsFileType)}
                  disabled={aiGenerating}
                >
                  <option value="docx">DOCX</option>
                </select>
                <input
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Название документа"
                  value={aiTitle}
                  onChange={(event) => setAiTitle(event.target.value)}
                  disabled={aiGenerating}
                  maxLength={200}
                />
              </div>
              <input
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                placeholder="Шаблон или стиль"
                value={aiTemplate}
                onChange={(event) => setAiTemplate(event.target.value)}
                disabled={aiGenerating}
                maxLength={120}
              />
              <textarea
                className="min-h-[136px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Коротко опишите, какой документ нужен и что в нём должно быть."
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                disabled={aiGenerating}
                maxLength={12000}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Документ создаётся как новая версия и затем проходит проверку.
                </p>
                <Button onClick={() => void createAIDocument()} disabled={aiGenerating || !aiPrompt.trim()}>
                  {aiGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Сгенерировать
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Базовые шаблоны</p>
                  <p className="text-xs text-muted-foreground">Можно взять за основу и быстро доработать под себя.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAiTitle('')
                    setAiTemplate('')
                    setAiPrompt('')
                  }}
                  disabled={aiGenerating}
                >
                  Очистить
                </Button>
              </div>
              <div className="space-y-2">
                {AI_DOCUMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyAiPreset(preset.id)}
                    disabled={aiGenerating}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{preset.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{preset.summary}</p>
                      </div>
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          {aiJobs.length > 0 && (
            <div className="space-y-2 rounded-md border border-border p-2">
              <p className="text-xs font-medium text-muted-foreground">Последние AI-задачи</p>
              {aiJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-2 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate">
                      {job.title || 'Документ'} · {job.file_type.toUpperCase()}
                    </div>
                    {job.error_message && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {job.error_message}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={aiJobDisplayClass(job)}>{aiJobDisplayLabel(job)}</span>
                    {isActiveAiJob(job) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void stopAiJob(job)}
                        disabled={stoppingAiJobId === job.id || deletingAiJobId === job.id}
                        title="Остановить задачу"
                      >
                        {stoppingAiJobId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    {!isActiveAiJob(job) && job.status !== 'scanning' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => void deleteAiJob(job)}
                        disabled={deletingAiJobId === job.id || stoppingAiJobId === job.id}
                        title="Удалить из истории"
                      >
                        {deletingAiJobId === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {errorText && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorText}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Структура</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className={structureActionClass} onClick={() => openCreateFileDialog(selectedFolderId)} title="Создать файл" aria-label="Создать файл">
                  <FilePlus2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className={structureActionClass} onClick={() => triggerUploadToFolder(selectedFolderId)} title="Загрузить файл" aria-label="Загрузить файл" disabled={uploading}>
                  <Upload className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className={structureActionClass} onClick={() => void createFolder(selectedFolderId)} title="Создать папку" aria-label="Создать папку" disabled={creatingEmpty || fileDialogSubmitting}>
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="group">
              <button
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${dropTargetFolderId === 'root'
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
                  : selectedFolderId === null
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-secondary/60'
                  }`}
                onClick={() => onSelectFolder(null)}
                onDragEnter={(event) => {
                  const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
                  if (!payload.fileId && !payload.folderId) return
                  event.preventDefault()
                  setDropTargetFolderId('root')
                }}
                onDragOver={(event) => {
                  const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
                  if (!payload.fileId && !payload.folderId) return
                  event.preventDefault()
                  setDropTargetFolderId('root')
                }}
                onDrop={(event) => {
                  const payload = resolveDraggedDocsPayload(event, draggedFileId, draggedFolderId)
                  if (!payload.fileId && !payload.folderId) return
                  event.preventDefault()
                  event.stopPropagation()
                  void handleDropToFolder(null, payload)
                }}
              >
                <Folder className="h-4 w-4 text-amber-500" />
                <span>Корень</span>
              </button>
              {(filesByFolder.root ?? []).map((file) => renderTreeFile(file, 1))}
            </div>
            {(childrenMap.root ?? []).map((folder) => renderFolder(folder, 0))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Файлы {selectedFolderId ? `в папке «${folderMap.get(selectedFolderId)?.name ?? ''}»` : 'в корне'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visibleFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <FileType2 className="h-10 w-10 opacity-40" />
                <p className="text-sm">В выбранной папке пока нет файлов</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleFiles.map((file) => {
                  const latestAiJob = latestAiJobByFileId.get(file.id) ?? null
                  const visualState = deriveFileVisualState(file, latestAiJob)
                  return (
                    <div
                      key={file.id}
                      className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 ${draggedFileId === file.id ? 'opacity-50' : ''}`}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('application/x-docs-file-id', file.id)
                        event.dataTransfer.setData('text/plain', file.id)
                        handleDragStartFile(file.id)
                      }}
                      onDragEnd={handleDragEndFile}
                    >
                      <div className="rounded-md bg-secondary p-2">
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.title || file.original_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fileTypeLabel(file)} · {formatBytes(file.size)} · статус: {visualStatusLabel(visualState.status).toLowerCase()}
                        </p>
                        {visualState.helperText && (
                          <p className={`text-xs ${statusClass(visualState.status)}`}>{visualState.helperText}</p>
                        )}
                      </div>
                      {file.type === 'docx' && (
                        <Button variant="outline" size="sm" onClick={() => void onDocxOpen(file)} disabled={file.status !== 'ready' || docxLoading || docxEditorFile?.id === file.id}>
                          <Pencil className="mr-1 h-4 w-4" /> Открыть в редакторе
                        </Button>
                      )}
                      {file.status === 'uploading' && (
                        <Button variant="outline" size="sm" onClick={() => void abortUploadingFile(file)}>
                          <X className="mr-1 h-4 w-4" /> Отменить
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void downloadFile(file)} disabled={file.status !== 'ready'}>
                        <Download className="mr-1 h-4 w-4" /> Скачать
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        onClick={() => requestDeleteFile(file)}
                        disabled={docxEditorFile?.id === file.id || deletingTargetId === file.id}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Удалить
                      </Button>
                      <span className={`text-xs font-medium ${statusClass(visualState.status)}`}>{visualStatusLabel(visualState.status)}</span>
                    </div>
                  )
                })}
              </div>
            )}

          </CardContent>
        </Card>
        {docxEditorFile && docxConfig && docxServerUrl && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 lg:p-6 bg-background/50 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
            <div
              className={`flex flex-col bg-background shadow-2xl border border-border overflow-hidden transition-all duration-300 ${
                isEditorFullscreen
                  ? 'fixed inset-0 h-full w-full rounded-none border-0'
                  : 'h-[min(820px,calc(100vh-32px))] w-[min(1180px,calc(100vw-24px))] rounded-2xl'
              }`}
            >
              <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 shadow-md flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100/80 text-blue-600 shadow-sm dark:bg-blue-900/40 dark:text-blue-400">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold leading-tight">{docxEditorFile.title || docxEditorFile.original_name}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium flex items-center gap-1.5">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      Редактор OnlyOffice
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
                    className="h-9 w-9 p-0 hover:bg-secondary"
                    title={isEditorFullscreen ? 'Свернуть окно' : 'Развернуть на весь экран'}
                  >
                    {isEditorFullscreen ? <Minimize2 className="h-4 w-4 opacity-70" /> : <Maximize2 className="h-4 w-4 opacity-70" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    setDocxEditorFile(null)
                    setDocxConfig(null)
                    setDocxServerUrl('')
                    setIsEditorFullscreen(false)
                  }} className="h-9 gap-2 shadow-sm border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all">
                    <X className="h-4 w-4" />
                    Закрыть редактор
                  </Button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f4f4f4] dark:bg-neutral-900 shadow-inner pt-3">
                <DocxEditorPanel
                  file={docxEditorFile}
                  documentServerUrl={docxServerUrl}
                  config={docxConfig}
                  loading={docxLoading}
                  onError={setErrorText}
                  onFileUpdated={onFileUpdated}
                />
              </div>
            </div>
          </div>
        )}

        {pendingDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">
                  {pendingDelete.kind === 'folder' ? 'Удалить папку' : 'Удалить файл'}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {pendingDelete.kind === 'folder'
                    ? `Папка «${pendingDelete.title}» будет удалена. Если внутри есть файлы или вложенные папки, backend не даст удалить её, пока вы не очистите содержимое.`
                    : `Файл «${pendingDelete.title}» будет удалён из документов. Это действие нельзя отменить.`}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button
                  variant="outline"
                  onClick={() => setPendingDelete(null)}
                  disabled={deletingTargetId === pendingDelete.id}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => void confirmDelete()}
                  disabled={deletingTargetId === pendingDelete.id}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletingTargetId === pendingDelete.id ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Удаляем
                    </>
                  ) : (
                    'Удалить'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {folderDialog && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">
                  {folderDialog.mode === 'create' ? 'Создать папку' : 'Переименовать папку'}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {folderDialog.mode === 'create'
                    ? 'Укажите название новой папки.'
                    : `Измените название папки «${folderDialog.initialName}».`}
                </p>
              </div>
              <div className="px-5 py-4">
                <input
                  autoFocus
                  value={folderNameDraft}
                  onChange={(event) => setFolderNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitFolderDialog()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      closeFolderDialog()
                    }
                  }}
                  disabled={folderDialogSubmitting}
                  placeholder="Название папки"
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button
                  variant="outline"
                  onClick={closeFolderDialog}
                  disabled={folderDialogSubmitting}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => void submitFolderDialog()}
                  disabled={folderDialogSubmitting}
                >
                  {folderDialogSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {folderDialog.mode === 'create' ? 'Создаём' : 'Сохраняем'}
                    </>
                  ) : (
                    folderDialog.mode === 'create' ? 'Создать' : 'Сохранить'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {fileDialog && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
              <div className="border-b border-border px-5 py-4">
                <h3 className="text-lg font-semibold">Создать файл</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {fileDialog.folderId
                    ? `Файл будет создан в папке «${folderMap.get(fileDialog.folderId)?.name ?? 'Без названия'}».`
                    : 'Файл будет создан в корне документов.'}
                </p>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Тип файла</label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={emptyType}
                    onChange={(event) => setEmptyType(event.target.value as DocsFileType)}
                    disabled={fileDialogSubmitting || creatingEmpty}
                  >
                    <option value="docx">DOCX</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-foreground">Название файла</label>
                  <input
                    autoFocus
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Например, Договор или КП"
                    value={emptyTitle}
                    onChange={(event) => setEmptyTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void createEmptyFile()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        closeFileDialog()
                      }
                    }}
                    maxLength={200}
                    disabled={fileDialogSubmitting || creatingEmpty}
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-4">
                <Button variant="outline" onClick={closeFileDialog} disabled={fileDialogSubmitting || creatingEmpty}>
                  Отмена
                </Button>
                <Button onClick={() => void createEmptyFile()} disabled={fileDialogSubmitting || creatingEmpty}>
                  {fileDialogSubmitting || creatingEmpty ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Создаём
                    </>
                  ) : (
                    <>
                      <FilePlus2 className="mr-2 h-4 w-4" />
                      Создать
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
