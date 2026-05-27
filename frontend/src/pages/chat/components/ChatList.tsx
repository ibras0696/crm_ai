import type { ChatInfo } from '@/lib/api'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { chatTypeLabel, getInitials } from '../chatHelpers'

interface ChatListProps {
  loadingChats: boolean
  chats: ChatInfo[]
  selectedChatId: string | null
  compact: boolean
  getChatDisplayTitle: (chat: ChatInfo) => string
  getChatAvatarUrl: (chat: ChatInfo) => string | null
  getChatAvatarUserId: (chat: ChatInfo) => string | null
  onOpenUserProfile: (userId: string) => void
  onSelectChat: (chatId: string) => void
}

export function ChatList({
  loadingChats,
  chats,
  selectedChatId,
  compact,
  getChatDisplayTitle,
  getChatAvatarUrl,
  getChatAvatarUserId,
  onOpenUserProfile,
  onSelectChat,
}: ChatListProps) {
  const formatChatTime = (iso: string): string => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay =
      date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate()
    if (sameDay) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }

  if (loadingChats) {
    return <div className="p-2 text-sm text-muted-foreground">Загрузка...</div>
  }
  if (chats.length === 0) {
    return <div className="p-3 text-sm text-muted-foreground">Ничего не найдено</div>
  }

  return chats.map((chat) => {
    const isActive = chat.id === selectedChatId
    const title = getChatDisplayTitle(chat)
    const avatarUrl = getChatAvatarUrl(chat)
    const avatarUserId = getChatAvatarUserId(chat)

    if (compact) {
      const compactLabel = getInitials(title).slice(0, 1)
      return (
        <button
          key={chat.id}
          type="button"
          onClick={() => onSelectChat(chat.id)}
          title={title}
          className={`mb-1.5 flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold transition ${
            isActive
              ? 'border-primary/50 bg-primary/15 text-primary'
              : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/30'
          }`}
        >
          {compactLabel}
        </button>
      )
    }

    return (
      <button
        key={chat.id}
        type="button"
        onClick={() => onSelectChat(chat.id)}
        className={`mb-1 w-full rounded-xl border px-2.5 py-2.5 text-left transition ${
          isActive
            ? 'border-primary/45 bg-primary/10 text-primary shadow-sm'
            : 'border-transparent hover:border-border/70 hover:bg-muted/28'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {avatarUserId ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onOpenUserProfile(avatarUserId)
              }}
              className={`mt-0.5 h-10 w-10 shrink-0 rounded-full border ${
                isActive ? 'border-primary/45' : 'border-border/70'
              }`}
              aria-label={`Открыть профиль ${title}`}
            >
              <Avatar className="h-full w-full">
                <AvatarImage src={avatarUrl || undefined} alt={title} />
                <AvatarFallback className={`${isActive ? 'bg-primary/15 text-primary' : 'bg-background/60 text-muted-foreground'} text-[11px] font-semibold`}>
                  {getInitials(title).slice(0, 2)}
                </AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <div
              className={`mt-0.5 h-10 w-10 shrink-0 rounded-full border ${
                isActive ? 'border-primary/45' : 'border-border/70'
              }`}
            >
              <Avatar className="h-full w-full">
                <AvatarImage src={avatarUrl || undefined} alt={title} />
                <AvatarFallback className={`${isActive ? 'bg-primary/15 text-primary' : 'bg-background/60 text-muted-foreground'} text-[11px] font-semibold`}>
                  {getInitials(title).slice(0, 2)}
                </AvatarFallback>
              </Avatar>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className={`truncate text-sm font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}>
                {title}
              </div>
              <div className="shrink-0 pt-0.5 text-[10px] text-muted-foreground/90 tabular-nums">
                {formatChatTime(chat.updated_at)}
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px]">
                {chatTypeLabel(chat.chat_type)}
              </span>
              <span>•</span>
              <span>{chat.member_ids.length} участников</span>
            </div>
          </div>
        </div>
      </button>
    )
  })
}
