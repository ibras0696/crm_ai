import { useMemo, useState } from 'react'

import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ArrowDown } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { linkifyTextToNodes } from '@/lib/linkify'

import {
  formatDayDivider,
  getInitials,
  getMessageAttachments,
  scanSensitiveText,
  toDayKey,
} from '../../chatHelpers'
import { AttachmentPreview } from './AttachmentPreview'

export function MessageViewport(props: Record<string, unknown>) {
  const [revealedSensitiveMessages, setRevealedSensitiveMessages] = useState<Record<string, boolean>>({})
  type RenderRow = { index: number; key: string | number; start: number }

  const {
    chatRealtimeEnabled,
    chatTelemetryEnabled,
    messagesViewportRef,
    handleMessagesScroll,
    loadingOlderMessages,
    selectedChat,
    isMobileViewport,
    loadingMessages,
    messages,
    visibleMessages,
    hasMoreMessages,
    user,
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
    getUserAvatarUrl,
    onOpenUserProfile,
    membersById,
    setMediaPreview,
    newMessagesCount,
    isNearBottom,
    scrollToLatest,
  } = props as any

  const messageById = useMemo<Map<string, any>>(() => {
    return new Map((messages as any[]).map((message) => [message.id, message]))
  }, [messages])

  const rowVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => messagesViewportRef.current,
    estimateSize: () => 168,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index]?.id || index,
  })
  const renderRows: RenderRow[] = chatRealtimeEnabled
    ? rowVirtualizer.getVirtualItems().map((item) => ({ index: item.index, key: item.key, start: item.start }))
    : visibleMessages.map((message: any, index: number) => ({ index, key: message.id || index, start: 0 }))

  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev: Record<string, boolean>) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  const toggleSensitiveMessageRevealed = (messageId: string) => {
    setRevealedSensitiveMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  return (
    <div
      ref={messagesViewportRef}
      onScroll={handleMessagesScroll}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background/20 px-3 py-3 sm:px-5"
    >
      {loadingOlderMessages && (
        <div className="pb-1 text-center text-xs text-muted-foreground">Загрузка предыдущих сообщений...</div>
      )}
      {!selectedChat ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          {isMobileViewport ? 'Откройте список через кнопку "Чаты"' : 'Выберите диалог слева'}
        </div>
      ) : loadingMessages ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Загрузка сообщений...</div>
      ) : messages.length === 0 ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Сообщений пока нет</div>
      ) : visibleMessages.length === 0 ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">Поиск не дал результатов</div>
      ) : (
        <>
          {!hasMoreMessages && (
            <div className="pb-1 text-center text-xs text-muted-foreground">Начало переписки</div>
          )}

          <div
            className={chatRealtimeEnabled ? 'relative w-full' : 'space-y-2'}
            style={chatRealtimeEnabled ? { height: `${rowVirtualizer.getTotalSize()}px` } : undefined}
          >
            {renderRows.map((virtualRow) => {
              const index = virtualRow.index
              const message = visibleMessages[index]
              if (!message) return null

              const own = message.sender_id === user?.id
              const prev = visibleMessages[index - 1]
              const showDayDivider = !prev || toDayKey(prev.created_at) !== toDayKey(message.created_at)
              const showSender = !prev || prev.sender_id !== message.sender_id || showDayDivider
              const senderLabel = own ? 'Вы' : getMessageOwnerLabel(message)
              const ownStatus = getOwnMessageStatus(message)
              const attachments = getMessageAttachments(message)
              const hasAttachments = attachments.length > 0
              const bodyText = message.body.trim()
              const hasBody = bodyText.length > 0
              const syntheticAttachmentBody = hasAttachments && attachments.length === 1 && bodyText === attachments[0]?.original_name
              const shouldRenderBody = hasBody && !syntheticAttachmentBody
              const expanded = Boolean(expandedMessages[message.id])
              const expandable = shouldRenderBody && isExpandableMessage(message.body)
              const sensitiveScan = scanSensitiveText(message.body)
              const sensitiveRevealed = Boolean(revealedSensitiveMessages[message.id])
              const displayBody = sensitiveScan.hasSensitive && !sensitiveRevealed
                ? sensitiveScan.maskedText
                : message.body
              const metaReplyToId = message.meta?.reply_to_message_id
              const replyTarget = metaReplyToId ? messageById.get(metaReplyToId) || null : null
              const showMenu = menuOpenMessageId === message.id
              const replyPreviewText = replyTarget
                ? (() => {
                  const replyAttachments = getMessageAttachments(replyTarget)
                  const replyBody = replyTarget.body.trim()
                  const isSyntheticReplyBody =
                    replyAttachments.length === 1 && replyBody === replyAttachments[0]?.original_name
                  return (!isSyntheticReplyBody && replyBody) || (replyAttachments.length > 0 ? 'Вложение' : '')
                })()
                : ''
              const safeReplyPreviewText = scanSensitiveText(replyPreviewText).maskedText

              return (
                <div
                  key={virtualRow.key}
                  ref={chatRealtimeEnabled ? rowVirtualizer.measureElement : undefined}
                  data-index={virtualRow.index}
                  className={chatRealtimeEnabled ? 'absolute left-0 top-0 w-full' : 'w-full'}
                  style={chatRealtimeEnabled ? { transform: `translateY(${virtualRow.start}px)` } : undefined}
                >
                  {showDayDivider && (
                    <div className="my-2 text-center text-[11px] text-muted-foreground">
                      <span className="rounded-full border border-border/60 px-2 py-0.5">{formatDayDivider(message.created_at)}</span>
                    </div>
                  )}
                  <div className={`group flex w-full min-w-0 items-end gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                    {!own && (
                      <button
                        type="button"
                        onClick={() => onOpenUserProfile(message.sender_id)}
                        className="mb-1 h-7 w-7 shrink-0 rounded-full border border-border/70"
                        aria-label={`Открыть профиль ${senderLabel}`}
                      >
                        <Avatar className="h-full w-full">
                          <AvatarImage src={getUserAvatarUrl(message.sender_id) || undefined} alt={senderLabel} />
                          <AvatarFallback className="bg-muted/30 text-[10px] font-semibold text-muted-foreground">
                            {getInitials(senderLabel)}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    )}
                    <div className={`min-w-0 ${own ? 'max-w-[86%] sm:max-w-[62%] text-right' : 'max-w-[95%] sm:max-w-[68%] text-left'}`}>
                      {showSender && (
                        <div className={`mb-1 truncate px-1 text-[11px] ${own ? 'text-primary/80' : 'text-muted-foreground'}`}>{senderLabel}</div>
                      )}
                      <div
                        className={`relative max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          own
                            ? 'ml-auto rounded-br-md border border-transparent bg-[#EEFFDE] text-black dark:bg-[#2B5278] dark:text-white text-right'
                            : 'mr-auto rounded-bl-md border border-transparent bg-white text-black dark:bg-[#182533] dark:text-white text-left'
                        }`}
                      >
                        {replyTarget && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!messageById.has(replyTarget.id)) return
                              setExpandedMessages((prev: Record<string, boolean>) => ({ ...prev, [replyTarget.id]: true }))
                            }}
                            className={`mb-2 block w-full overflow-hidden rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground ${
                              own ? 'text-right' : 'text-left'
                            }`}
                          >
                            <div>Ответ на: {(membersById.get(replyTarget.sender_id) || replyTarget.sender_id)} ·</div>
                            <div className="mt-0.5 break-all">
                              {safeReplyPreviewText.slice(0, 80)}
                              {safeReplyPreviewText.length > 80 ? '…' : ''}
                            </div>
                          </button>
                        )}

                        {sensitiveScan.hasSensitive && (
                          <div
                            className={`mb-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                              own
                                ? 'border-white/25 bg-white/15 text-white'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            <div className={`flex items-center gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                Скрыты чувствительные данные: {sensitiveScan.labels.join(', ')}
                              </span>
                            </div>
                            <div className={`mt-1 flex flex-wrap gap-1.5 ${own ? 'justify-end' : 'justify-start'}`}>
                              <button
                                type="button"
                                className="rounded border border-current/25 px-2 py-0.5 hover:bg-current/10"
                                onClick={() => toggleSensitiveMessageRevealed(message.id)}
                              >
                                {sensitiveRevealed ? 'Скрыть' : 'Показать'}
                              </button>
                              <button
                                type="button"
                                className="rounded border border-current/25 px-2 py-0.5 hover:bg-current/10"
                                onClick={() => void handleCopyMessage(message.body)}
                              >
                                Скопировать
                              </button>
                            </div>
                          </div>
                        )}

                        {shouldRenderBody && (
                          <div
                            className={`min-w-0 whitespace-pre-wrap break-words ${expandable && !expanded ? 'max-h-28 overflow-hidden' : ''} ${
                              own ? 'text-right' : 'text-left'
                            }`}
                          >
                            {linkifyTextToNodes(displayBody)}
                          </div>
                        )}
                        {expandable && (
                          <button
                            type="button"
                            onClick={() => toggleMessageExpanded(message.id)}
                            className={`mt-1 text-[11px] text-primary hover:underline ${own ? 'ml-auto block text-right' : ''}`}
                          >
                            {expanded ? 'Свернуть' : 'Развернуть'}
                          </button>
                        )}

                        {hasAttachments && (
                          <div className={`mt-2 space-y-2 ${own ? 'text-right' : 'text-left'}`}>
                            {attachments.map((attachment: any) => (
                              <AttachmentPreview
                                key={attachment.file_id}
                                chatId={message.chat_id}
                                attachment={attachment}
                                onOpenMediaPreview={setMediaPreview}
                                isMessageVisible
                                forceEagerLoad={!chatRealtimeEnabled}
                                telemetryEnabled={chatTelemetryEnabled}
                              />
                            ))}
                          </div>
                        )}

                        <div
                          className={`mt-1.5 flex items-center gap-1 text-[11px] ${
                            own ? 'justify-end text-white/90' : 'justify-end text-[#5f7387] dark:text-[#a4b7c8]'
                          }`}
                        >
                          <span>{new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                          {own && ownStatus && <span>{ownStatus === 'Прочитано' ? '✓✓' : '✓'}</span>}
                        </div>

                        <button
                          type="button"
                          onClick={() => setMenuOpenMessageId((prev: string | null) => (prev === message.id ? null : message.id))}
                          className={`absolute top-1 hidden rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-background/70 group-hover:block ${
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
                    </div>
                    {own && (
                      <button
                        type="button"
                        onClick={() => onOpenUserProfile(message.sender_id)}
                        className="mb-1 h-7 w-7 shrink-0 rounded-full border border-border/70"
                        aria-label={`Открыть профиль ${senderLabel}`}
                      >
                        <Avatar className="h-full w-full">
                          <AvatarImage src={getUserAvatarUrl(message.sender_id) || undefined} alt={senderLabel} />
                          <AvatarFallback className="bg-emerald-100 text-[10px] font-semibold text-emerald-700 dark:bg-[#2f5f4f] dark:text-emerald-100">
                            {getInitials(senderLabel)}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
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
  )
}
