import { useEffect, useMemo, useState } from 'react'
import { isAxiosError } from 'axios'
import { chatApi, type ChatInfo, type ChatMessageInfo } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

function extractApiError(e: unknown, fallback: string): string {
  if (!isAxiosError(e)) return fallback
  const apiError = (e.response?.data as { error?: { message?: string } } | undefined)?.error
  if (apiError?.message) return apiError.message
  if (e.response?.status === 429) return 'Слишком много запросов. Попробуйте позже.'
  return fallback
}

export default function ChatPage() {
  const { members, user } = useAuth()
  const [chats, setChats] = useState<ChatInfo[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageInfo[]>([])
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [errorText, setErrorText] = useState('')

  const [newChatTitle, setNewChatTitle] = useState('')
  const [newChatType, setNewChatType] = useState<'direct' | 'group' | 'channel'>('group')
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [creatingChat, setCreatingChat] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const membersById = useMemo(() => {
    return new Map(
      members.map((m) => [m.user_id, `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id]),
    )
  }, [members])

  const selectedChat = useMemo(() => {
    return chats.find((x) => x.id === selectedChatId) || null
  }, [chats, selectedChatId])

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
    const loadMessages = async () => {
      if (!selectedChatId) {
        setMessages([])
        return
      }
      setLoadingMessages(true)
      setErrorText('')
      try {
        const response = await chatApi.listMessages(selectedChatId, 200, 0)
        if (response.data.ok && response.data.data) {
          const nextMessages = response.data.data
          setMessages(nextMessages)
          const lastSeqNo = nextMessages[nextMessages.length - 1]?.seq_no
          if (typeof lastSeqNo === 'number') {
            await chatApi.updateReadCursor(selectedChatId, { last_read_seq_no: lastSeqNo })
          }
        } else {
          setMessages([])
          setErrorText(response.data.error?.message || 'Не удалось загрузить сообщения')
        }
      } catch (e) {
        setMessages([])
        setErrorText(extractApiError(e, 'Не удалось загрузить сообщения'))
      } finally {
        setLoadingMessages(false)
      }
    }
    void loadMessages()
  }, [selectedChatId])

  const handleToggleMember = (memberId: string) => {
    setSelectedMemberIds((prev) => {
      if (prev.includes(memberId)) return prev.filter((x) => x !== memberId)
      return [...prev, memberId]
    })
  }

  const handleCreateChat = async () => {
    if (creatingChat) return
    if (newChatType !== 'direct' && !newChatTitle.trim()) {
      setErrorText('Укажите название чата')
      return
    }
    if (newChatType === 'direct' && selectedMemberIds.length !== 1) {
      setErrorText('Для direct чата выберите ровно одного участника')
      return
    }

    setCreatingChat(true)
    setErrorText('')
    try {
      const response = await chatApi.createChat({
        chat_type: newChatType,
        title: newChatTitle.trim() || undefined,
        member_ids: selectedMemberIds,
      })
      if (response.data.ok && response.data.data) {
        const created = response.data.data
        setChats((prev) => [created, ...prev])
        setSelectedChatId(created.id)
        setNewChatTitle('')
        setNewChatType('group')
        setSelectedMemberIds([])
      } else {
        setErrorText(response.data.error?.message || 'Не удалось создать чат')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось создать чат'))
    } finally {
      setCreatingChat(false)
    }
  }

  const handleSend = async () => {
    if (!selectedChatId || !draft.trim() || sending) return
    setSending(true)
    setErrorText('')
    try {
      const response = await chatApi.sendMessage(selectedChatId, { body: draft.trim() })
      if (response.data.ok && response.data.data) {
        const created = response.data.data
        setMessages((prev) => [...prev, created])
        setDraft('')
        await chatApi.updateReadCursor(selectedChatId, { last_read_seq_no: created.seq_no })
      } else {
        setErrorText(response.data.error?.message || 'Не удалось отправить сообщение')
      }
    } catch (e) {
      setErrorText(extractApiError(e, 'Не удалось отправить сообщение'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Чат</h1>
      </div>

      {errorText && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Создать чат</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Тип</label>
              <select
                value={newChatType}
                onChange={(e) => setNewChatType(e.target.value as 'direct' | 'group' | 'channel')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="group">Group</option>
                <option value="direct">Direct</option>
                <option value="channel">Channel</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Название</label>
              <Input
                value={newChatTitle}
                onChange={(e) => setNewChatTitle(e.target.value)}
                placeholder={newChatType === 'direct' ? 'Для direct не обязательно' : 'Название чата'}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">
                Участники {newChatType === 'direct' ? '(выберите 1)' : '(опционально)'}
              </label>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                {members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => {
                    const caption = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id
                    const checked = selectedMemberIds.includes(m.user_id)
                    return (
                      <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleMember(m.user_id)}
                        />
                        <span className="truncate">{caption}</span>
                      </label>
                    )
                  })}
              </div>
            </div>
            <Button onClick={handleCreateChat} disabled={creatingChat} className="w-full">
              {creatingChat ? 'Создание...' : 'Создать чат'}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Диалоги</CardTitle>
          </CardHeader>
          <CardContent className="grid min-h-[600px] grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
            <div className="rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">Чаты</div>
              <div className="max-h-[520px] overflow-y-auto p-2">
                {loadingChats ? (
                  <div className="p-2 text-sm text-muted-foreground">Загрузка...</div>
                ) : chats.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">Чатов пока нет</div>
                ) : (
                  chats.map((chat) => {
                    const isActive = chat.id === selectedChatId
                    const title = chat.title || (chat.chat_type === 'direct' ? 'Direct чат' : 'Без названия')
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => setSelectedChatId(chat.id)}
                        className={`mb-1 w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                          isActive
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-transparent hover:border-border hover:bg-muted/40'
                        }`}
                      >
                        <div className="truncate font-medium">{title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {chat.chat_type} · {chat.member_ids.length} участников
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            <div className="flex min-h-[520px] flex-col rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="text-sm font-semibold">
                  {selectedChat ? selectedChat.title || 'Без названия' : 'Выберите чат'}
                </div>
                {selectedChat && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedChat.member_ids
                      .map((id) => membersById.get(id) || id)
                      .join(', ')}
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {!selectedChat ? (
                  <div className="text-sm text-muted-foreground">Откройте чат слева</div>
                ) : loadingMessages ? (
                  <div className="text-sm text-muted-foreground">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Сообщений пока нет</div>
                ) : (
                  messages.map((message) => {
                    const own = message.sender_id === user?.id
                    return (
                      <div
                        key={message.id}
                        className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
                          own
                            ? 'ml-auto border-primary/40 bg-primary/10'
                            : 'border-border/70 bg-muted/30'
                        }`}
                      >
                        <div className="whitespace-pre-wrap break-words">{message.body}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          #{message.seq_no} · {new Date(message.created_at).toLocaleString('ru-RU')}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="border-t border-border/60 p-3">
                <div className="flex gap-2">
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={selectedChat ? 'Введите сообщение' : 'Сначала выберите чат'}
                    disabled={!selectedChat || sending}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                  />
                  <Button onClick={() => void handleSend()} disabled={!selectedChat || !draft.trim() || sending}>
                    {sending ? '...' : 'Отправить'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
