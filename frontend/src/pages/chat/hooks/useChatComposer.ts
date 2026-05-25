import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { chatApi, type ChatMessageInfo, type ChatMessageMeta } from '@/lib/api'
import {
  MESSAGE_MAX_CHARS,
  VOICE_NOTE_MAX_DURATION_MS,
  VOICE_NOTE_TICK_MS,
  extractApiError,
  getVoiceFileExtension,
  isVoiceAttachment,
  resolveVoiceRecorderMimeType,
  type ComposerAttachment,
  type ComposerAttachmentSource,
  type MediaPreviewState,
} from '../chatHelpers'
import { uploadComposerAttachmentFlow } from './chatComposerUpload'
interface UseChatComposerParams {
  selectedChatId: string | null
  userId: string | undefined
  replyToMessageId: string | null
  stopTyping: () => void
  scrollMessagesToBottom: () => void
  onOwnMessageSent: (message: ChatMessageInfo) => void
  onError: (message: string) => void
  clearError: () => void
  setReplyToMessageId: (value: string | null) => void
}
export function useChatComposer({
  selectedChatId,
  userId,
  replyToMessageId,
  stopTyping,
  scrollMessagesToBottom,
  onOwnMessageSent,
  onError,
  clearError,
  setReplyToMessageId,
}: UseChatComposerParams) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([])
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceRecordingElapsedMs, setVoiceRecordingElapsedMs] = useState(0)
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewState | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const attachMenuRef = useRef<HTMLDivElement | null>(null)
  const mediaAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const cameraPhotoAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const cameraVideoAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const fileAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentUploadControllersRef = useRef<Record<string, AbortController>>({})
  const voiceRecorderRef = useRef<MediaRecorder | null>(null)
  const voiceStreamRef = useRef<MediaStream | null>(null)
  const voiceChunksRef = useRef<Blob[]>([])
  const voiceStopTimerRef = useRef<number | null>(null)
  const voiceTickTimerRef = useRef<number | null>(null)
  const voiceShouldUploadOnStopRef = useRef(true)
  const voiceDurationOnStopRef = useRef(0)
  const voiceElapsedMsRef = useRef(0)
  const readyComposerAttachments = useMemo(
    () => composerAttachments.filter((item) => item.status === 'ready'),
    [composerAttachments],
  )
  const hasUploadingAttachments = useMemo(
    () => composerAttachments.some((item) => item.status === 'uploading'),
    [composerAttachments],
  )
  const canSendMessage = Boolean(selectedChatId) && !sending && (draft.trim().length > 0 || readyComposerAttachments.length > 0)
  const adjustComposerHeight = useCallback(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = 160
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [])
  useEffect(() => {
    adjustComposerHeight()
  }, [adjustComposerHeight, draft])
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
    setIsAttachMenuOpen(false)
    setMediaPreview(null)
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
    await uploadComposerAttachmentFlow({
      selectedChatId,
      isRecordingVoice,
      composerAttachments,
      hasUploadingAttachments,
      voiceNoteMaxDurationMs: VOICE_NOTE_MAX_DURATION_MS,
      file,
      source,
      options,
      onError,
      setComposerAttachments,
      attachmentUploadControllersRef,
      clearInputValues: () => {
        if (mediaAttachmentInputRef.current) mediaAttachmentInputRef.current.value = ''
        if (cameraPhotoAttachmentInputRef.current) cameraPhotoAttachmentInputRef.current.value = ''
        if (cameraVideoAttachmentInputRef.current) cameraVideoAttachmentInputRef.current.value = ''
        if (fileAttachmentInputRef.current) fileAttachmentInputRef.current.value = ''
      },
    })
  }
  const handleAttachmentInputChange = async (event: ChangeEvent<HTMLInputElement>, source: ComposerAttachmentSource) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (files.length === 0) return
    if (!selectedChatId) {
      onError('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      onError('Сначала остановите запись голосового')
      return
    }
    if (files.length > 1 || composerAttachments.length >= 1 || hasUploadingAttachments) {
      onError('В сообщении может быть только 1 вложение')
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
    mediaAttachmentInputRef.current?.click()
  }
  const openCameraPhotoPicker = () => {
    setIsAttachMenuOpen(false)
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
    cameraPhotoAttachmentInputRef.current?.click()
  }
  const openCameraVideoPicker = () => {
    setIsAttachMenuOpen(false)
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
    cameraVideoAttachmentInputRef.current?.click()
  }
  const openFilePicker = () => {
    setIsAttachMenuOpen(false)
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
      onError('Сначала выберите чат')
      return
    }
    if (isRecordingVoice) {
      stopVoiceRecording(true)
      return
    }
    if (composerAttachments.length >= 1 || hasUploadingAttachments) {
      onError('В сообщении может быть только 1 вложение')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Запись голосовых не поддерживается в этом браузере')
      return
    }
    clearError()
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
        onError('Ошибка записи голосового сообщения')
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
          onError('Не удалось определить длительность голосового сообщения')
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
      onError('Не удалось получить доступ к микрофону')
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
  const handleSend = async () => {
    const trimmedDraft = draft.trim()
    if (!selectedChatId || sending) return
    setIsAttachMenuOpen(false)
    if (isRecordingVoice) {
      onError('Сначала остановите запись голосового')
      return
    }
    if (hasUploadingAttachments) {
      onError('Дождитесь завершения загрузки вложений')
      return
    }
    if (!trimmedDraft && readyComposerAttachments.length === 0) return
    if (trimmedDraft.length > MESSAGE_MAX_CHARS) {
      onError(`Сообщение не должно превышать ${MESSAGE_MAX_CHARS} символов`)
      return
    }
    setSending(true)
    clearError()
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
        if (created.sender_id === userId) {
          onOwnMessageSent(created)
        }
        setDraft('')
        setReplyToMessageId(null)
        resetComposerAttachments()
        stopTyping()
        requestAnimationFrame(scrollMessagesToBottom)
        await chatApi.updateReadCursor(selectedChatId, { last_read_seq_no: created.seq_no })
      } else {
        onError(response.data.error?.message || 'Не удалось отправить сообщение')
      }
    } catch (error) {
      onError(extractApiError(error, 'Не удалось отправить сообщение'))
    } finally {
      setSending(false)
    }
  }
  return {
    draft,
    setDraft,
    sending,
    composerAttachments,
    isRecordingVoice,
    voiceRecordingElapsedMs,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    mediaPreview,
    setMediaPreview,
    readyComposerAttachments,
    hasUploadingAttachments,
    canSendMessage,
    composerRef,
    attachMenuRef,
    mediaAttachmentInputRef,
    cameraPhotoAttachmentInputRef,
    cameraVideoAttachmentInputRef,
    fileAttachmentInputRef,
    handleRemoveComposerAttachment,
    handleMediaInputChange,
    handleCameraPhotoInputChange,
    handleCameraVideoInputChange,
    handleFileInputChange,
    openMediaPicker,
    openCameraPhotoPicker,
    openCameraVideoPicker,
    openFilePicker,
    handleComposerPaste,
    handleSend,
    startVoiceRecording,
    stopVoiceRecording,
  }
}
