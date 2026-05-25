import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import { chatApi, type ChatInfo, type ChatMemberInfo, type ChatMessageInfo } from '@/lib/api'

import { MESSAGE_PAGE_SIZE, extractApiError } from '../chatHelpers'

interface UseChatMessagesParams {
  selectedChatId: string | null
  userId: string | undefined
  loadingMessages: boolean
  loadingOlderMessages: boolean
  hasMoreMessages: boolean
  newMessagesCount: number
  messages: ChatMessageInfo[]
  messagesViewportRef: MutableRefObject<HTMLDivElement | null>
  scrollMessagesToBottom: () => void
  setLoadingChats: Dispatch<SetStateAction<boolean>>
  setChats: Dispatch<SetStateAction<ChatInfo[]>>
  setSelectedChatId: Dispatch<SetStateAction<string | null>>
  setLoadingMessages: Dispatch<SetStateAction<boolean>>
  setLoadingOlderMessages: Dispatch<SetStateAction<boolean>>
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>
  setMessages: Dispatch<SetStateAction<ChatMessageInfo[]>>
  setChatMembers: Dispatch<SetStateAction<ChatMemberInfo[]>>
  setPresence: Dispatch<SetStateAction<Record<string, boolean>>>
  setTypingUsers: Dispatch<SetStateAction<Record<string, number>>>
  setReplyToMessageId: Dispatch<SetStateAction<string | null>>
  setMenuOpenMessageId: Dispatch<SetStateAction<string | null>>
  setAckedOwnMessages: Dispatch<SetStateAction<Record<string, boolean>>>
  setNewMessagesCount: Dispatch<SetStateAction<number>>
  setIsNearBottom: Dispatch<SetStateAction<boolean>>
  setErrorText: Dispatch<SetStateAction<string>>
}

export function useChatMessages({
  selectedChatId,
  userId,
  loadingMessages,
  loadingOlderMessages,
  hasMoreMessages,
  newMessagesCount,
  messages,
  messagesViewportRef,
  scrollMessagesToBottom,
  setLoadingChats,
  setChats,
  setSelectedChatId,
  setLoadingMessages,
  setLoadingOlderMessages,
  setHasMoreMessages,
  setMessages,
  setChatMembers,
  setPresence,
  setTypingUsers,
  setReplyToMessageId,
  setMenuOpenMessageId,
  setAckedOwnMessages,
  setNewMessagesCount,
  setIsNearBottom,
  setErrorText,
}: UseChatMessagesParams) {
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
      } catch (error) {
        setChats([])
        setSelectedChatId(null)
        setErrorText(extractApiError(error, 'Не удалось загрузить чаты'))
      } finally {
        setLoadingChats(false)
      }
    }

    void loadChats()
  }, [setChats, setErrorText, setLoadingChats, setSelectedChatId])

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
              .filter((message) => message.sender_id === userId)
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
      } catch (error) {
        setMessages([])
        setChatMembers([])
        setPresence({})
        setTypingUsers({})
        setAckedOwnMessages({})
        setHasMoreMessages(true)
        setErrorText(extractApiError(error, 'Не удалось загрузить сообщения'))
      } finally {
        setLoadingMessages(false)
      }
    }

    void loadMessages()
  }, [
    scrollMessagesToBottom,
    selectedChatId,
    setAckedOwnMessages,
    setChatMembers,
    setErrorText,
    setHasMoreMessages,
    setLoadingMessages,
    setLoadingOlderMessages,
    setMenuOpenMessageId,
    setMessages,
    setNewMessagesCount,
    setPresence,
    setReplyToMessageId,
    setTypingUsers,
    userId,
  ])

  const loadOlderMessages = useCallback(async () => {
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
    } catch (error) {
      setErrorText(extractApiError(error, 'Не удалось загрузить предыдущие сообщения'))
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [
    hasMoreMessages,
    loadingMessages,
    loadingOlderMessages,
    messages,
    messagesViewportRef,
    selectedChatId,
    setErrorText,
    setHasMoreMessages,
    setLoadingOlderMessages,
    setMessages,
  ])

  const handleMessagesScroll = useCallback(() => {
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
  }, [loadOlderMessages, messagesViewportRef, newMessagesCount, setIsNearBottom, setNewMessagesCount])

  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(scrollMessagesToBottom)
    setNewMessagesCount(0)
  }, [scrollMessagesToBottom, setNewMessagesCount])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      const response = await chatApi.deleteMessage(messageId)
      if (response.data.ok) {
        setMessages((prev) => prev.filter((message) => message.id !== messageId))
        setMenuOpenMessageId(null)
      } else {
        setErrorText(response.data.error?.message || 'Не удалось удалить сообщение')
      }
    } catch (error) {
      setErrorText(extractApiError(error, 'Не удалось удалить сообщение'))
    }
  }, [setErrorText, setMenuOpenMessageId, setMessages])

  const handleCopyMessage = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMenuOpenMessageId(null)
    } catch {
      setErrorText('Не удалось скопировать сообщение')
    }
  }, [setErrorText, setMenuOpenMessageId])

  return {
    loadOlderMessages,
    handleMessagesScroll,
    scrollToLatest,
    handleDeleteMessage,
    handleCopyMessage,
  }
}
