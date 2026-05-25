import { chatApi } from '@/lib/api'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_MB,
  extractApiError,
  inferContentTypeFromName,
  isMediaAttachment,
  isVoiceAttachment,
  type ComposerAttachment,
  type ComposerAttachmentSource,
} from '../chatHelpers'

interface UploadComposerAttachmentParams {
  selectedChatId: string | null
  isRecordingVoice: boolean
  composerAttachments: ComposerAttachment[]
  hasUploadingAttachments: boolean
  voiceNoteMaxDurationMs: number
  file: File
  source: ComposerAttachmentSource
  options?: { durationMs?: number | null }
  onError: (message: string) => void
  setComposerAttachments: Dispatch<SetStateAction<ComposerAttachment[]>>
  attachmentUploadControllersRef: MutableRefObject<Record<string, AbortController>>
  clearInputValues: () => void
}

export async function uploadComposerAttachmentFlow({
  selectedChatId,
  isRecordingVoice,
  composerAttachments,
  hasUploadingAttachments,
  voiceNoteMaxDurationMs,
  file,
  source,
  options,
  onError,
  setComposerAttachments,
  attachmentUploadControllersRef,
  clearInputValues,
}: UploadComposerAttachmentParams) {
  if (!selectedChatId) {
    onError('Сначала выберите чат')
    return
  }
  if (isRecordingVoice) {
    onError('Остановите запись голосового перед добавлением другого вложения')
    return
  }
  if (composerAttachments.length >= 1 || hasUploadingAttachments) {
    onError('В сообщении может быть только 1 вложение')
    return
  }

  const contentType = file.type || inferContentTypeFromName(file.name)
  if (source === 'media' || source === 'paste') {
    if (!isMediaAttachment(contentType)) {
      onError('Кнопка "Фото/Видео" принимает только фото и видео')
      return
    }
  }
  if (source === 'voice') {
    if (!isVoiceAttachment(contentType)) {
      onError('Голосовые сообщения должны быть в аудио-формате')
      return
    }
    const durationMs = Number(options?.durationMs || 0)
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > voiceNoteMaxDurationMs) {
      onError('Голосовое сообщение не должно превышать 1 минуту')
      return
    }
  }
  if (source === 'paste' && !contentType.startsWith('image/')) {
    onError('Из буфера можно вставлять только изображения')
    return
  }
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    onError(`Максимальный размер файла: ${CHAT_ATTACHMENT_MAX_MB} MB`)
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
    clearInputValues()
    if (attachmentUploadControllersRef.current[clientId] === controller) {
      delete attachmentUploadControllersRef.current[clientId]
    }
  }
}
