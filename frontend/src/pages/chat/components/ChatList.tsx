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
  if (loadingChats) {
    return <div className="p-2 text-sm text-muted-foreground">Загрузка...</div>
  }
  if (chats.length === 0) {
    return <div className="p-2 text-sm text-muted-foreground">Чатов пока нет</div>
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
        className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-sm transition ${
          isActive
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-transparent hover:border-border hover:bg-muted/40'
        }`}
      >
        <div className="truncate font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {chatTypeLabel(chat.chat_type)} · {chat.member_ids.length} участников
        </div>
      </button>
    )
  })
}
