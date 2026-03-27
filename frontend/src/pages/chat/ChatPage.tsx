import { useEffect, useMemo, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { ArrowDown, Paperclip, Plus, Search, X } from 'lucide-react'
import { chatApi, type ChatInfo, type ChatMemberInfo, type ChatMessageInfo } from '@/lib/api'
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

function toDayKey(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDayDivider(value: string): string {
  const target = new Date(value)
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`
  const targetKey = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`
  if (targetKey === todayKey) return 'Сегодня'
  if (targetKey === yesterdayKey) return 'Вчера'
  return target.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
}

function getInitials(label: string): string {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase()
}

const MESSAGE_PAGE_SIZE = 50
const MESSAGE_MAX_CHARS = 500
const TYPING_TTL_MS = 3000

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

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const selectedChatIdRef = useRef<string | null>(null)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const typingStopTimerRef = useRef<number | null>(null)
  const lastTypingSentAtRef = useRef(0)

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])

  const membersById = useMemo(() => {
    return new Map(
      members.map((m) => [m.user_id, `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id]),
    )
  }, [members])

  const selectedChat = useMemo(() => {
    return chats.find((x) => x.id === selectedChatId) || null
  }, [chats, selectedChatId])

  const selectedChatMembers = useMemo(() => {
    if (!selectedChat) return []
    return selectedChat.member_ids.map((id) => {
      const label = membersById.get(id) || id
      return { userId: id, label, initials: getInitials(label), online: Boolean(presence[id]) }
    })
  }, [membersById, presence, selectedChat])

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
      .map(([userId]) => membersById.get(userId) || userId)
  }, [membersById, typingUsers])

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
    return membersById.get(message.sender_id) || message.sender_id
  }

  const getOwnMessageStatus = (message: ChatMessageInfo): string => {
    if (!user || message.sender_id !== user.id) return ''
    const readByOther = chatMembers.some((member) => member.user_id !== user.id && member.last_read_seq_no >= message.seq_no)
    if (readByOther) return 'Прочитано'
    const hasOnlinePeer = chatMembers.some((member) => member.user_id !== user.id && presence[member.user_id])
    if (ackedOwnMessages[message.id] || hasOnlinePeer) return 'Доставлено'
    return 'Отправлено'
  }

  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const isExpandableMessage = (body: string): boolean => {
    if (body.length > 280) return true
    if (/(https?:\/\/\S{80,})/i.test(body)) return true
    if (/^[\[{]/.test(body.trim()) && body.length > 120) return true
    return false
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

  const handleSend = async () => {
    const trimmedDraft = draft.trim()
    if (!selectedChatId || !trimmedDraft || sending) return
    if (trimmedDraft.length > MESSAGE_MAX_CHARS) {
      setErrorText(`Сообщение не должно превышать ${MESSAGE_MAX_CHARS} символов`)
      return
    }
    setSending(true)
    setErrorText('')
    try {
      const meta = replyToMessageId ? { reply_to_message_id: replyToMessageId } : undefined
      const response = await chatApi.sendMessage(selectedChatId, { body: trimmedDraft, meta })
      if (response.data.ok && response.data.data) {
        const created = response.data.data
        setMessages((prev) => (prev.some((x) => x.id === created.id) ? prev : [...prev, created]))
        if (created.sender_id === user?.id) {
          setAckedOwnMessages((prev) => ({ ...prev, [created.id]: false }))
        }
        setDraft('')
        setReplyToMessageId(null)
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Чат</h1>
        <Button
          type="button"
          size="icon"
          onClick={() => setCreateChatOpen(true)}
          aria-label="Создать чат"
          title="Создать чат"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {errorText && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      {createChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreateChatOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Создание чата"
            className="w-full max-w-xl border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Создать чат</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setCreateChatOpen(false)}
                aria-label="Закрыть окно создания чата"
              >
                <X className="h-4 w-4" />
              </Button>
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
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
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
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateChatOpen(false)} disabled={creatingChat}>
                  Отмена
                </Button>
                <Button type="button" onClick={handleCreateChat} disabled={creatingChat}>
                  {creatingChat ? 'Создание...' : 'Создать чат'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Диалоги</CardTitle>
        </CardHeader>
        <CardContent className="grid h-[70vh] min-h-[520px] max-h-[760px] grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">Чаты</div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
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

            <div className="flex min-h-0 flex-col rounded-md border border-border/60">
              <div className="border-b border-border/60 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {selectedChat ? selectedChat.title || 'Без названия' : 'Выберите чат'}
                    </div>
                    {selectedChat && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {selectedChatMembers.slice(0, 5).map((member) => (
                          <span key={member.userId} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                            <span className={`h-1.5 w-1.5 rounded-full ${member.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
                            <span className="max-w-[120px] truncate">{member.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {selectedChat && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Онлайн: {selectedChatMembers.filter((member) => member.online).length}/{selectedChatMembers.length}
                      </div>
                    )}
                    {typingLabels.length > 0 && (
                      <div className="mt-1 text-[11px] text-primary">
                        {typingLabels.join(', ')} печатает...
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="icon" variant="ghost" onClick={() => setSearchOpen((prev) => !prev)} aria-label="Поиск по сообщениям">
                      <Search className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setErrorText('Вложения чата подключим следующим шагом.')}
                      aria-label="Вложения"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
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
                className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
              >
                {loadingOlderMessages && (
                  <div className="pb-1 text-center text-xs text-muted-foreground">Загрузка предыдущих сообщений...</div>
                )}
                {!selectedChat ? (
                  <div className="text-sm text-muted-foreground">Откройте чат слева</div>
                ) : loadingMessages ? (
                  <div className="text-sm text-muted-foreground">Загрузка сообщений...</div>
                ) : messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Сообщений пока нет</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Поиск не дал результатов</div>
                ) : (
                  <>
                    {!hasMoreMessages && (
                      <div className="pb-1 text-center text-xs text-muted-foreground">Начало переписки</div>
                    )}
                    {visibleMessages.map((message, index) => {
                      const own = message.sender_id === user?.id
                      const prev = visibleMessages[index - 1]
                      const showDayDivider = !prev || toDayKey(prev.created_at) !== toDayKey(message.created_at)
                      const senderLabel = getMessageOwnerLabel(message)
                      const ownStatus = getOwnMessageStatus(message)
                      const expanded = Boolean(expandedMessages[message.id])
                      const expandable = isExpandableMessage(message.body)
                      const metaReplyToId = (message.meta as { reply_to_message_id?: string } | null)?.reply_to_message_id
                      const replyTarget = metaReplyToId ? messages.find((m) => m.id === metaReplyToId) || null : null
                      const showMenu = menuOpenMessageId === message.id

                      return (
                        <div key={message.id}>
                          {showDayDivider && (
                            <div className="my-2 text-center text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border/60 px-2 py-0.5">{formatDayDivider(message.created_at)}</span>
                            </div>
                          )}
                          <div className={`group flex w-full ${own ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-fit ${own ? 'max-w-[82%] sm:max-w-[62%] text-right' : 'max-w-[90%] sm:max-w-[68%] text-left'}`}>
                              {!own && (
                                <div className="mb-1 flex items-center gap-2 px-1">
                                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                                    {getInitials(senderLabel)}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">{senderLabel}</div>
                                </div>
                              )}
                              <div
                                className={`relative w-fit max-w-full rounded-xl border px-3 py-2 text-sm ${
                                  own
                                    ? 'ml-auto border-primary/35 bg-primary/[0.14] text-right'
                                    : 'mr-auto border-border/70 bg-muted/25 text-left'
                                }`}
                              >
                                {replyTarget && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const indexInFull = messages.findIndex((m) => m.id === replyTarget.id)
                                      if (indexInFull >= 0) {
                                        setExpandedMessages((prev) => ({ ...prev, [replyTarget.id]: true }))
                                      }
                                    }}
                                    className={`mb-2 block w-full overflow-hidden rounded border border-border/60 bg-background/40 px-2 py-1 text-[11px] text-muted-foreground ${
                                      own ? 'text-right' : 'text-left'
                                    }`}
                                  >
                                    <div>Ответ на: {(membersById.get(replyTarget.sender_id) || replyTarget.sender_id)} ·</div>
                                    <div className="mt-0.5 break-all">{replyTarget.body.slice(0, 80)}{replyTarget.body.length > 80 ? '…' : ''}</div>
                                  </button>
                                )}

                                <div
                                  className={`whitespace-pre-wrap break-all ${expandable && !expanded ? 'max-h-28 overflow-hidden' : ''} ${
                                    own ? 'text-right' : 'text-left'
                                  }`}
                                >
                                  {message.body}
                                </div>
                                {expandable && (
                                  <button
                                    type="button"
                                    onClick={() => toggleMessageExpanded(message.id)}
                                    className={`mt-1 text-[11px] text-primary hover:underline ${own ? 'ml-auto block text-right' : ''}`}
                                  >
                                    {expanded ? 'Свернуть' : 'Развернуть'}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setMenuOpenMessageId((prev) => (prev === message.id ? null : message.id))}
                                  className={`absolute top-1 hidden rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-background/40 group-hover:block ${
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
                              <div className={`mt-1 px-1 text-[10px] text-muted-foreground ${own ? 'text-right' : 'text-left'}`}>
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

              <div className="sticky bottom-0 border-t border-border/60 bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                {replyToMessage && (
                  <div className="mb-2 flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-xs">
                    <div className="truncate">
                      Ответ на: <span className="text-muted-foreground">{getMessageOwnerLabel(replyToMessage)}</span> · {replyToMessage.body.slice(0, 90)}
                    </div>
                    <button type="button" onClick={() => setReplyToMessageId(null)} className="ml-2 rounded px-1 hover:bg-muted/50">
                      ×
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      touchTypingActivity()
                    }}
                    maxLength={MESSAGE_MAX_CHARS}
                    rows={1}
                    placeholder={selectedChat ? 'Напишите сообщение (Enter — отправить, Shift+Enter — новая строка)' : 'Сначала выберите чат'}
                    disabled={!selectedChat || sending}
                    className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onBlur={() => stopTyping()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void handleSend()
                      }
                    }}
                  />
                  <Button
                    onClick={() => void handleSend()}
                    disabled={!selectedChat || !draft.trim() || draft.trim().length > MESSAGE_MAX_CHARS || sending}
                  >
                    {sending ? '...' : 'Отправить'}
                  </Button>
                </div>
                {selectedChat && (
                  <div className="mt-2 text-right text-xs text-muted-foreground">
                    {draft.trim().length}/{MESSAGE_MAX_CHARS}
                  </div>
                )}
              </div>
            </div>
        </CardContent>
      </Card>
    </div>
  )
}
