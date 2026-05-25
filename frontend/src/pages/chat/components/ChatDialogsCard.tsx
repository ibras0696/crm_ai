import { ChevronLeft, Loader2, MessageSquare, Plus, Search, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '../chatHelpers'
import { MessageViewport } from './messages/MessageViewport'
import { ChatComposerSection } from './composer/ChatComposerSection'
import { MediaPreviewOverlay } from './composer/MediaPreviewOverlay'

export function ChatDialogsCard(props: Record<string, unknown>) {
  const {
    chatRealtimeEnabled,
    chatTelemetryEnabled,
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

  return (
      <Card className="overflow-hidden rounded-2xl border border-border/70 bg-background/55 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
        {(isDesktopSidebarCollapsed || isMobileViewport) && (
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 px-3 py-2 sm:px-4">
            <div className="flex min-w-0 items-center gap-2">
              {isDesktopSidebarCollapsed && (
                <div className="hidden items-center lg:flex">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 rounded-full border border-border/60 bg-background px-2.5 text-[11px] text-foreground hover:bg-muted/40"
                    onClick={() => setIsDesktopSidebarCollapsed(false)}
                    aria-label="Открыть панель чатов"
                    title="Показать диалоги"
                  >
                    <MessageSquare className="mr-1 h-3 w-3" />
                    Чаты
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
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Онлайн: {selectedChatMembers.filter((member: any) => member.online).length}/{selectedChatMembers.length}
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

              <MessageViewport
                chatRealtimeEnabled={chatRealtimeEnabled}
                chatTelemetryEnabled={chatTelemetryEnabled}
                messagesViewportRef={messagesViewportRef}
                handleMessagesScroll={handleMessagesScroll}
                loadingOlderMessages={loadingOlderMessages}
                selectedChat={selectedChat}
                isMobileViewport={isMobileViewport}
                loadingMessages={loadingMessages}
                messages={messages}
                visibleMessages={visibleMessages}
                hasMoreMessages={hasMoreMessages}
                user={user}
                getMessageOwnerLabel={getMessageOwnerLabel}
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
                getUserAvatarUrl={getUserAvatarUrl}
                membersById={membersById}
                setMediaPreview={setMediaPreview}
                newMessagesCount={newMessagesCount}
                isNearBottom={isNearBottom}
                scrollToLatest={scrollToLatest}
              />

              <ChatComposerSection
                replyToMessage={replyToMessage}
                getMessageOwnerLabel={getMessageOwnerLabel}
                setReplyToMessageId={setReplyToMessageId}
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
                composerRef={composerRef}
                draft={draft}
                setDraft={setDraft}
                touchTypingActivity={touchTypingActivity}
                stopTyping={stopTyping}
                handleComposerPaste={handleComposerPaste}
                readyComposerAttachments={readyComposerAttachments}
                selectedChat={selectedChat}
                canSendMessage={canSendMessage}
                handleSend={handleSend}
                startVoiceRecording={startVoiceRecording}
                stopVoiceRecording={stopVoiceRecording}
              />
            </div>
          </div>

          <MediaPreviewOverlay mediaPreview={mediaPreview} setMediaPreview={setMediaPreview} />

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
