import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import Editor from '@monaco-editor/react'
import type { IConfig as OnlyOfficeConfig } from '@onlyoffice/document-editor-react'
import {
  docsApi,
  type DocsAIGenerationJob,
  type DocsAIGenerationJobStatus,
  type DocsFile,
  type DocsFileType,
  type DocsFileVersion,
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
  PenLine,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PdfSignerPanel } from './components/PdfSignerPanel'
import { DocxEditorPanel } from './components/DocxEditorPanel'

const MAX_DEPTH = 2
const STATUS_POLL_INTERVAL_MS = 2000
const STATUS_POLL_TIMEOUT_MS = 120000
const AI_JOB_POLL_INTERVAL_MS = 2000
const AI_JOB_POLL_TIMEOUT_MS = 180000

function formatBytes(value: number): string {
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU')
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

function fileTypeLabel(file: DocsFile): string {
  return (file.type || 'file').toUpperCase()
}

function statusLabel(status: DocsFile['status']): string {
  if (status === 'uploading') return 'Загрузка'
  if (status === 'scanning') return 'На проверке'
  if (status === 'ready') return 'Готов'
  if (status === 'blocked') return 'Заблокирован'
  return status || 'unknown'
}

function statusClass(status: DocsFile['status']): string {
  if (status === 'ready') return 'text-emerald-600'
  if (status === 'scanning' || status === 'uploading') return 'text-amber-600'
  if (status === 'blocked') return 'text-destructive'
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function DocsPage() {
  const [folders, setFolders] = useState<DocsFolder[]>([])
  const [files, setFiles] = useState<DocsFile[]>([])
  const [usage, setUsage] = useState<DocsUsageInfo | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})

  const [editorFile, setEditorFile] = useState<DocsFile | null>(null)
  const [editorContent, setEditorContent] = useState('')
  const [editorInitialContent, setEditorInitialContent] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [versions, setVersions] = useState<DocsFileVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [pdfSignerFile, setPdfSignerFile] = useState<DocsFile | null>(null)
  const [docxEditorFile, setDocxEditorFile] = useState<DocsFile | null>(null)
  const [docxLoading, setDocxLoading] = useState(false)
  const [docxConfig, setDocxConfig] = useState<OnlyOfficeConfig | null>(null)
  const [docxServerUrl, setDocxServerUrl] = useState('')
  const [aiType, setAiType] = useState<DocsFileType>('txt')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiTemplate, setAiTemplate] = useState('')
  const [aiTitle, setAiTitle] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiJobs, setAiJobs] = useState<DocsAIGenerationJob[]>([])
  const [emptyType, setEmptyType] = useState<DocsFileType>('txt')
  const [emptyTitle, setEmptyTitle] = useState('')
  const [creatingEmpty, setCreatingEmpty] = useState(false)
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null)
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const hasUnsavedChanges = Boolean(editorFile && editorContent !== editorInitialContent)

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

  const extractError = (error: unknown, fallback: string): string => {
    if (!isAxiosError(error)) return fallback
    const message = error.response?.data?.error?.message
    if (typeof message === 'string' && message.trim()) return message
    return fallback
  }

  const confirmDiscardUnsaved = useCallback((): boolean => {
    if (!hasUnsavedChanges) return true
    return window.confirm('Есть несохраненные изменения в TXT. Перейти без сохранения?')
  }, [hasUnsavedChanges])

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

  const reload = useCallback(async () => {
    setLoading(true)
    setErrorText('')
    try {
      await Promise.all([loadTree(), loadUsage()])
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось загрузить раздел документов'))
    } finally {
      setLoading(false)
    }
  }, [loadTree, loadUsage])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  const loadEditorData = useCallback(
    async (file: DocsFile) => {
      setEditorLoading(true)
      setVersionsLoading(true)
      try {
        const [textResponse, versionsResponse] = await Promise.all([
          docsApi.getFileText(file.id),
          docsApi.listFileVersions(file.id),
        ])

        if (!textResponse.data.ok || !textResponse.data.data) {
          setErrorText(textResponse.data.error?.message || 'Не удалось открыть TXT-файл')
          return
        }
        if (!versionsResponse.data.ok || !versionsResponse.data.data) {
          setErrorText(versionsResponse.data.error?.message || 'Не удалось загрузить историю версий')
          return
        }

        setEditorFile(file)
        setEditorContent(textResponse.data.data.content)
        setEditorInitialContent(textResponse.data.data.content)
        setVersions(versionsResponse.data.data)
      } catch (error) {
        setErrorText(extractError(error, 'Не удалось открыть TXT-редактор'))
      } finally {
        setEditorLoading(false)
        setVersionsLoading(false)
      }
    },
    [],
  )

  const closeEditor = useCallback(() => {
    if (!confirmDiscardUnsaved()) return
    setEditorFile(null)
    setEditorContent('')
    setEditorInitialContent('')
    setVersions([])
  }, [confirmDiscardUnsaved])

  const openEditor = async (file: DocsFile) => {
    if (file.type !== 'txt') return
    if (file.status !== 'ready') {
      setErrorText('Редактирование TXT доступно только для файлов в статусе READY')
      return
    }
    if (editorFile?.id !== file.id && !confirmDiscardUnsaved()) return

    setErrorText('')
    await loadEditorData(file)
  }

  const saveText = async () => {
    if (!editorFile) return

    setErrorText('')
    setSaveLoading(true)
    try {
      const response = await docsApi.saveFileText(editorFile.id, {
        content: editorContent,
        title: editorFile.title || editorFile.original_name,
      })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось сохранить TXT')
        return
      }

      const updatedFile = response.data.data
      setFiles((prev) => prev.map((item) => (item.id === updatedFile.id ? updatedFile : item)))
      setEditorFile(updatedFile)

      const [textResponse, versionsResponse] = await Promise.all([
        docsApi.getFileText(updatedFile.id),
        docsApi.listFileVersions(updatedFile.id),
        loadUsage(),
      ])

      if (!textResponse.data.ok || !textResponse.data.data) {
        setErrorText(textResponse.data.error?.message || 'Сохранено, но не удалось обновить текст')
        return
      }
      if (!versionsResponse.data.ok || !versionsResponse.data.data) {
        setErrorText(versionsResponse.data.error?.message || 'Сохранено, но не удалось обновить историю версий')
        return
      }

      setEditorContent(textResponse.data.data.content)
      setEditorInitialContent(textResponse.data.data.content)
      setVersions(versionsResponse.data.data)
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось сохранить TXT'))
    } finally {
      setSaveLoading(false)
    }
  }

  const createFolder = async (parentId: string | null) => {
    const name = window.prompt('Название папки')?.trim()
    if (!name) return

    if (parentId) {
      const depth = depthOf(parentId, folderMap)
      if (depth + 1 > MAX_DEPTH) {
        setErrorText('Нельзя создавать папку глубже 2 уровней')
        return
      }
    }

    setErrorText('')
    try {
      const response = await docsApi.createFolder({ name, parent_id: parentId })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось создать папку')
        return
      }
      setFolders((prev) => [...prev, response.data.data!])
      if (parentId) {
        setOpenFolders((prev) => ({ ...prev, [parentId]: true }))
      }
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось создать папку'))
    }
  }

  const renameFolder = async (folder: DocsFolder) => {
    const name = window.prompt('Новое название папки', folder.name)?.trim()
    if (!name || name === folder.name) return

    setErrorText('')
    try {
      const response = await docsApi.updateFolder(folder.id, { name })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось переименовать папку')
        return
      }
      setFolders((prev) => prev.map((item) => (item.id === folder.id ? response.data.data! : item)))
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось переименовать папку'))
    }
  }

  const deleteFolder = async (folder: DocsFolder) => {
    if (!window.confirm(`Удалить папку «${folder.name}»?`)) return
    setErrorText('')
    try {
      const response = await docsApi.deleteFolder(folder.id)
      if (!response.data.ok) {
        setErrorText(response.data.error?.message || 'Не удалось удалить папку')
        return
      }
      setFolders((prev) => prev.filter((item) => item.id !== folder.id))
      if (selectedFolderId === folder.id) setSelectedFolderId(null)
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось удалить папку'))
    }
  }

  const uploadFiles = async (list: FileList | null) => {
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
            folder_id: selectedFolderId,
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
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const createEmptyFile = async () => {
    setCreatingEmpty(true)
    setErrorText('')
    try {
      const response = await docsApi.createEmptyFile({
        type: emptyType,
        title: emptyTitle.trim() || null,
        folder_id: selectedFolderId,
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
      setEmptyTitle('')
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось создать пустой файл'))
    } finally {
      setCreatingEmpty(false)
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

  const handleDragStartFile = (fileId: string) => {
    setDraggedFileId(fileId)
  }

  const handleDragEndFile = () => {
    setDraggedFileId(null)
    setDropTargetFolderId(null)
  }

  const handleDropToFolder = async (folderId: string | null) => {
    if (!draggedFileId) return
    await moveFileToFolder(draggedFileId, folderId)
    setDraggedFileId(null)
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
            setErrorText(job.error_message || 'AI-генерация завершилась ошибкой')
            await Promise.all([loadTree(), loadUsage()])
            return
          }
          if (job.status === 'blocked') {
            setErrorText('Сгенерированный документ заблокирован после проверки')
            await Promise.all([loadTree(), loadUsage()])
            return
          }
          if (job.status === 'ready') {
            await Promise.all([loadTree(), loadUsage()])
            return
          }
          if (job.status === 'scanning') {
            await pollFilesStatus([fileId])
            const finalJob = await docsApi.getAIGenerationJob(jobId)
            if (finalJob.data.ok && finalJob.data.data) {
              upsertAiJob(finalJob.data.data)
            }
            await Promise.all([loadTree(), loadUsage()])
            return
          }
        } catch {
          // keep polling until timeout
        }
      }
      setErrorText('AI-генерация заняла слишком много времени. Обновите раздел позже.')
    },
    [loadTree, loadUsage, pollFilesStatus, upsertAiJob],
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

  const onPdfSignOpen = (file: DocsFile) => {
    if (file.type !== 'pdf') return
    if (file.status !== 'ready') {
      setErrorText('Подпись PDF доступна только для файлов в статусе READY')
      return
    }
    setErrorText('')
    setPdfSignerFile(file)
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
      setDocxConfig(response.data.data.config as unknown as OnlyOfficeConfig)
    } catch (error) {
      setErrorText(extractError(error, 'Не удалось открыть DOCX редактор'))
    } finally {
      setDocxLoading(false)
    }
  }

  const onFileUpdated = (nextFile: DocsFile) => {
    setFiles((prev) => prev.map((item) => (item.id === nextFile.id ? nextFile : item)))
    if (pdfSignerFile?.id === nextFile.id) {
      setPdfSignerFile(nextFile)
    }
    if (docxEditorFile?.id === nextFile.id) {
      setDocxEditorFile(nextFile)
    }
  }

  const onSelectFolder = (folderId: string | null) => {
    if (!confirmDiscardUnsaved()) return
    setSelectedFolderId(folderId)
  }

  const renderFolder = (folder: DocsFolder, depth = 0) => {
    const isOpen = openFolders[folder.id] ?? true
    const children = childrenMap[folder.id] ?? []
    const isSelected = folder.id === selectedFolderId
    const canCreateSubFolder = depth < MAX_DEPTH
    const isDropActive = dropTargetFolderId === folder.id

    return (
      <div key={folder.id}>
        <div
          className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
            isDropActive
              ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
              : isSelected
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-secondary/60'
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onDragOver={(event) => {
            if (!draggedFileId) return
            event.preventDefault()
            setDropTargetFolderId(folder.id)
          }}
          onDragLeave={() => {
            if (dropTargetFolderId === folder.id) setDropTargetFolderId(null)
          }}
          onDrop={(event) => {
            if (!draggedFileId) return
            event.preventDefault()
            void handleDropToFolder(folder.id)
          }}
        >
          <button
            className="h-4 w-4 text-muted-foreground"
            onClick={() => setOpenFolders((prev) => ({ ...prev, [folder.id]: !isOpen }))}
          >
            {children.length > 0 ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
          </button>
          <button className="flex items-center gap-2 text-left" onClick={() => onSelectFolder(folder.id)}>
            <Folder className="h-4 w-4 text-amber-500" />
            <span className="truncate">{folder.name}</span>
          </button>
          <div className="ml-auto hidden items-center gap-1 group-hover:flex">
            {canCreateSubFolder && (
              <button className="text-muted-foreground hover:text-foreground" onClick={() => void createFolder(folder.id)} title="Создать вложенную папку">
                <FolderPlus className="h-4 w-4" />
              </button>
            )}
            <button className="text-muted-foreground hover:text-foreground" onClick={() => void renameFolder(folder)} title="Переименовать">
              <Pencil className="h-4 w-4" />
            </button>
            <button className="text-muted-foreground hover:text-destructive" onClick={() => void deleteFolder(folder)} title="Удалить">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {isOpen && children.map((child) => renderFolder(child, depth + 1))}
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
          <p className="text-sm text-muted-foreground">TXT/PDF/DOCX с загрузкой в S3 и версионированием.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void reload()}>
            Обновить
          </Button>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={emptyType}
            onChange={(event) => setEmptyType(event.target.value as DocsFileType)}
            disabled={creatingEmpty || uploading}
          >
            <option value="txt">TXT</option>
            <option value="docx">DOCX</option>
            <option value="pdf">PDF</option>
          </select>
          <input
            className="h-10 w-56 rounded-md border border-input bg-background px-3 text-sm"
            placeholder="Название пустого файла"
            value={emptyTitle}
            onChange={(event) => setEmptyTitle(event.target.value)}
            maxLength={200}
            disabled={creatingEmpty || uploading}
          />
          <Button variant="outline" onClick={() => void createEmptyFile()} disabled={creatingEmpty || uploading}>
            {creatingEmpty ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
            Создать файл
          </Button>
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Загрузить файл
          </Button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
        </div>
      </div>

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
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={aiType}
              onChange={(event) => setAiType(event.target.value as DocsFileType)}
              disabled={aiGenerating}
            >
              <option value="txt">TXT</option>
              <option value="docx">DOCX</option>
              <option value="pdf">PDF</option>
            </select>
            <input
              className="h-10 rounded-md border border-input bg-background px-3 text-sm md:col-span-2"
              placeholder="Название документа (опционально)"
              value={aiTitle}
              onChange={(event) => setAiTitle(event.target.value)}
              disabled={aiGenerating}
              maxLength={200}
            />
            <input
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Шаблон/стиль (опционально)"
              value={aiTemplate}
              onChange={(event) => setAiTemplate(event.target.value)}
              disabled={aiGenerating}
              maxLength={120}
            />
          </div>
          <textarea
            className="min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="Опишите, какой документ нужно сгенерировать..."
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            disabled={aiGenerating}
            maxLength={12000}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Файл создается как новая версия через pipeline AI → SCANNING → READY/BLOCKED.
            </p>
            <Button onClick={() => void createAIDocument()} disabled={aiGenerating || aiPrompt.trim().length < 3}>
              {aiGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Сгенерировать
            </Button>
          </div>
          {aiJobs.length > 0 && (
            <div className="space-y-1 rounded-md border border-border p-2">
              <p className="text-xs font-medium text-muted-foreground">Последние AI-задачи</p>
              {aiJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {job.title || 'Документ'} · {job.file_type.toUpperCase()}
                  </span>
                  <span className={aiJobStatusClass(job.status)}>{aiJobStatusLabel(job.status)}</span>
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
              <span>Папки</span>
              <Button variant="ghost" size="sm" onClick={() => void createFolder(null)}>
                <FolderPlus className="mr-1 h-4 w-4" /> Создать
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                dropTargetFolderId === 'root'
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/40'
                  : selectedFolderId === null
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-secondary/60'
              }`}
              onClick={() => onSelectFolder(null)}
              onDragOver={(event) => {
                if (!draggedFileId) return
                event.preventDefault()
                setDropTargetFolderId('root')
              }}
              onDragLeave={() => {
                if (dropTargetFolderId === 'root') setDropTargetFolderId(null)
              }}
              onDrop={(event) => {
                if (!draggedFileId) return
                event.preventDefault()
                void handleDropToFolder(null)
              }}
            >
              <Folder className="h-4 w-4 text-amber-500" />
              <span>Корень</span>
            </button>
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
                {visibleFiles.map((file) => (
                  <div
                    key={file.id}
                    className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 ${draggedFileId === file.id ? 'opacity-50' : ''}`}
                    draggable
                    onDragStart={() => handleDragStartFile(file.id)}
                    onDragEnd={handleDragEndFile}
                  >
                    <div className="rounded-md bg-secondary p-2">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.title || file.original_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fileTypeLabel(file)} · {formatBytes(file.size)} · статус: {file.status || 'unknown'}
                      </p>
                      {file.status === 'scanning' && (
                        <p className="text-xs text-amber-600">Файл на проверке. Скачивание будет доступно после сканирования.</p>
                      )}
                      {file.status === 'blocked' && (
                        <p className="text-xs text-destructive">Заблокирован (обратитесь к администратору).</p>
                      )}
                    </div>
                    {file.type === 'txt' && (
                      <Button variant="outline" size="sm" onClick={() => void openEditor(file)} disabled={file.status !== 'ready'}>
                        <Pencil className="mr-1 h-4 w-4" /> Редактировать
                      </Button>
                    )}
                    {file.type === 'pdf' && (
                      <Button variant="outline" size="sm" onClick={() => onPdfSignOpen(file)} disabled={file.status !== 'ready'}>
                        <PenLine className="mr-1 h-4 w-4" /> Подписать PDF
                      </Button>
                    )}
                    {file.type === 'docx' && (
                      <Button variant="outline" size="sm" onClick={() => void onDocxOpen(file)} disabled={file.status !== 'ready'}>
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
                    <span className={`text-xs font-medium ${statusClass(file.status)}`}>{statusLabel(file.status)}</span>
                  </div>
                ))}
              </div>
            )}

            {editorFile && (
              <div className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-4 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">TXT редактор: {editorFile.title || editorFile.original_name}</h3>
                      <p className="text-xs text-muted-foreground">Каждое сохранение создаёт новую версию файла.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => void closeEditor()}>
                        <X className="mr-1 h-4 w-4" /> Закрыть
                      </Button>
                      <Button size="sm" onClick={() => void saveText()} disabled={saveLoading || editorLoading || !hasUnsavedChanges}>
                        {saveLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                        Сохранить
                      </Button>
                    </div>
                  </div>

                  {editorLoading ? (
                    <div className="flex h-48 items-center justify-center rounded-md border border-dashed border-border">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-input">
                      <Editor
                        height="360px"
                        defaultLanguage="plaintext"
                        value={editorContent}
                        onChange={(value) => setEditorContent(value ?? '')}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 13,
                          wordWrap: 'on',
                          lineNumbers: 'on',
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  )}

                  <p className={`text-xs ${hasUnsavedChanges ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {hasUnsavedChanges ? 'Есть несохраненные изменения.' : 'Все изменения сохранены.'}
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">История версий</h3>
                  {versionsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Загрузка...
                    </div>
                  ) : versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Версий пока нет</p>
                  ) : (
                    <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
                      {versions.map((version) => (
                        <div key={version.id} className="rounded-md border border-border px-3 py-2">
                          <p className="text-xs font-medium">v: {version.id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(version.created_at)}</p>
                          <p className="text-xs text-muted-foreground">{formatBytes(version.size_bytes)} · {version.mime}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {pdfSignerFile && (
              <PdfSignerPanel
                file={pdfSignerFile}
                onClose={() => setPdfSignerFile(null)}
                onError={setErrorText}
                onFileUpdated={onFileUpdated}
                pollFileStatus={pollFilesStatus}
              />
            )}

            {docxEditorFile && docxConfig && docxServerUrl && (
              <DocxEditorPanel
                file={docxEditorFile}
                documentServerUrl={docxServerUrl}
                config={docxConfig}
                loading={docxLoading}
                onClose={() => {
                  setDocxEditorFile(null)
                  setDocxConfig(null)
                  setDocxServerUrl('')
                }}
                onError={setErrorText}
                onFileUpdated={onFileUpdated}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
