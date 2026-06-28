import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import type { ChatInfo, ChatMemberInfo, ChatMessageInfo } from '@/lib/api'
import { chatApi } from '@/lib/api'

import { TYPING_TTL_MS } from '../chatHelpers'
import { saveCachedChatMembers, saveCachedChatMessages, saveCachedChats } from '../chatCache'

interface UseChatConnectionParams {
  selectedChatId: string | null
  cacheScope: string | null
  selectedChatIdRef: MutableRefObject<string | null>
  getLastKnownSeqNo: () => number
  userId: string | undefined
  telemetryEnabled: boolean
  realtimeEnabled: boolean
  messagesViewportRef: MutableRefObject<HTMLDivElement | null>
  scrollMessagesToBottom: () => void
  setPresence: Dispatch<SetStateAction<Record<string, boolean>>>
  setTypingUsers: Dispatch<SetStateAction<Record<string, number>>>
  setChats: Dispatch<SetStateAction<ChatInfo[]>>
  setMessages: Dispatch<SetStateAction<ChatMessageInfo[]>>
  setChatMembers: Dispatch<SetStateAction<ChatMemberInfo[]>>
  setAckedOwnMessages: Dispatch<SetStateAction<Record<string, boolean>>>
  setNewMessagesCount: Dispatch<SetStateAction<number>>
}

export function useChatConnection({
  selectedChatId,
  cacheScope,
  selectedChatIdRef,
  getLastKnownSeqNo,
  userId,
  telemetryEnabled,
  realtimeEnabled,
  messagesViewportRef,
  scrollMessagesToBottom,
  setPresence,
  setTypingUsers,
  setChats,
  setMessages,
  setChatMembers,
  setAckedOwnMessages,
  setNewMessagesCount,
}: UseChatConnectionParams) {
  const typingStopTimerRef = useRef<number | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const hasConnectedOnceRef = useRef(false)
  const lastDisconnectedAtRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
  }, [selectedChatId, selectedChatIdRef])

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
  }, [selectedChatId, setPresence])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setTypingUsers((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, expiresAt]) => expiresAt > now))
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 500)

    return () => window.clearInterval(timer)
  }, [setTypingUsers])

  const sendTypingEvent = useCallback((isTyping: boolean) => {
    const chatId = selectedChatIdRef.current
    if (!chatId) return
    void chatApi.sendTyping(chatId, isTyping)
  }, [selectedChatIdRef])

  const backfillSelectedChat = useCallback(async () => {
    if (!realtimeEnabled) return
    const chatId = selectedChatIdRef.current
    if (!chatId) return
    const afterSeqNo = Math.max(0, Number(getLastKnownSeqNo() || 0))
    try {
      const response = await chatApi.listMessages(chatId, {
        limit: 500,
        after_seq_no: afterSeqNo,
      })
      if (!response.data.ok || !response.data.data || response.data.data.length === 0) return
      const delta = response.data.data
      const viewport = messagesViewportRef.current
      const shouldStickToBottom = viewport
        ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
        : false
      let appendedCount = 0
      setMessages((prev) => {
        const existingIds = new Set(prev.map((message) => message.id))
        const unique = delta.filter((message) => !existingIds.has(message.id))
        appendedCount = unique.length
        if (unique.length === 0) return prev
        const next = [...prev, ...unique]
        if (cacheScope) void saveCachedChatMessages(cacheScope, chatId, next)
        return next
      })
      if (appendedCount > 0) {
        if (shouldStickToBottom) {
          requestAnimationFrame(scrollMessagesToBottom)
          setNewMessagesCount(0)
        } else {
          setNewMessagesCount((prev) => prev + appendedCount)
        }
      }
      if (userId) {
        const ownAck = Object.fromEntries(
          delta
            .filter((message) => message.sender_id === userId)
            .map((message) => [message.id, true]),
        )
        if (Object.keys(ownAck).length > 0) {
          setAckedOwnMessages((prev) => ({ ...prev, ...ownAck }))
        }
      }
      const latestDelta = delta[delta.length - 1]
      if (!latestDelta) return
      setChats((prev) => {
        const index = prev.findIndex((chat) => chat.id === chatId)
        if (index === -1) return prev
        const next = [...prev]
        const chat = next[index]
        if (!chat) return prev
        next[index] = {
          ...chat,
          updated_at: latestDelta.created_at,
        }
        if (cacheScope) void saveCachedChats(cacheScope, next)
        return next
      })
    } catch {
      // best-effort on reconnect; next reconnect will retry
    }
  }, [
    cacheScope,
    getLastKnownSeqNo,
    messagesViewportRef,
    realtimeEnabled,
    scrollMessagesToBottom,
    selectedChatIdRef,
    setAckedOwnMessages,
    setChats,
    setMessages,
    setNewMessagesCount,
    userId,
  ])

  const sendTelemetry = useCallback(
    (event: 'ws_reconnect' | 'message_lag', value?: number, meta?: Record<string, unknown>) => {
      if (!telemetryEnabled) return
      void chatApi.sendTelemetry({
        event,
        ...(typeof value === 'number' ? { value } : {}),
        ...(meta ? { meta } : {}),
      })
    },
    [telemetryEnabled],
  )

  const stopTyping = useCallback(() => {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
    }
    sendTypingEvent(false)
  }, [sendTypingEvent])

  const touchTypingActivity = useCallback(() => {
    if (!selectedChatIdRef.current) return
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
  }, [selectedChatIdRef, sendTypingEvent])

  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current)
      }
      const chatId = selectedChatIdRef.current
      if (chatId) {
        void chatApi.sendTyping(chatId, false)
      }
    }
  }, [selectedChatIdRef])

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
        const disconnectedAt = lastDisconnectedAtRef.current
        if (hasConnectedOnceRef.current) {
          reconnectAttemptRef.current += 1
          const reconnectLagSec = disconnectedAt ? Math.max(0, (Date.now() - disconnectedAt) / 1000) : 0
          sendTelemetry('ws_reconnect', reconnectLagSec, {
            attempt: reconnectAttemptRef.current,
          })
        } else {
          hasConnectedOnceRef.current = true
        }
        lastDisconnectedAtRef.current = null
        void backfillSelectedChat()
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
            member?: ChatMemberInfo
            user_id?: string
            is_typing?: boolean
            last_read_seq_no?: number
          }

          if (payload.type === 'chat.message.created' && payload.chat_id && payload.message) {
            const incomingMessage = payload.message
            const createdAt = Date.parse(String(incomingMessage.created_at || ''))
            if (Number.isFinite(createdAt)) {
              const lagSeconds = Math.max(0, (Date.now() - createdAt) / 1000)
              sendTelemetry('message_lag', lagSeconds, {
                chat_id: payload.chat_id,
              })
            }

            setChats((prev) => {
              const index = prev.findIndex((chat) => chat.id === payload.chat_id)
              if (index === -1) return prev
              const next = [...prev]
              const chat = next[index]
              if (!chat) return prev
              const updatedChat: ChatInfo = { ...chat, updated_at: incomingMessage.created_at }
              next.splice(index, 1)
              next.unshift(updatedChat)
              if (cacheScope) void saveCachedChats(cacheScope, next)
              return next
            })

            if (selectedChatIdRef.current !== payload.chat_id) return

            const viewport = messagesViewportRef.current
            const shouldStickToBottom = viewport
              ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
              : false

            setMessages((prev) => {
              if (prev.some((x) => x.id === incomingMessage.id)) return prev
              const next = [...prev, incomingMessage]
              if (cacheScope) void saveCachedChatMessages(cacheScope, payload.chat_id!, next)
              return next
            })

            if (incomingMessage.sender_id === userId) {
              setAckedOwnMessages((prev) => ({ ...prev, [incomingMessage.id]: true }))
            }

            if (shouldStickToBottom) {
              requestAnimationFrame(scrollMessagesToBottom)
            } else {
              setNewMessagesCount((prev) => prev + 1)
            }
            return
          }

          if (payload.type === 'chat.member.joined' && payload.chat_id && payload.member) {
            const joinedMember = payload.member
            setChats((prev) => {
              const index = prev.findIndex((chat) => chat.id === payload.chat_id)
              if (index === -1) return prev
              const next = [...prev]
              const chat = next[index]
              if (!chat) return prev
              next[index] = {
                ...chat,
                member_ids: chat.member_ids.includes(joinedMember.user_id)
                  ? chat.member_ids
                  : [...chat.member_ids, joinedMember.user_id],
              }
              if (cacheScope) void saveCachedChats(cacheScope, next)
              return next
            })

            if (payload.chat_id === selectedChatIdRef.current) {
              setChatMembers((prev) => (
                prev.some((member) => member.user_id === joinedMember.user_id)
                  ? prev
                  : (() => {
                      const next = [...prev, joinedMember]
                      if (cacheScope) void saveCachedChatMembers(cacheScope, payload.chat_id!, next)
                      return next
                    })()
              ))
            }
            return
          }

          if (payload.type === 'chat.typing.updated' && payload.chat_id === selectedChatIdRef.current && payload.user_id) {
            if (payload.user_id === userId) return
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
            setChatMembers((prev) => {
              const next = prev.map((member) =>
                member.user_id === payload.user_id
                  ? { ...member, last_read_seq_no: Math.max(member.last_read_seq_no, payload.last_read_seq_no!) }
                  : member,
              )
              if (cacheScope) void saveCachedChatMembers(cacheScope, payload.chat_id!, next)
              return next
            })
          }
        } catch {
          // ignore unrelated ws frames
        }
      }

      socket.onerror = () => {
        socket?.close()
      }

      socket.onclose = () => {
        clearTimers()
        lastDisconnectedAtRef.current = Date.now()
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
  }, [
    messagesViewportRef,
    cacheScope,
    scrollMessagesToBottom,
    selectedChatIdRef,
    setAckedOwnMessages,
    setChatMembers,
    setChats,
    setMessages,
    setNewMessagesCount,
    setTypingUsers,
    userId,
    backfillSelectedChat,
    sendTelemetry,
  ])

  return {
    touchTypingActivity,
    stopTyping,
  }
}
