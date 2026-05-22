import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent } from 'react'
import { chatApi, type ChatInfo, type ChatMemberInfo, type ChatMessageInfo, type ChatMessageMeta } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_MB,
  CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY,
  MESSAGE_MAX_CHARS,
  MESSAGE_PAGE_SIZE,
  TYPING_TTL_MS,
  VOICE_NOTE_MAX_DURATION_MS,
  VOICE_NOTE_TICK_MS,
  extractApiError,
  getInitials,
  getVoiceFileExtension,
  inferContentTypeFromName,
  isMediaAttachment,
  isVoiceAttachment,
  resolveVoiceRecorderMimeType,
  type ComposerAttachment,
  type ComposerAttachmentSource,
  type MediaPreviewState,
} from './chatHelpers'
import { ChatModals } from './components/ChatModals'
import { ChatDialogsCard } from './components/ChatDialogsCard'
import { ChatList } from './components/ChatList'

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
  const [dialogsQuery, setDialogsQuery] = useState('')
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
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [addingMemberUserId, setAddingMemberUserId] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [deleteChatConfirmOpen, setDeleteChatConfirmOpen] = useState(false)
  const [deletingChat, setDeletingChat] = useState(false)

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
    setAddMemberOpen(false)
    setDeleteChatConfirmOpen(false)
    setAddingMemberUserId('')
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

  const memberMetaById = useMemo(() => {
    return new Map(
      members.map((m) => [
        m.user_id,
        {
          label: `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id,
          avatarUrl: m.user_avatar_url || null,
        },
      ]),
    )
  }, [members])
  const memberLabelsById = useMemo(() => {
    return new Map(members.map((m) => [m.user_id, memberMetaById.get(m.user_id)?.label || m.user_id]))
  }, [memberMetaById, members])

  const selectedChat = useMemo(() => {
    return chats.find((x) => x.id === selectedChatId) || null
  }, [chats, selectedChatId])
  const currentOrgMember = useMemo(
    () => members.find((member) => member.user_id === user?.id) || null,
    [members, user?.id],
  )
  const currentOrgRole = String(currentOrgMember?.role || '').toLowerCase()
  const canManageOrgChats = currentOrgRole === 'owner' || currentOrgRole === 'admin' || currentOrgRole === 'manager'
  const currentChatMemberRole = useMemo(() => {
    if (!user?.id) return ''
    return String(chatMembers.find((member) => member.user_id === user.id)?.role || '').toLowerCase()
  }, [chatMembers, user?.id])
  const canManageSelectedChat = canManageOrgChats && (currentChatMemberRole === 'owner' || currentChatMemberRole === 'admin')
  const canManageMembers = canManageSelectedChat && !!selectedChat && selectedChat.chat_type !== 'direct'
  const canDeleteSelectedChat = canManageSelectedChat && !!selectedChat && selectedChat.chat_type !== 'direct'
  const selectedChatMemberIdsSet = useMemo(() => {
    return new Set(chatMembers.map((member) => member.user_id))
  }, [chatMembers])
  const addableChatMembers = useMemo(() => {
    if (!selectedChat || selectedChat.chat_type === 'direct') return []
    return members.filter((member) => member.user_id !== user?.id && !selectedChatMemberIdsSet.has(member.user_id))
  }, [members, selectedChat, selectedChatMemberIdsSet, user?.id])

  const selectedChatMembers = useMemo(() => {
    if (!selectedChat) return []
    return selectedChat.member_ids.map((id) => {
      const memberMeta = memberMetaById.get(id)
      const label = memberMeta?.label || id
      return { userId: id, label, initials: getInitials(label), online: Boolean(presence[id]), avatarUrl: memberMeta?.avatarUrl || null }
    })
  }, [memberMetaById, presence, selectedChat])

  const getChatDisplayTitle = useCallback(
    (chat: ChatInfo): string => {
      if (chat.title?.trim()) return chat.title.trim()
      if (chat.chat_type === 'direct') {
        const peerIds = chat.member_ids.filter((id) => id !== user?.id)
        if (peerIds.length > 0) {
          const peerLabels = peerIds.map((id) => memberMetaById.get(id)?.label || id)
          return peerLabels.join(', ')
        }
        return 'Личный чат'
      }
      if (chat.chat_type === 'group') return 'Группа без названия'
      return 'Канал без названия'
    },
    [memberMetaById, user?.id],
  )

  const visibleChats = useMemo(() => {
    const q = dialogsQuery.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((chat) => {
      const title = getChatDisplayTitle(chat).toLowerCase()
      const type = String(chat.chat_type || '').toLowerCase()
      const memberHit = chat.member_ids.some((memberId) => (memberMetaById.get(memberId)?.label || memberId).toLowerCase().includes(q))
      return title.includes(q) || type.includes(q) || memberHit
    })
  }, [chats, dialogsQuery, getChatDisplayTitle, memberMetaById])

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
      .map(([userId]) => memberMetaById.get(userId)?.label || userId)
  }, [memberMetaById, typingUsers])

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
    return memberMetaById.get(message.sender_id)?.label || message.sender_id
  }

  const getUserAvatarUrl = useCallback(
    (userId: string): string | null => memberMetaById.get(userId)?.avatarUrl || null,
    [memberMetaById],
  )

  const getChatAvatarUrl = useCallback(
    (chat: ChatInfo): string | null => {
      if (chat.chat_type !== 'direct') return null
      const peerId = chat.member_ids.find((id) => id !== user?.id)
      if (!peerId) return null
      return memberMetaById.get(peerId)?.avatarUrl || null
    },
    [memberMetaById, user?.id],
  )

  const getOwnMessageStatus = (message: ChatMessageInfo): string => {
    if (!user || message.sender_id !== user.id) return ''
    const readByOther = chatMembers.some((member) => member.user_id !== user.id && member.last_read_seq_no >= message.seq_no)
    if (readByOther) return 'Прочитано'
    const hasOnlinePeer = chatMembers.some((member) => member.user_id !== user.id && presence[member.user_id])
    if (ackedOwnMessages[message.id] || hasOnlinePeer) return 'Доставлено'
    return 'Отправлено'
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

    const contentType = file.type || inferContentTypeFromName(file.name)
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
            member?: ChatMemberInfo
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

          if (payload.type === 'chat.member.joined' && payload.chat_id && payload.member) {
            const joinedMember = payload.member
            setChats((prev) => {
              const index = prev.findIndex((chat) => chat.id === payload.chat_id)
              if (index === -1) return prev
              const next = [...prev]
              const chat = next[index]
              if (!chat) return prev
              next[index] = {
                ...chat,
                member_ids: chat.member_ids.includes(joinedMember.user_id)
                  ? chat.member_ids
                  : [...chat.member_ids, joinedMember.user_id],
              }
              return next
            })
            if (payload.chat_id === selectedChatIdRef.current) {
              setChatMembers((prev) =>
                prev.some((member) => member.user_id === joinedMember.user_id) ? prev : [...prev, joinedMember],
              )
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

  const handleAddMemberToSelectedChat = async () => {
    if (!selectedChatId || !addingMemberUserId || addingMember) return
    setAddingMember(true)
    setErrorText('')
    try {
      const response = await chatApi.addMember(selectedChatId, { user_id: addingMemberUserId, role: 'member' })
      if (!response.data.ok || !response.data.data) {
        setErrorText(response.data.error?.message || 'Не удалось добавить участника')
        return
      }
      const createdMember = response.data.data
      setChatMembers((prev) => (prev.some((member) => member.user_id === createdMember.user_id) ? prev : [...prev, createdMember]))
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === selectedChatId
            ? {
                ...chat,
                member_ids: chat.member_ids.includes(createdMember.user_id)
                  ? chat.member_ids
                  : [...chat.member_ids, createdMember.user_id],
              }
            : chat,
        ),
      )
      setAddingMemberUserId('')
      setAddMemberOpen(false)
    } catch (error) {
      setErrorText(extractApiError(error, 'Не удалось добавить участника'))
    } finally {
      setAddingMember(false)
    }
  }

  const handleDeleteSelectedChat = async () => {
    if (!selectedChat || deletingChat) return

    setDeletingChat(true)
    setErrorText('')
    try {
      const response = await chatApi.deleteChat(selectedChat.id)
      if (!response.data.ok) {
        setErrorText(response.data.error?.message || 'Не удалось удалить чат')
        return
      }
      setChats((prev) => {
        const next = prev.filter((chat) => chat.id !== selectedChat.id)
        setSelectedChatId(next[0]?.id || null)
        return next
      })
      setDeleteChatConfirmOpen(false)
      setMessages([])
      setChatMembers([])
      setPresence({})
      setTypingUsers({})
    } catch (error) {
      setErrorText(extractApiError(error, 'Не удалось удалить чат'))
    } finally {
      setDeletingChat(false)
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

  const renderChatList = (compact: boolean) => (
    <ChatList
      loadingChats={loadingChats}
      chats={visibleChats}
      selectedChatId={selectedChatId}
      compact={compact}
      getChatDisplayTitle={getChatDisplayTitle}
      getChatAvatarUrl={getChatAvatarUrl}
      onSelectChat={handleSelectChat}
    />
  )


  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Мессенджер</h1>
          <p className="text-sm text-muted-foreground">Диалоги, группы и вложения в одном окне</p>
        </div>
      </div>

      {errorText && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      <ChatModals
        createChatOpen={createChatOpen}
        setCreateChatOpen={setCreateChatOpen}
        newChatType={newChatType}
        setNewChatType={setNewChatType}
        setNewChatTitle={setNewChatTitle}
        setSelectedMemberIds={setSelectedMemberIds}
        newChatTitle={newChatTitle}
        members={members}
        user={user}
        selectedMemberIds={selectedMemberIds}
        handleToggleMember={handleToggleMember}
        creatingChat={creatingChat}
        handleCreateChat={handleCreateChat}
        addMemberOpen={addMemberOpen}
        selectedChat={selectedChat}
        canManageMembers={canManageMembers}
        setAddMemberOpen={setAddMemberOpen}
        addableChatMembers={addableChatMembers}
        addingMemberUserId={addingMemberUserId}
        setAddingMemberUserId={setAddingMemberUserId}
        addingMember={addingMember}
        handleAddMemberToSelectedChat={handleAddMemberToSelectedChat}
        deleteChatConfirmOpen={deleteChatConfirmOpen}
        setDeleteChatConfirmOpen={setDeleteChatConfirmOpen}
        canDeleteSelectedChat={canDeleteSelectedChat}
        deletingChat={deletingChat}
        selectedChatTitle={selectedChat ? getChatDisplayTitle(selectedChat) : ''}
        handleDeleteSelectedChat={handleDeleteSelectedChat}
      />

      <ChatDialogsCard
        isMobileDialogsOpen={isMobileDialogsOpen}
        setIsMobileDialogsOpen={setIsMobileDialogsOpen}
        isDesktopSidebarCollapsed={isDesktopSidebarCollapsed}
        setIsDesktopSidebarCollapsed={setIsDesktopSidebarCollapsed}
        renderChatList={renderChatList}
        dialogsQuery={dialogsQuery}
        setDialogsQuery={setDialogsQuery}
        selectedChat={selectedChat}
        getChatDisplayTitle={getChatDisplayTitle}
        selectedChatMembers={selectedChatMembers}
        isMobileViewport={isMobileViewport}
        typingLabels={typingLabels}
        canManageMembers={canManageMembers}
        setAddMemberOpen={setAddMemberOpen}
        setSearchOpen={setSearchOpen}
        searchOpen={searchOpen}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        canDeleteSelectedChat={canDeleteSelectedChat}
        onRequestDeleteSelectedChat={() => setDeleteChatConfirmOpen(true)}
        deletingChat={deletingChat}
        messagesViewportRef={messagesViewportRef}
        handleMessagesScroll={handleMessagesScroll}
        loadingOlderMessages={loadingOlderMessages}
        hasMoreMessages={hasMoreMessages}
        loadingMessages={loadingMessages}
        messages={messages}
        visibleMessages={visibleMessages}
        user={user}
        membersById={memberLabelsById}
        getMessageOwnerLabel={getMessageOwnerLabel}
        getUserAvatarUrl={getUserAvatarUrl}
        getOwnMessageStatus={getOwnMessageStatus}
        expandedMessages={expandedMessages}
        isExpandableMessage={isExpandableMessage}
        setExpandedMessages={setExpandedMessages}
        menuOpenMessageId={menuOpenMessageId}
        setMenuOpenMessageId={setMenuOpenMessageId}
        handleCopyMessage={handleCopyMessage}
        setReplyToMessageId={setReplyToMessageId}
        composerRef={composerRef}
        handleDeleteMessage={handleDeleteMessage}
        newMessagesCount={newMessagesCount}
        isNearBottom={isNearBottom}
        scrollToLatest={scrollToLatest}
        replyToMessage={replyToMessage}
        composerAttachments={composerAttachments}
        handleRemoveComposerAttachment={handleRemoveComposerAttachment}
        isRecordingVoice={isRecordingVoice}
        voiceRecordingElapsedMs={voiceRecordingElapsedMs}
        mediaAttachmentInputRef={mediaAttachmentInputRef}
        handleMediaInputChange={handleMediaInputChange}
        cameraPhotoAttachmentInputRef={cameraPhotoAttachmentInputRef}
        handleCameraPhotoInputChange={handleCameraPhotoInputChange}
        cameraVideoAttachmentInputRef={cameraVideoAttachmentInputRef}
        handleCameraVideoInputChange={handleCameraVideoInputChange}
        fileAttachmentInputRef={fileAttachmentInputRef}
        handleFileInputChange={handleFileInputChange}
        attachMenuRef={attachMenuRef}
        isAttachMenuOpen={isAttachMenuOpen}
        setIsAttachMenuOpen={setIsAttachMenuOpen}
        selectedChatId={selectedChatId}
        sending={sending}
        hasUploadingAttachments={hasUploadingAttachments}
        openMediaPicker={openMediaPicker}
        openCameraPhotoPicker={openCameraPhotoPicker}
        openCameraVideoPicker={openCameraVideoPicker}
        openFilePicker={openFilePicker}
        draft={draft}
        setDraft={setDraft}
        touchTypingActivity={touchTypingActivity}
        stopTyping={stopTyping}
        handleComposerPaste={handleComposerPaste}
        canSendMessage={canSendMessage}
        readyComposerAttachments={readyComposerAttachments}
        handleSend={handleSend}
        startVoiceRecording={startVoiceRecording}
        stopVoiceRecording={stopVoiceRecording}
        mediaPreview={mediaPreview}
        setMediaPreview={setMediaPreview}
        onOpenCreateChat={() => setCreateChatOpen(true)}
      />
    </div>
  )
}
