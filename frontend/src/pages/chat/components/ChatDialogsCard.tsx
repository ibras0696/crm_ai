import { useState } from 'react'
import { AlertTriangle, ArrowDown, Camera, ChevronLeft, ChevronRight, Image, Loader2, MessageSquare, Mic, Paperclip, Plus, Search, SendHorizontal, Square, Trash2, UserPlus, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { linkifyTextToNodes } from '@/lib/linkify'
import {
  AttachmentPreview,
  CHAT_ATTACHMENT_MAX_MB,
  MESSAGE_MAX_CHARS,
  formatDayDivider,
  formatDurationLabel,
  formatFileSize,
  getInitials,
  getMessageAttachments,
  isVoiceAttachment,
  scanSensitiveText,
  toDayKey,
} from '../chatHelpers'

export function ChatDialogsCard(props: Record<string, unknown>) {
  const [revealedSensitiveMessages, setRevealedSensitiveMessages] = useState<Record<string, boolean>>({})
  const {
    isMobileDialogsOpen,
    setIsMobileDialogsOpen,
    isDesktopSidebarCollapsed,
    setIsDesktopSidebarCollapsed,
    renderChatList,
    dialogsQuery,
    setDialogsQuery,
    selectedChat,
    getChatDisplayTitle,
    selectedChatMembers,
    isMobileViewport,
    typingLabels,
    canManageMembers,
    setAddMemberOpen,
    setSearchOpen,
    searchOpen,
    searchQuery,
    setSearchQuery,
    canDeleteSelectedChat,
    onRequestDeleteSelectedChat,
    deletingChat,
    messagesViewportRef,
    handleMessagesScroll,
    loadingOlderMessages,
    hasMoreMessages,
    loadingMessages,
    messages,
    visibleMessages,
    user,
    membersById,
    getUserAvatarUrl,
    getMessageOwnerLabel,
    getOwnMessageStatus,
    expandedMessages,
    isExpandableMessage,
    setExpandedMessages,
    menuOpenMessageId,
    setMenuOpenMessageId,
    handleCopyMessage,
    setReplyToMessageId,
    composerRef,
    handleDeleteMessage,
    newMessagesCount,
    isNearBottom,
    scrollToLatest,
    replyToMessage,
    composerAttachments,
    handleRemoveComposerAttachment,
    isRecordingVoice,
    voiceRecordingElapsedMs,
    mediaAttachmentInputRef,
    handleMediaInputChange,
    cameraPhotoAttachmentInputRef,
    handleCameraPhotoInputChange,
    cameraVideoAttachmentInputRef,
    handleCameraVideoInputChange,
    fileAttachmentInputRef,
    handleFileInputChange,
    attachMenuRef,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    selectedChatId,
    sending,
    hasUploadingAttachments,
    openMediaPicker,
    openCameraPhotoPicker,
    openCameraVideoPicker,
    openFilePicker,
    draft,
    setDraft,
    touchTypingActivity,
    stopTyping,
    handleComposerPaste,
    canSendMessage,
    readyComposerAttachments,
    handleSend,
    startVoiceRecording,
    stopVoiceRecording,
    mediaPreview,
    setMediaPreview,
    onOpenCreateChat,
  } = props as any

  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev: Record<string, boolean>) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const toggleSensitiveMessageRevealed = (messageId: string) => {
    setRevealedSensitiveMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  return (
      <Card className="overflow-hidden rounded-2xl border border-border/70 bg-background/55 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
        {(isDesktopSidebarCollapsed || isMobileViewport) && (
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 px-3 py-2 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              {isDesktopSidebarCollapsed && (
                <div className="hidden items-center gap-1 rounded-full border border-border/70 bg-background/90 p-1 shadow-sm backdrop-blur lg:flex">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full border border-border/60"
                    onClick={() => setIsDesktopSidebarCollapsed(false)}
                    aria-label="Открыть панель чатов"
                    title="Показать диалоги"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full border border-primary/35 bg-primary/15 text-primary hover:bg-primary/25"
                    onClick={onOpenCreateChat}
                    aria-label="Создать чат"
                    title="Новый чат"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 lg:hidden">
              <Button
                type="button"
                className="h-8 rounded-full border border-primary/30 bg-primary/15 px-3 text-xs text-primary hover:bg-primary/25"
                variant="ghost"
                onClick={onOpenCreateChat}
                aria-label="Создать чат"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Новый
              </Button>
              <Button
                type="button"
                className="h-8 rounded-full border border-primary/30 bg-primary/15 px-3 text-xs text-primary hover:bg-primary/25"
                variant="ghost"
                onClick={() => setIsMobileDialogsOpen(true)}
                aria-label="Открыть диалоги"
              >
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Чаты
              </Button>
            </div>
          </CardHeader>
        )}
        <CardContent className="relative h-[80vh] min-h-[520px] max-h-[900px] p-0 sm:min-h-[600px]">
          <div className="relative flex h-full min-h-0">
            {isDesktopSidebarCollapsed ? (
              null
            ) : (
              <aside className="hidden h-full w-[340px] shrink-0 border-r border-border/60 bg-background/95 lg:flex lg:flex-col">
                <div className="space-y-2 border-b border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Диалоги</span>
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
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={dialogsQuery}
                      onChange={(event) => setDialogsQuery(event.target.value)}
                      placeholder="Поиск чатов"
                      className="h-9 rounded-full border-border/70 bg-background/80 pl-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                  <span className="text-[11px] text-muted-foreground">Список чатов</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-full border border-primary/35 bg-primary/10 text-primary hover:bg-primary/20"
                      onClick={onOpenCreateChat}
                      aria-label="Создать чат"
                      title="Новый чат"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {renderChatList(false)}
                </div>
              </aside>
            )}

            <div className="flex min-w-0 flex-1 flex-col bg-background/40">
              <div className="border-b border-border/60 bg-background/92 px-3 py-3 sm:px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {selectedChat && (
                      <div className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-muted/20 text-[11px] font-semibold text-muted-foreground">
                        {getInitials(getChatDisplayTitle(selectedChat)).slice(0, 2)}
                      </div>
                    )}
                    <div className="truncate text-sm font-semibold sm:text-base">
                      {selectedChat ? getChatDisplayTitle(selectedChat) : 'Выберите чат'}
                    </div>
                    {selectedChat && (
                      isMobileViewport ? (
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <div className="flex -space-x-1">
                            {selectedChatMembers.slice(0, 3).map((member: any) => (
                              <Avatar
                                key={member.userId}
                                className="h-5 w-5 border border-border/70"
                              >
                                <AvatarImage src={member.avatarUrl || undefined} alt={member.label} />
                                <AvatarFallback className="bg-muted/20 text-[9px] font-medium" title={member.label}>
                                  {member.initials}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                          </div>
                          <span>{selectedChatMembers.length} участников</span>
                          <span className="text-emerald-400">
                            {selectedChatMembers.filter((member: any) => member.online).length} онлайн
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {selectedChatMembers.slice(0, 5).map((member: any) => (
                              <span key={member.userId} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${member.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                                <span className="max-w-[120px] truncate">{member.label}</span>
                              </span>
                            ))}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>Онлайн: {selectedChatMembers.filter((member: any) => member.online).length}/{selectedChatMembers.length}</span>
                            <span>Источник: Telegram</span>
                            <span>Сделка: В работе</span>
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
                    {canManageMembers && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setAddMemberOpen(true)}
                        aria-label="Добавить участника"
                        title="Добавить участника"
                      >
                        <UserPlus className="h-4 w-4" />
                      </Button>
                    )}
                    <Button type="button" size="icon" variant="ghost" className="h-9 w-9 rounded-full border border-transparent hover:border-border/60" onClick={() => setSearchOpen((prev: boolean) => !prev)} aria-label="Поиск по сообщениям">
                      <Search className="h-4 w-4" />
                    </Button>
                    {canDeleteSelectedChat && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 rounded-full border border-transparent hover:border-border/60"
                        onClick={onRequestDeleteSelectedChat}
                        disabled={deletingChat}
                        aria-label="Удалить группу"
                        title="Удалить группу"
                      >
                        {deletingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    )}
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
                className="min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto bg-background/20 px-3 py-3 sm:px-5"
              >
                {loadingOlderMessages && (
                  <div className="pb-1 text-center text-xs text-muted-foreground">Загрузка предыдущих сообщений...</div>
                )}
                {!selectedChat ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
                    {isMobileViewport ? 'Откройте список через кнопку "Чаты"' : 'Выберите диалог слева'}
                  </div>
                ) : loadingMessages ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Сообщений пока нет</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Поиск не дал результатов</div>
                ) : (
                  <>
                    {!hasMoreMessages && (
                      <div className="pb-1 text-center text-xs text-muted-foreground">Начало переписки</div>
                    )}
                    {visibleMessages.map((message: any, index: number) => {
                      const own = message.sender_id === user?.id
                      const prev = visibleMessages[index - 1]
                      const showDayDivider = !prev || toDayKey(prev.created_at) !== toDayKey(message.created_at)
                      const showSender = !own && (!prev || prev.sender_id !== message.sender_id || showDayDivider)
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
                      const sensitiveScan = scanSensitiveText(message.body)
                      const sensitiveRevealed = Boolean(revealedSensitiveMessages[message.id])
                      const displayBody = sensitiveScan.hasSensitive && !sensitiveRevealed
                        ? sensitiveScan.maskedText
                        : message.body
                      const metaReplyToId = message.meta?.reply_to_message_id
                      const replyTarget = metaReplyToId ? messages.find((m: any) => m.id === metaReplyToId) || null : null
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
                      const safeReplyPreviewText = scanSensitiveText(replyPreviewText).maskedText

                      return (
                        <div key={message.id}>
                          {showDayDivider && (
                            <div className="my-2 text-center text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border/60 px-2 py-0.5">{formatDayDivider(message.created_at)}</span>
                            </div>
                          )}
                          <div className={`group flex w-full min-w-0 items-end gap-2 ${own ? 'justify-end' : 'justify-start'}`}>
                            {!own && (
                              <Avatar className="mb-1 h-7 w-7 shrink-0 border border-border/70">
                                <AvatarImage src={getUserAvatarUrl(message.sender_id) || undefined} alt={senderLabel} />
                                <AvatarFallback className="bg-muted/30 text-[10px] font-semibold text-muted-foreground">
                                  {getInitials(senderLabel)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className={`min-w-0 ${own ? 'max-w-[86%] sm:max-w-[62%] text-right' : 'max-w-[95%] sm:max-w-[68%] text-left'}`}>
                              {showSender && (
                                <div className="mb-1 truncate px-1 text-[11px] text-muted-foreground">{senderLabel}</div>
                              )}
                              <div
                                className={`relative max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm ${
                                  own
                                    ? 'ml-auto rounded-br-md border border-primary/25 bg-primary text-primary-foreground text-right'
                                    : 'mr-auto rounded-bl-md border border-border/60 bg-muted/[0.22] text-left'
                                }`}
                              >
                                {replyTarget && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const indexInFull = messages.findIndex((m: any) => m.id === replyTarget.id)
                                      if (indexInFull >= 0) {
                                        setExpandedMessages((prev: Record<string, boolean>) => ({ ...prev, [replyTarget.id]: true }))
                                      }
                                    }}
                                    className={`mb-2 block w-full overflow-hidden rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground ${
                                      own ? 'text-right' : 'text-left'
                                    }`}
                                  >
                                    <div>Ответ на: {(membersById.get(replyTarget.sender_id) || replyTarget.sender_id)} ·</div>
                                    <div className="mt-0.5 break-all">
                                      {safeReplyPreviewText.slice(0, 80)}
                                      {safeReplyPreviewText.length > 80 ? '…' : ''}
                                    </div>
                                  </button>
                                )}

                                {sensitiveScan.hasSensitive && (
                                  <div
                                    className={`mb-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                                      own
                                        ? 'border-white/25 bg-white/12 text-primary-foreground/90'
                                        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    }`}
                                  >
                                    <div className={`flex items-center gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                      <span className="truncate">
                                        Скрыты чувствительные данные: {sensitiveScan.labels.join(', ')}
                                      </span>
                                    </div>
                                    <div className={`mt-1 flex flex-wrap gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                                      <button
                                        type="button"
                                        className="rounded border border-current/25 px-2 py-0.5 hover:bg-current/10"
                                        onClick={() => toggleSensitiveMessageRevealed(message.id)}
                                      >
                                        {sensitiveRevealed ? 'Скрыть' : 'Показать'}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded border border-current/25 px-2 py-0.5 hover:bg-current/10"
                                        onClick={() => void handleCopyMessage(message.body)}
                                      >
                                        Скопировать
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {shouldRenderBody && (
                                  <div
                                    className={`min-w-0 whitespace-pre-wrap break-words ${expandable && !expanded ? 'max-h-28 overflow-hidden' : ''} ${
                                      own ? 'text-right' : 'text-left'
                                    }`}
                                  >
                                    {linkifyTextToNodes(displayBody)}
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
                                    {attachments.map((attachment: any) => (
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
                                  onClick={() => setMenuOpenMessageId((prev: string | null) => (prev === message.id ? null : message.id))}
                                  className={`absolute top-1 hidden rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-background/70 group-hover:block ${
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
                              <div className={`mt-1 px-1 text-[10px] text-muted-foreground/90 ${own ? 'text-right' : 'text-left'}`}>
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

              <div className="sticky bottom-0 border-t border-border/60 bg-background/92 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4">
                {replyToMessage && (
                  <div className="mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
                    <div className="truncate">
                      Ответ на: <span className="text-muted-foreground">{getMessageOwnerLabel(replyToMessage)}</span> ·{' '}
                      {scanSensitiveText(replyToMessage.body.trim()).maskedText || (getMessageAttachments(replyToMessage).length > 0 ? 'Вложение' : '')}
                    </div>
                    <button type="button" onClick={() => setReplyToMessageId(null)} className="ml-2 rounded px-1 hover:bg-muted/50">
                      ×
                    </button>
                  </div>
                )}

                {composerAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {composerAttachments.map((attachment: any) => {
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

                <div className="relative flex items-end gap-2 rounded-3xl border border-border/70 bg-background/95 p-2 shadow-sm" ref={attachMenuRef}>
                  <div className="relative shrink-0">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 rounded-full border border-border/70 bg-background/80"
                      onClick={() => setIsAttachMenuOpen((prev: boolean) => !prev)}
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
                    placeholder={selectedChat ? 'Напишите сообщение...' : 'Выберите чат'}
                    disabled={!selectedChat || sending || isRecordingVoice}
                    className="max-h-40 min-h-[40px] flex-1 resize-none rounded-2xl border border-transparent bg-transparent px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      className="h-10 w-10 rounded-full shadow-sm"
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
                      className="h-10 w-10 rounded-full bg-primary shadow-sm hover:bg-primary/90"
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
                      variant="ghost"
                      className="h-10 w-10 rounded-full border border-border/70"
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
            <aside className="hidden w-[340px] shrink-0 border-l border-border/60 bg-background/95 p-3 xl:block">
              <div className="space-y-3">
                <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Клиент
                  </div>
                  <div className="text-sm font-semibold">{selectedChat ? getChatDisplayTitle(selectedChat) : 'Не выбран'}</div>
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    <div>Канал: Telegram</div>
                    <div>Ответственный: Ибрагим</div>
                    <div>Статус: Новый лид</div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <UserPlus className="h-3.5 w-3.5" />
                    Сделка
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div>Этап: Переговоры</div>
                    <div>Сумма: 120 000 ₽</div>
                    <div className="flex items-center gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      Следующее действие: Позвонить завтра
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/10 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Search className="h-3.5 w-3.5" />
                    Задачи
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">Проверить оплату</div>
                    <div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">Отправить инструкцию</div>
                    <div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">Подтвердить подключение</div>
                  </div>
                </div>
              </div>
            </aside>
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
                  <div className="space-y-2 border-b border-border/60 px-3 py-3">
                    <div className="flex items-center justify-between">
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
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={dialogsQuery}
                        onChange={(event) => setDialogsQuery(event.target.value)}
                        placeholder="Поиск чатов"
                        className="h-9 rounded-full border-border/70 bg-background/80 pl-8 text-sm"
                      />
                    </div>
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
  )
}
