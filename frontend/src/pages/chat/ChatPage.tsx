import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { chatApi, type ChatInfo, type ChatMemberInfo, type ChatMessageInfo } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

import { extractApiError, getInitials, type MediaPreviewState } from './chatHelpers'
import { ChatModals } from './components/ChatModals'
import { ChatDialogsCard } from './components/ChatDialogsCard'
import { useChatComposer } from './hooks/useChatComposer'
import { useChatMessages } from './hooks/useChatMessages'
import { useChatConnection } from './hooks/useChatConnection'
import { useChatRuntimeConfig } from './hooks/useChatRuntimeConfig'
import {
  createChatCacheScope,
  deleteCachedChat,
  saveCachedChatMembers,
  saveCachedChats,
} from './chatCache'

const CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat.sidebar.collapsed.v1'

export default function ChatPage() {
  const { members, org, user } = useAuth()
  const chatRuntimeConfig = useChatRuntimeConfig()

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
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [groupCardOpen, setGroupCardOpen] = useState(false)

  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
  })
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 1023px)').matches
  })

  const selectedChatIdRef = useRef<string | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<ChatMessageInfo[]>([])

  const chatCacheScope = useMemo(() => createChatCacheScope(user?.id, org?.id), [org?.id, user?.id])

  const scrollMessagesToBottom = useCallback(() => {
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const getLastKnownSeqNo = useCallback(() => {
    return messagesRef.current[messagesRef.current.length - 1]?.seq_no ?? 0
  }, [])

  const {
    touchTypingActivity,
    stopTyping,
  } = useChatConnection({
    selectedChatId,
    cacheScope: chatCacheScope,
    selectedChatIdRef,
    userId: user?.id,
    telemetryEnabled: chatRuntimeConfig.telemetryEnabled,
    realtimeEnabled: chatRuntimeConfig.realtimeEnabled,
    messagesViewportRef,
    scrollMessagesToBottom,
    setPresence,
    setTypingUsers,
    setChats,
    setMessages,
    setChatMembers,
    setAckedOwnMessages,
    setNewMessagesCount,
    getLastKnownSeqNo,
  })

  const {
    handleMessagesScroll,
    scrollToLatest,
    handleDeleteMessage,
    handleCopyMessage,
  } = useChatMessages({
    selectedChatId,
    cacheScope: chatCacheScope,
    userId: user?.id,
    loadingMessages,
    loadingOlderMessages,
    hasMoreMessages,
    newMessagesCount,
    messages,
    messagesViewportRef,
    scrollMessagesToBottom,
    setLoadingChats,
    setChats,
    setSelectedChatId,
    setLoadingMessages,
    setLoadingOlderMessages,
    setHasMoreMessages,
    setMessages,
    setChatMembers,
    setPresence,
    setTypingUsers,
    setReplyToMessageId,
    setMenuOpenMessageId,
    setAckedOwnMessages,
    setNewMessagesCount,
    setIsNearBottom,
    setErrorText,
  })

  const {
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
  } = useChatComposer({
    selectedChatId,
    userId: user?.id,
    replyToMessageId,
    stopTyping,
    scrollMessagesToBottom,
    onOwnMessageSent: (created) => {
      setAckedOwnMessages((prev) => ({ ...prev, [created.id]: false }))
      setChatMembers((prev) =>
        prev.map((member) =>
          member.user_id === user?.id
            ? { ...member, last_read_seq_no: Math.max(member.last_read_seq_no, created.seq_no) }
            : member,
        ),
      )
    },
    onError: (message) => setErrorText(message),
    clearError: () => setErrorText(''),
    setReplyToMessageId,
  })

  useEffect(() => {
    setAddMemberOpen(false)
    setDeleteChatConfirmOpen(false)
    setAddingMemberUserId('')
    setProfileModalOpen(false)
    setProfileUserId(null)
    setGroupCardOpen(false)
  }, [selectedChatId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 1023px)')
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches)
    }
    setIsMobileViewport(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHAT_SIDEBAR_COLLAPSED_STORAGE_KEY, isDesktopSidebarCollapsed ? '1' : '0')
  }, [isDesktopSidebarCollapsed])

  const memberMetaById = useMemo(() => {
    return new Map(
      members.map((member) => [
        member.user_id,
        {
          label: `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim() || member.user_email || member.user_id,
          avatarUrl: member.user_avatar_url || null,
        },
      ]),
    )
  }, [members])

  const orgMemberByUserId = useMemo(() => {
    return new Map(members.map((member) => [member.user_id, member]))
  }, [members])

  const memberLabelsById = useMemo(() => {
    return new Map(members.map((member) => [member.user_id, memberMetaById.get(member.user_id)?.label || member.user_id]))
  }, [memberMetaById, members])

  const selectedChat = useMemo(() => chats.find((chat) => chat.id === selectedChatId) || null, [chats, selectedChatId])

  const currentChatMemberRole = useMemo(() => {
    if (!user?.id) return ''
    return String(chatMembers.find((member) => member.user_id === user.id)?.role || '').toLowerCase()
  }, [chatMembers, user?.id])

  const canManageSelectedChat = currentChatMemberRole === 'owner' || currentChatMemberRole === 'admin'
  const canManageMembers = canManageSelectedChat && selectedChat?.chat_type !== 'direct'
  const canDeleteSelectedChat = canManageSelectedChat
  const canOpenGroupCard = Boolean(selectedChat && selectedChat.chat_type !== 'direct')

  const selectedChatMemberIdsSet = useMemo(() => new Set(chatMembers.map((member) => member.user_id)), [chatMembers])

  const addableChatMembers = useMemo(() => {
    if (!selectedChat || selectedChat.chat_type === 'direct') return []
    return members.filter((member) => member.user_id !== user?.id && !selectedChatMemberIdsSet.has(member.user_id))
  }, [members, selectedChat, selectedChatMemberIdsSet, user?.id])

  const selectedChatMembers = useMemo(() => {
    if (!selectedChat) return []
    return selectedChat.member_ids.map((id) => {
      const meta = memberMetaById.get(id)
      const label = meta?.label || id
      return {
        userId: id,
        label,
        initials: getInitials(label),
        online: Boolean(presence[id]),
        avatarUrl: meta?.avatarUrl || null,
      }
    })
  }, [memberMetaById, presence, selectedChat])

  const selectedChatAdmins = useMemo(() => {
    const adminIds = new Set(
      chatMembers
        .filter((member) => {
          const role = String(member.role || '').toLowerCase()
          return role === 'owner' || role === 'admin'
        })
        .map((member) => member.user_id),
    )
    return selectedChatMembers.filter((member) => adminIds.has(member.userId))
  }, [chatMembers, selectedChatMembers])

  const selectedChatCreatedByLabel = useMemo(() => {
    if (!selectedChat) return ''
    return memberMetaById.get(selectedChat.created_by)?.label || selectedChat.created_by
  }, [memberMetaById, selectedChat])

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
    const query = dialogsQuery.trim().toLowerCase()
    if (!query) return chats
    return chats.filter((chat) => {
      const title = getChatDisplayTitle(chat).toLowerCase()
      const type = String(chat.chat_type || '').toLowerCase()
      const memberHit = chat.member_ids.some((memberId) => (memberMetaById.get(memberId)?.label || memberId).toLowerCase().includes(query))
      return title.includes(query) || type.includes(query) || memberHit
    })
  }, [chats, dialogsQuery, getChatDisplayTitle, memberMetaById])

  const visibleMessages = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return messages
    return messages.filter((message) => message.body.toLowerCase().includes(query))
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

  const getMessageOwnerLabel = (message: ChatMessageInfo): string => {
    return memberMetaById.get(message.sender_id)?.label || message.sender_id
  }

  const getUserAvatarUrl = useCallback(
    (userId: string): string | null => memberMetaById.get(userId)?.avatarUrl || null,
    [memberMetaById],
  )

  const getChatAvatarUserId = useCallback(
    (chat: ChatInfo): string | null => {
      if (chat.chat_type !== 'direct') return null
      return chat.member_ids.find((id) => id !== user?.id) || null
    },
    [user?.id],
  )

  const getChatAvatarUrl = useCallback(
    (chat: ChatInfo): string | null => {
      const peerId = getChatAvatarUserId(chat)
      if (!peerId) return null
      return memberMetaById.get(peerId)?.avatarUrl || null
    },
    [getChatAvatarUserId, memberMetaById],
  )

  const handleOpenUserProfile = useCallback(
    (targetUserId: string) => {
      if (!targetUserId || !orgMemberByUserId.has(targetUserId)) return
      setProfileUserId(targetUserId)
      setProfileModalOpen(true)
    },
    [orgMemberByUserId],
  )

  const selectedProfileUser = useMemo(() => {
    if (!profileUserId) return null
    const member = orgMemberByUserId.get(profileUserId)
    if (!member) return null
    const label = memberMetaById.get(profileUserId)?.label || profileUserId
    const orgRoleRaw = String(member.role || '').toLowerCase()
    const orgRoleLabel = orgRoleRaw
      ? orgRoleRaw.charAt(0).toUpperCase() + orgRoleRaw.slice(1)
      : 'Не указана'
    return {
      userId: profileUserId,
      label,
      avatarUrl: member.user_avatar_url || null,
      email: member.user_email || '',
      orgRoleLabel,
      online: Boolean(presence[profileUserId]),
    }
  }, [memberMetaById, orgMemberByUserId, presence, profileUserId])

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

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
  }

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) => {
      if (newChatType === 'direct') {
        if (prev.includes(memberId)) return []
        return [memberId]
      }
      if (prev.includes(memberId)) return prev.filter((id) => id !== memberId)
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
        setChats((prev) => {
          const next = [created, ...prev]
          if (chatCacheScope) void saveCachedChats(chatCacheScope, next)
          return next
        })
        setSelectedChatId(created.id)
        setNewChatTitle('')
        setNewChatType('group')
        setSelectedMemberIds([])
        setCreateChatOpen(false)
      } else {
        setErrorText(response.data.error?.message || 'Не удалось создать чат')
      }
    } catch (error) {
      setErrorText(extractApiError(error, 'Не удалось создать чат'))
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
      setChatMembers((prev) => {
        if (prev.some((member) => member.user_id === createdMember.user_id)) return prev
        const next = [...prev, createdMember]
        if (chatCacheScope && selectedChatId) void saveCachedChatMembers(chatCacheScope, selectedChatId, next)
        return next
      })
      setChats((prev) => {
        const next = prev.map((chat) =>
          chat.id === selectedChatId
            ? {
                ...chat,
                member_ids: chat.member_ids.includes(createdMember.user_id)
                  ? chat.member_ids
                  : [...chat.member_ids, createdMember.user_id],
              }
            : chat,
        )
        if (chatCacheScope) void saveCachedChats(chatCacheScope, next)
        return next
      })
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
        if (chatCacheScope) {
          void saveCachedChats(chatCacheScope, next)
          void deleteCachedChat(chatCacheScope, selectedChat.id)
        }
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

  return (
    <>
      {/* Title visible only on desktop */}
      <div className="hidden md:flex mb-4 items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Мессенджер</h1>
          <p className="text-sm text-muted-foreground">Диалоги, группы и вложения в одном окне</p>
        </div>
      </div>

      {errorText && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
        profileModalOpen={profileModalOpen}
        setProfileModalOpen={setProfileModalOpen}
        selectedProfileUser={selectedProfileUser}
        groupCardOpen={groupCardOpen}
        setGroupCardOpen={setGroupCardOpen}
        canOpenGroupCard={canOpenGroupCard}
        selectedChatMembers={selectedChatMembers}
        selectedChatAdmins={selectedChatAdmins}
        selectedChatCreatedByLabel={selectedChatCreatedByLabel}
      />

      {/* Chat container: fixed full-screen on mobile, card on desktop */}
      <div className="fixed inset-x-0 top-14 bottom-0 z-20 md:static md:inset-auto md:bottom-auto md:z-auto md:h-[75vh] md:min-h-[550px] md:overflow-hidden md:rounded-2xl md:border md:border-border/60 md:shadow-xl">
        <ChatDialogsCard
          chatRealtimeEnabled={chatRuntimeConfig.realtimeEnabled}
          chatTelemetryEnabled={chatRuntimeConfig.telemetryEnabled}
          isDesktopSidebarCollapsed={isDesktopSidebarCollapsed}
          setIsDesktopSidebarCollapsed={setIsDesktopSidebarCollapsed}
          dialogsQuery={dialogsQuery}
          setDialogsQuery={setDialogsQuery}
          selectedChat={selectedChat}
          getChatDisplayTitle={getChatDisplayTitle}
          getChatAvatarUrl={getChatAvatarUrl}
          getChatAvatarUserId={getChatAvatarUserId}
          selectedChatMembers={selectedChatMembers}
          isMobileViewport={isMobileViewport}
          typingLabels={typingLabels}
          canManageMembers={canManageMembers}
          canOpenGroupCard={canOpenGroupCard}
          onOpenGroupCard={() => setGroupCardOpen(true)}
          onOpenUserProfile={handleOpenUserProfile}
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
          mediaPreview={mediaPreview as MediaPreviewState | null}
          setMediaPreview={setMediaPreview}
          onOpenCreateChat={() => setCreateChatOpen(true)}
          visibleChats={visibleChats}
          loadingChats={loadingChats}
          onSelectChat={handleSelectChat}
          onDeselectChat={() => setSelectedChatId(null)}
        />
      </div>
    </>
  )
}
