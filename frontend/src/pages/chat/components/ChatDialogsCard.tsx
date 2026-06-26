import { useRef, useState } from 'react'
import {
  CaretLeft,
  DotsThreeVertical,
  MagnifyingGlass,
  PencilSimple,
  Trash,
  UserPlus,
  Users,
  ChatCircle,
} from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '../chatHelpers'
import { MessageViewport } from './messages/MessageViewport'
import { ChatComposerSection } from './composer/ChatComposerSection'
import { MediaPreviewOverlay } from './composer/MediaPreviewOverlay'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isToday) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const isThisWeek = now.getTime() - date.getTime() < 7 * 24 * 3600 * 1000
  if (isThisWeek)
    return date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// ---------------------------------------------------------------------------
// Chat list items (shared between mobile + desktop sidebar)
// ---------------------------------------------------------------------------

function ChatListItems({
  chats,
  loadingChats,
  selectedChatId,
  getChatDisplayTitle,
  getChatAvatarUrl,
  getChatAvatarUserId,
  onOpenUserProfile,
  onSelectChat,
}: {
  chats: any[]
  loadingChats: boolean
  selectedChatId: string | null
  getChatDisplayTitle: (c: any) => string
  getChatAvatarUrl: (c: any) => string | null
  getChatAvatarUserId: (c: any) => string | null
  onOpenUserProfile: (id: string) => void
  onSelectChat: (id: string) => void
}) {
  if (loadingChats) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-3 animate-pulse">
            <div className="h-12 w-12 shrink-0 rounded-full bg-muted/40" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-2/3 rounded bg-muted/40" />
              <div className="h-3 w-4/5 rounded bg-muted/30" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-muted-foreground">
        <ChatCircle size={40} weight="thin" />
        <p className="text-sm">Нет диалогов</p>
      </div>
    )
  }

  return (
    <div className="py-1">
      {chats.map((chat: any) => {
        const isActive = chat.id === selectedChatId
        const title = getChatDisplayTitle(chat)
        const avatarUrl = getChatAvatarUrl(chat)
        const avatarUserId = getChatAvatarUserId(chat)
        const initials = getInitials(title).slice(0, 2)

        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => onSelectChat(chat.id)}
            className={`flex w-full items-center gap-3 px-4 py-3 transition-colors ${
              isActive ? 'bg-primary/8' : 'hover:bg-muted/40 active:bg-muted/60'
            }`}
          >
            {/* Avatar */}
            <div className="relative shrink-0">
              {avatarUserId ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenUserProfile(avatarUserId) }}
                  className="h-12 w-12 rounded-full overflow-hidden"
                >
                  <Avatar className="h-full w-full">
                    <AvatarImage src={avatarUrl || undefined} alt={title} />
                    <AvatarFallback className="bg-primary/15 text-[13px] font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              ) : (
                <div className="h-12 w-12 rounded-full overflow-hidden">
                  <Avatar className="h-full w-full">
                    <AvatarImage src={avatarUrl || undefined} alt={title} />
                    <AvatarFallback className="bg-primary/15 text-[13px] font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </div>
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`truncate text-[15px] font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}>
                  {title}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatTime(chat.updated_at)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                {chat.member_ids.length} участников
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile: Screen A — chat list
// ---------------------------------------------------------------------------

function MobileListScreen({
  chats,
  loadingChats,
  selectedChatId,
  dialogsQuery,
  setDialogsQuery,
  getChatDisplayTitle,
  getChatAvatarUrl,
  getChatAvatarUserId,
  onOpenUserProfile,
  onSelectChat,
  onOpenCreateChat,
}: any) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-xl font-bold">Сообщения</h1>
        <button
          type="button"
          onClick={onOpenCreateChat}
          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted/50 transition-colors text-primary"
          aria-label="Новый чат"
        >
          <PencilSimple size={20} weight="duotone" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-[10px] bg-secondary/60 px-3 h-9">
          <MagnifyingGlass size={16} className="text-muted-foreground shrink-0" />
          <input
            value={dialogsQuery}
            onChange={(e) => setDialogsQuery(e.target.value)}
            placeholder="Поиск"
            className="flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <ChatListItems
          chats={chats}
          loadingChats={loadingChats}
          selectedChatId={selectedChatId}
          getChatDisplayTitle={getChatDisplayTitle}
          getChatAvatarUrl={getChatAvatarUrl}
          getChatAvatarUserId={getChatAvatarUserId}
          onOpenUserProfile={onOpenUserProfile}
          onSelectChat={onSelectChat}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile: Screen B — chat conversation
// ---------------------------------------------------------------------------

function MobileChatScreen({
  selectedChat,
  selectedChatMembers,
  typingLabels,
  getChatDisplayTitle,
  getChatAvatarUrl,
  getChatAvatarUserId,
  canManageMembers,
  canOpenGroupCard,
  onOpenGroupCard,
  onOpenUserProfile,
  setAddMemberOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  canDeleteSelectedChat,
  onRequestDeleteSelectedChat,
  deletingChat,
  onDeselectChat,
  // message + composer props passed through
  ...rest
}: any) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  const title = selectedChat ? getChatDisplayTitle(selectedChat) : ''
  const avatarUrl = selectedChat ? getChatAvatarUrl(selectedChat) : null
  const avatarUserId = selectedChat ? getChatAvatarUserId(selectedChat) : null
  const onlineCount = selectedChatMembers?.filter((m: any) => m.online).length ?? 0
  const typingText = typingLabels?.length > 0 ? `${typingLabels.join(', ')} печатает...` : null

  return (
    <div className="flex h-full flex-col overflow-hidden" onClick={() => setActionsOpen(false)}>
      {/* TG-style nav header */}
      <div className="flex items-center gap-1 border-b border-border/40 bg-background/95 px-1 py-2 backdrop-blur-md">
        {/* Back button */}
        <button
          type="button"
          onClick={onDeselectChat}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary hover:bg-muted/40 transition-colors"
          aria-label="Назад"
        >
          <CaretLeft size={22} weight="bold" />
        </button>

        {/* Avatar + title */}
        <button
          type="button"
          onClick={canOpenGroupCard ? onOpenGroupCard : (avatarUserId ? () => onOpenUserProfile(avatarUserId) : undefined)}
          className="flex min-w-0 flex-1 items-center gap-2.5"
          disabled={!avatarUserId && !canOpenGroupCard}
        >
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={avatarUrl || undefined} alt={title} />
            <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
              {getInitials(title).slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-left">
            <div className="truncate text-[15px] font-semibold leading-tight">{title}</div>
            <div className="truncate text-[12px] leading-tight text-muted-foreground">
              {typingText ?? (
                onlineCount > 0
                  ? `${onlineCount} онлайн · ${selectedChatMembers?.length ?? 0} участников`
                  : `${selectedChatMembers?.length ?? 0} участников`
              )}
            </div>
          </div>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSearchOpen((v: boolean) => !v) }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 transition-colors"
            aria-label="Поиск"
          >
            <MagnifyingGlass size={18} />
          </button>
          <div className="relative" ref={actionsRef}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setActionsOpen((v) => !v) }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 transition-colors"
              aria-label="Действия"
            >
              <DotsThreeVertical size={20} weight="bold" />
            </button>
            <AnimatePresence>
              {actionsOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -4 }}
                  transition={{ duration: 0.13, ease: [0.32, 0.72, 0, 1] }}
                  className="absolute right-0 top-10 z-30 min-w-[180px] overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canManageMembers && (
                    <button
                      type="button"
                      onClick={() => { setAddMemberOpen(true); setActionsOpen(false) }}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-sm text-left hover:bg-muted/50 transition-colors"
                    >
                      <UserPlus size={16} className="text-muted-foreground" />
                      Добавить участника
                    </button>
                  )}
                  {canOpenGroupCard && (
                    <button
                      type="button"
                      onClick={() => { onOpenGroupCard(); setActionsOpen(false) }}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-sm text-left hover:bg-muted/50 transition-colors"
                    >
                      <Users size={16} className="text-muted-foreground" />
                      Карточка группы
                    </button>
                  )}
                  {canDeleteSelectedChat && (
                    <button
                      type="button"
                      onClick={() => { onRequestDeleteSelectedChat(); setActionsOpen(false) }}
                      disabled={deletingChat}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors border-t border-border/60"
                    >
                      <Trash size={16} />
                      Удалить чат
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="border-b border-border/40 px-3 py-2">
          <div className="flex items-center gap-2 rounded-[10px] bg-secondary/60 px-3 h-9">
            <MagnifyingGlass size={15} className="text-muted-foreground shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск в чате..."
              autoFocus
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Messages */}
      <MessageViewport {...rest} selectedChat={selectedChat} onOpenUserProfile={onOpenUserProfile} />

      {/* Composer */}
      <ChatComposerSection {...rest} selectedChat={selectedChat} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop: combined sidebar + chat
// ---------------------------------------------------------------------------

function DesktopLayout({
  isDesktopSidebarCollapsed,
  setIsDesktopSidebarCollapsed,
  chats,
  loadingChats,
  selectedChat,
  selectedChatId,
  selectedChatMembers,
  typingLabels,
  dialogsQuery,
  setDialogsQuery,
  getChatDisplayTitle,
  getChatAvatarUrl,
  getChatAvatarUserId,
  canManageMembers,
  canOpenGroupCard,
  onOpenGroupCard,
  onOpenUserProfile,
  setAddMemberOpen,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  canDeleteSelectedChat,
  onRequestDeleteSelectedChat,
  deletingChat,
  onOpenCreateChat,
  onSelectChat,
  ...rest
}: any) {
  const title = selectedChat ? getChatDisplayTitle(selectedChat) : ''
  const avatarUrl = selectedChat ? getChatAvatarUrl(selectedChat) : null
  const avatarUserId = selectedChat ? getChatAvatarUserId(selectedChat) : null
  const onlineCount = selectedChatMembers?.filter((m: any) => m.online).length ?? 0
  const typingText = typingLabels?.length > 0 ? `${typingLabels.join(', ')} печатает...` : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      {!isDesktopSidebarCollapsed && (
        <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-border/60 bg-background/60">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Диалоги
            </span>
            <button
              type="button"
              onClick={onOpenCreateChat}
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted/50 text-primary transition-colors"
            >
              <PencilSimple size={16} weight="duotone" />
            </button>
          </div>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-[10px] bg-secondary/50 px-3 h-8">
              <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
              <input
                value={dialogsQuery}
                onChange={(e) => setDialogsQuery(e.target.value)}
                placeholder="Поиск"
                className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
            <ChatListItems
              chats={chats}
              loadingChats={loadingChats}
              selectedChatId={selectedChatId}
              getChatDisplayTitle={getChatDisplayTitle}
              getChatAvatarUrl={getChatAvatarUrl}
              getChatAvatarUserId={getChatAvatarUserId}
              onOpenUserProfile={onOpenUserProfile}
              onSelectChat={onSelectChat}
            />
          </div>
        </aside>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {selectedChat ? (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 border-b border-border/60 bg-background/95 px-4 py-3">
              {isDesktopSidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => setIsDesktopSidebarCollapsed(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:bg-muted/40 transition-colors"
                >
                  <CaretLeft size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={avatarUserId ? () => onOpenUserProfile(avatarUserId) : onOpenGroupCard}
                className="flex min-w-0 flex-1 items-center gap-2.5"
                disabled={!avatarUserId && !canOpenGroupCard}
              >
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={avatarUrl || undefined} alt={title} />
                  <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                    {getInitials(title).slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-left">
                  <div className="truncate text-sm font-semibold">{title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {typingText ?? (
                      onlineCount > 0
                        ? `${onlineCount} онлайн · ${selectedChatMembers?.length ?? 0} участников`
                        : `${selectedChatMembers?.length ?? 0} участников`
                    )}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {canManageMembers && (
                  <button
                    type="button"
                    onClick={() => setAddMemberOpen(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 transition-colors"
                  >
                    <UserPlus size={16} />
                  </button>
                )}
                {canOpenGroupCard && (
                  <button
                    type="button"
                    onClick={onOpenGroupCard}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 transition-colors"
                  >
                    <Users size={16} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSearchOpen((v: boolean) => !v)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/40 transition-colors ${searchOpen ? 'bg-muted/40' : ''}`}
                >
                  <MagnifyingGlass size={16} />
                </button>
                {canDeleteSelectedChat && (
                  <button
                    type="button"
                    onClick={onRequestDeleteSelectedChat}
                    disabled={deletingChat}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash size={16} />
                  </button>
                )}
                {isDesktopSidebarCollapsed === false && (
                  <button
                    type="button"
                    onClick={() => setIsDesktopSidebarCollapsed(true)}
                    className="ml-1 flex h-7 px-2 items-center gap-1 rounded-full border border-border/60 text-[11px] text-muted-foreground hover:bg-muted/40 transition-colors"
                  >
                    <CaretLeft size={12} />
                    Скрыть
                  </button>
                )}
              </div>
            </div>
            {searchOpen && (
              <div className="border-b border-border/40 px-4 py-2">
                <div className="flex items-center gap-2 rounded-[10px] bg-secondary/50 px-3 h-8">
                  <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск в чате..."
                    autoFocus
                    className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
              </div>
            )}
            <MessageViewport {...rest} selectedChat={selectedChat} />
            <ChatComposerSection {...rest} selectedChat={selectedChat} />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <ChatCircle size={48} weight="thin" />
            <p className="text-sm">Выберите диалог</p>
            {isDesktopSidebarCollapsed && (
              <button
                type="button"
                onClick={() => setIsDesktopSidebarCollapsed(false)}
                className="mt-2 rounded-full border border-border/60 px-4 py-1.5 text-xs hover:bg-muted/40 transition-colors"
              >
                Открыть диалоги
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ChatDialogsCard(props: Record<string, unknown>) {
  const {
    chatRealtimeEnabled,
    chatTelemetryEnabled,
    isMobileViewport,
    isDesktopSidebarCollapsed,
    setIsDesktopSidebarCollapsed,
    renderChatList: _,          // unused now, we render ourselves
    dialogsQuery,
    setDialogsQuery,
    selectedChat,
    selectedChatId,
    getChatDisplayTitle,
    getChatAvatarUrl,
    getChatAvatarUserId,
    selectedChatMembers,
    typingLabels,
    canManageMembers,
    canOpenGroupCard,
    onOpenGroupCard,
    onOpenUserProfile,
    setAddMemberOpen,
    setSearchOpen,
    searchOpen,
    searchQuery,
    setSearchQuery,
    canDeleteSelectedChat,
    onRequestDeleteSelectedChat,
    deletingChat,
    onOpenCreateChat,
    onDeselectChat,
    mediaPreview,
    setMediaPreview,
    // pass-through for MessageViewport & ChatComposerSection
    ...rest
  } = props as any

  // Extract chats and loading from the renderChatList closure via rest (not available),
  // so ChatPage needs to pass them explicitly. We re-use existing props.
  const chats: any[] = (props.visibleChats as any[]) ?? []
  const loadingChats: boolean = (props.loadingChats as boolean) ?? false

  const sharedProps = {
    chatRealtimeEnabled,
    chatTelemetryEnabled,
    selectedChatId,
    onOpenUserProfile,
    ...rest,
  }

  return (
    <div className="h-full overflow-hidden relative">
      {isMobileViewport ? (
        /* ---- Mobile: two screens with slide animation ---- */
        <AnimatePresence mode="wait" initial={false}>
          {!selectedChat ? (
            <motion.div
              key="list-screen"
              initial={{ x: '-30%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-30%', opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 bg-background"
            >
              <MobileListScreen
                chats={chats}
                loadingChats={loadingChats}
                selectedChatId={selectedChatId}
                dialogsQuery={dialogsQuery}
                setDialogsQuery={setDialogsQuery}
                getChatDisplayTitle={getChatDisplayTitle}
                getChatAvatarUrl={getChatAvatarUrl}
                getChatAvatarUserId={getChatAvatarUserId}
                onOpenUserProfile={onOpenUserProfile}
                onSelectChat={(id: string) => {
                  // selectChat is done via existing mechanism in ChatPage
                  ;(props.onSelectChat as (id: string) => void)?.(id)
                }}
                onOpenCreateChat={onOpenCreateChat}
              />
            </motion.div>
          ) : (
            <motion.div
              key="chat-screen"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 bg-background"
            >
              <MobileChatScreen
                selectedChat={selectedChat}
                selectedChatMembers={selectedChatMembers}
                typingLabels={typingLabels}
                getChatDisplayTitle={getChatDisplayTitle}
                getChatAvatarUrl={getChatAvatarUrl}
                getChatAvatarUserId={getChatAvatarUserId}
                canManageMembers={canManageMembers}
                canOpenGroupCard={canOpenGroupCard}
                onOpenGroupCard={onOpenGroupCard}
                onOpenUserProfile={onOpenUserProfile}
                setAddMemberOpen={setAddMemberOpen}
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                canDeleteSelectedChat={canDeleteSelectedChat}
                onRequestDeleteSelectedChat={onRequestDeleteSelectedChat}
                deletingChat={deletingChat}
                onDeselectChat={onDeselectChat}
                {...sharedProps}
              />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        /* ---- Desktop: sidebar + main ---- */
        <DesktopLayout
          isDesktopSidebarCollapsed={isDesktopSidebarCollapsed}
          setIsDesktopSidebarCollapsed={setIsDesktopSidebarCollapsed}
          chats={chats}
          loadingChats={loadingChats}
          selectedChat={selectedChat}
          selectedChatId={selectedChatId}
          selectedChatMembers={selectedChatMembers}
          typingLabels={typingLabels}
          dialogsQuery={dialogsQuery}
          setDialogsQuery={setDialogsQuery}
          getChatDisplayTitle={getChatDisplayTitle}
          getChatAvatarUrl={getChatAvatarUrl}
          getChatAvatarUserId={getChatAvatarUserId}
          canManageMembers={canManageMembers}
          canOpenGroupCard={canOpenGroupCard}
          onOpenGroupCard={onOpenGroupCard}
          onOpenUserProfile={onOpenUserProfile}
          setAddMemberOpen={setAddMemberOpen}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          canDeleteSelectedChat={canDeleteSelectedChat}
          onRequestDeleteSelectedChat={onRequestDeleteSelectedChat}
          deletingChat={deletingChat}
          onOpenCreateChat={onOpenCreateChat}
          onSelectChat={(id: string) => (props.onSelectChat as (id: string) => void)?.(id)}
          {...sharedProps}
        />
      )}

      <MediaPreviewOverlay mediaPreview={mediaPreview} setMediaPreview={setMediaPreview} />
    </div>
  )
}
