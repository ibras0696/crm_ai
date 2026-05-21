import type { ChatInfo } from '@/lib/api'
import { chatTypeLabel, getInitials } from '../chatHelpers'

interface ChatListProps {
  loadingChats: boolean
  chats: ChatInfo[]
  selectedChatId: string | null
  compact: boolean
  getChatDisplayTitle: (chat: ChatInfo) => string
  onSelectChat: (chatId: string) => void
}

export function ChatList({
  loadingChats,
  chats,
  selectedChatId,
  compact,
  getChatDisplayTitle,
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
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
              isActive
                ? 'border-primary/45 bg-primary/15 text-primary'
                : 'border-border/70 bg-background/60 text-muted-foreground'
            }`}
          >
            {getInitials(title).slice(0, 2)}
          </div>
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
