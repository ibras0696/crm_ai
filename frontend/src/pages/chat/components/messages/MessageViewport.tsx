import { useMemo, useState } from 'react'

import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { linkifyTextToNodes } from '@/lib/linkify'

import {
  formatDayDivider,
  getInitials,
  getMessageAttachments,
  scanSensitiveText,
  toDayKey,
} from '../../chatHelpers'
import { AttachmentPreview } from './AttachmentPreview'

// ---------------------------------------------------------------------------
// Context menu (Telegram-style floating panel)
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  own: boolean
  onCopy: () => void
  onReply: () => void
  onDelete?: () => void
  onClose: () => void
}

function ContextMenu({ own, onCopy, onReply, onDelete, onClose }: ContextMenuProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: -4 }}
        transition={{ duration: 0.13, ease: [0.32, 0.72, 0, 1] }}
        className={`absolute top-7 z-[200] min-w-[160px] overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl ${
          own ? 'right-0' : 'left-0'
        }`}
      >
        <button
          type="button"
          onClick={() => { onReply(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
        >
          <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a4 4 0 014 4v2m0 0-4-4m4 4-4 4" />
          </svg>
          Ответить
        </button>
        <button
          type="button"
          onClick={() => { onCopy(); onClose() }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
        >
          <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          Копировать
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={() => { onDelete(); onClose() }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors border-t border-border/60"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Удалить
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// Bubble corner classes (Telegram grouping logic)
// ---------------------------------------------------------------------------

function getBubbleRounding(own: boolean, isFirst: boolean, isLast: boolean) {
  if (own) {
    if (isFirst && isLast) return 'rounded-2xl rounded-tr-[5px]'
    if (isFirst)            return 'rounded-2xl rounded-tr-[5px] rounded-br-[5px]'
    if (isLast)             return 'rounded-2xl rounded-br-[5px]'
    return                         'rounded-2xl rounded-r-[5px]'
  } else {
    if (isFirst && isLast) return 'rounded-2xl rounded-tl-[5px]'
    if (isFirst)            return 'rounded-2xl rounded-tl-[5px] rounded-bl-[5px]'
    if (isLast)             return 'rounded-2xl rounded-bl-[5px]'
    return                         'rounded-2xl rounded-l-[5px]'
  }
}

// ---------------------------------------------------------------------------
// Main viewport
// ---------------------------------------------------------------------------

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
    estimateSize: () => 68,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index]?.id || index,
  })

  const renderRows: RenderRow[] = chatRealtimeEnabled
    ? rowVirtualizer.getVirtualItems().map((item) => ({ index: item.index, key: item.key, start: item.start }))
    : visibleMessages.map((message: any, index: number) => ({ index, key: message.id || index, start: 0 }))

  const toggleMessageExpanded = (messageId: string) => {
    setExpandedMessages((prev: Record<string, boolean>) => ({ ...prev, [messageId]: !prev[messageId] }))
  }
  const toggleSensitiveRevealed = (messageId: string) => {
    setRevealedSensitiveMessages((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  return (
    <div
      ref={messagesViewportRef}
      onScroll={handleMessagesScroll}
      onClick={() => setMenuOpenMessageId(null)}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 py-3 sm:px-3"
    >
      {loadingOlderMessages && (
        <div className="pb-1 text-center text-xs text-muted-foreground">Загрузка...</div>
      )}

      {!selectedChat ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          {isMobileViewport ? 'Откройте список через кнопку «Чаты»' : 'Выберите диалог слева'}
        </div>
      ) : loadingMessages ? (
        <div className="flex h-full min-h-[220px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-xs text-muted-foreground">Загрузка сообщений...</span>
          </div>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          Сообщений пока нет
        </div>
      ) : visibleMessages.length === 0 ? (
        <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          Поиск не дал результатов
        </div>
      ) : (
        <>
          {!hasMoreMessages && (
            <div className="mb-3 text-center">
              <span className="rounded-full bg-black/10 px-3 py-1 text-[11px] text-muted-foreground dark:bg-white/10">
                Начало переписки
              </span>
            </div>
          )}

          <div
            className={chatRealtimeEnabled ? 'relative w-full' : 'w-full'}
            style={chatRealtimeEnabled ? { height: `${rowVirtualizer.getTotalSize()}px` } : undefined}
          >
            {renderRows.map((virtualRow) => {
              const index = virtualRow.index
              const message = visibleMessages[index]
              if (!message) return null

              const own = message.sender_id === user?.id
              const prev = visibleMessages[index - 1]
              const next = visibleMessages[index + 1]

              const showDayDivider = !prev || toDayKey(prev.created_at) !== toDayKey(message.created_at)
              const isFirstInGroup = !prev || prev.sender_id !== message.sender_id || showDayDivider
              const isLastInGroup = !next || next.sender_id !== message.sender_id
                || toDayKey(next.created_at) !== toDayKey(message.created_at)

              const senderLabel = own ? 'Вы' : getMessageOwnerLabel(message)
              const ownStatus = getOwnMessageStatus(message)
              const attachments = getMessageAttachments(message)
              const hasAttachments = attachments.length > 0
              const voiceHintMs = (message.meta as Record<string, unknown> | null | undefined)
                ?.voice_note as { duration_ms?: number } | undefined
              const bodyText = message.body.trim()
              const hasBody = bodyText.length > 0
              const syntheticAttachmentBody =
                hasAttachments && attachments.length === 1 && bodyText === attachments[0]?.original_name
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
                    const replyAtts = getMessageAttachments(replyTarget)
                    const replyBody = replyTarget.body.trim()
                    const isSynth = replyAtts.length === 1 && replyBody === replyAtts[0]?.original_name
                    return (!isSynth && replyBody) || (replyAtts.length > 0 ? 'Вложение' : '')
                  })()
                : ''
              const safeReplyPreview = scanSensitiveText(replyPreviewText).maskedText

              const bubbleRounding = getBubbleRounding(own, isFirstInGroup, isLastInGroup)
              // Bottom margin: tight within group, spaced at group boundary
              const rowMb = isLastInGroup ? 'mb-2' : 'mb-0.5'

              return (
                <div
                  key={virtualRow.key}
                  ref={chatRealtimeEnabled ? rowVirtualizer.measureElement : undefined}
                  data-index={virtualRow.index}
                  className={chatRealtimeEnabled ? `absolute left-0 top-0 w-full ${rowMb}` : `w-full ${rowMb}`}
                  style={chatRealtimeEnabled
                    ? { transform: `translateY(${virtualRow.start}px)`, zIndex: showMenu ? 50 : undefined }
                    : showMenu ? { zIndex: 50, position: 'relative' } : undefined}
                >
                  {showDayDivider && (
                    <div className="my-3 flex items-center justify-center">
                      <span className="rounded-full bg-black/10 px-3 py-0.5 text-[11px] text-muted-foreground dark:bg-white/10">
                        {formatDayDivider(message.created_at)}
                      </span>
                    </div>
                  )}

                  <div className={`group flex w-full min-w-0 items-end gap-1 ${own ? 'justify-end' : 'justify-start'}`}>

                    {/* Left avatar / spacer */}
                    {!own && (
                      isLastInGroup ? (
                        <button
                          type="button"
                          onClick={() => onOpenUserProfile(message.sender_id)}
                          className="mb-0.5 h-7 w-7 shrink-0 rounded-full overflow-hidden"
                          aria-label={`Профиль ${senderLabel}`}
                        >
                          <Avatar className="h-full w-full">
                            <AvatarImage src={getUserAvatarUrl(message.sender_id) || undefined} alt={senderLabel} />
                            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
                              {getInitials(senderLabel)}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      ) : (
                        <div className="w-7 shrink-0" />
                      )
                    )}

                    {/* Message column */}
                    <div className={`min-w-0 ${own ? 'max-w-[82%] sm:max-w-[60%]' : 'max-w-[82%] sm:max-w-[65%]'}`}>

                      {/* Sender name for others (only first in group) */}
                      {!own && isFirstInGroup && (
                        <div className="mb-0.5 truncate px-1 text-[11px] font-medium text-primary/80">
                          {senderLabel}
                        </div>
                      )}

                      {/* Bubble */}
                      <div
                        className={`relative max-w-full px-3 py-2 text-sm shadow-sm ${bubbleRounding} ${
                          own
                            ? 'bg-[#EEFFDE] text-black dark:bg-[#2B5278] dark:text-white'
                            : 'bg-white text-black dark:bg-[#182533] dark:text-white'
                        }`}
                      >
                        {/* Reply preview */}
                        {replyTarget && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!messageById.has(replyTarget.id)) return
                              setExpandedMessages((prev: Record<string, boolean>) => ({
                                ...prev,
                                [replyTarget.id]: true,
                              }))
                            }}
                            className={`mb-2 block w-full overflow-hidden rounded-lg border-l-[3px] pl-2 pr-1 py-1 text-[11px] ${
                              own
                                ? 'border-white/50 bg-white/15 text-white/80'
                                : 'border-primary bg-primary/8 text-muted-foreground'
                            } text-left`}
                          >
                            <div className="font-semibold text-[10px] mb-0.5 opacity-80">
                              {membersById.get(replyTarget.sender_id) || replyTarget.sender_id}
                            </div>
                            <div className="truncate">
                              {safeReplyPreview.slice(0, 80)}{safeReplyPreview.length > 80 ? '…' : ''}
                            </div>
                          </button>
                        )}

                        {/* Sensitive data warning */}
                        {sensitiveScan.hasSensitive && (
                          <div
                            className={`mb-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                              own
                                ? 'border-white/25 bg-white/15 text-white'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Warning className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">Скрыты чувствительные данные: {sensitiveScan.labels.join(', ')}</span>
                            </div>
                            <div className="mt-1 flex gap-1.5">
                              <button
                                type="button"
                                className="rounded border border-current/25 px-2 py-0.5 hover:bg-current/10"
                                onClick={() => toggleSensitiveRevealed(message.id)}
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

                        {/* Body */}
                        {shouldRenderBody && (
                          <div
                            className={`min-w-0 whitespace-pre-wrap break-words leading-[1.45] ${
                              expandable && !expanded ? 'max-h-28 overflow-hidden' : ''
                            }`}
                          >
                            {linkifyTextToNodes(displayBody)}
                          </div>
                        )}
                        {expandable && (
                          <button
                            type="button"
                            onClick={() => toggleMessageExpanded(message.id)}
                            className="mt-1 text-[11px] text-primary hover:underline"
                          >
                            {expanded ? 'Свернуть' : 'Развернуть'}
                          </button>
                        )}

                        {/* Attachments */}
                        {hasAttachments && (
                          <div className="mt-2 space-y-2">
                            {attachments.map((attachment: any) => (
                              <AttachmentPreview
                                key={attachment.file_id}
                                chatId={message.chat_id}
                                attachment={attachment}
                                onOpenMediaPreview={setMediaPreview}
                                isMessageVisible
                                telemetryEnabled={chatTelemetryEnabled}
                                hintDurationMs={voiceHintMs?.duration_ms}
                                isOutgoing={own}
                              />
                            ))}
                          </div>
                        )}

                        {/* Timestamp + status — TG inline style */}
                        <div
                          className={`mt-0.5 flex items-center gap-1 text-[11px] ${
                            own
                              ? 'justify-end text-white/70 dark:text-white/50'
                              : 'justify-end text-black/40 dark:text-white/35'
                          }`}
                        >
                          <span>
                            {new Date(message.created_at).toLocaleTimeString('ru-RU', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {own && ownStatus && (
                            <span className={ownStatus === 'Прочитано' ? 'text-primary dark:text-[#64b5f6]' : ''}>
                              {ownStatus === 'Прочитано' ? '✓✓' : '✓'}
                            </span>
                          )}
                        </div>

                        {/* Context menu trigger — shows on hover, positioned at top */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMenuOpenMessageId((prev: string | null) => (prev === message.id ? null : message.id))
                          }}
                          className={`absolute -top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-card/90 shadow-sm border border-border/60 text-muted-foreground hover:text-foreground transition-all group-hover:flex ${
                            own ? 'right-0' : 'left-0'
                          }`}
                          aria-label="Действия"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                            <circle cx="8" cy="2" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="14" r="1.5" />
                          </svg>
                        </button>

                        {/* Context menu */}
                        {showMenu && (
                          <ContextMenu
                            own={own}
                            onCopy={() => void handleCopyMessage(message.body)}
                            onReply={() => {
                              setReplyToMessageId(message.id)
                              composerRef.current?.focus()
                            }}
                            onDelete={own ? () => void handleDeleteMessage(message.id) : undefined}
                            onClose={() => setMenuOpenMessageId(null)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* New messages badge */}
      {newMessagesCount > 0 && !isNearBottom && (
        <div className="sticky bottom-2 mt-2 flex justify-center">
          <button
            type="button"
            onClick={scrollToLatest}
            className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg hover:opacity-90 transition-opacity"
          >
            <ArrowDown className="h-3.5 w-3.5" weight="bold" />
            {newMessagesCount} новых
          </button>
        </div>
      )}
    </div>
  )
}
