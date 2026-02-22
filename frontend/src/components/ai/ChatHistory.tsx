import { History, PanelLeftClose, Plus, Trash2 } from 'lucide-react'
import type { AIChatSession } from '@/lib/api'

interface ChatHistoryProps {
  chats: AIChatSession[]
  currentChatId: string
  loadingChats: boolean
  onSelect: (chatId: string) => void
  onDelete: (chatId: string) => void
  onNewChat: () => Promise<void>
  onClose: () => void
}

export default function ChatHistory({
  chats,
  currentChatId,
  loadingChats,
  onSelect,
  onDelete,
  onNewChat,
  onClose,
}: ChatHistoryProps) {
  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Закрыть историю" />
      <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-card border-r border-border p-3 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-4 w-4" />
            <span>История чатов</span>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-secondary"
            title="Закрыть"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {loadingChats && <p className="text-xs text-muted-foreground px-2 py-1">Загрузка...</p>}
          {chats.map((c) => (
            <div key={c.id} className={`group rounded-lg ${currentChatId === c.id ? 'bg-primary text-white' : 'hover:bg-secondary'} transition-colors`}>
              <button
                onClick={() => { onSelect(c.id); onClose() }}
                className="w-full text-left px-2 py-2 text-sm"
              >
                <p className="truncate font-medium">{c.title}</p>
                <p className={`truncate text-xs ${currentChatId === c.id ? 'text-white/80' : 'text-muted-foreground'}`}>
                  {c.last_message_preview || 'Пустой чат'}
                </p>
              </button>
              <div className={`px-2 pb-2 ${currentChatId === c.id ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                <button
                  onClick={() => onDelete(c.id)}
                  className={`text-xs inline-flex items-center gap-1 ${currentChatId === c.id ? 'text-white/90 hover:text-white' : 'text-destructive hover:text-destructive/80'}`}
                >
                  <Trash2 className="h-3 w-3" /> Удалить
                </button>
              </div>
            </div>
          ))}
          {chats.length === 0 && !loadingChats && (
            <p className="text-xs text-muted-foreground px-2 py-1">Пока нет чатов</p>
          )}
        </div>

        <div className="pt-2 border-t border-border mt-2">
          <button
            onClick={async () => { await onNewChat(); onClose() }}
            className="w-full h-9 rounded-lg border border-border text-sm hover:bg-secondary flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Новый чат
          </button>
        </div>
      </div>
    </div>
  )
}
