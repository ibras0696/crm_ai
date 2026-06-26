import {
  Camera,
  FilePlus,
  Image,
  Microphone,
  PaperclipHorizontal,
  PaperPlaneTilt,
  Plus,
  Square,
  SpinnerGap,
  VideoCamera,
  X,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'

import {
  MESSAGE_MAX_CHARS,
  formatDurationLabel,
  formatFileSize,
  getMessageAttachments,
  isVoiceAttachment,
  scanSensitiveText,
} from '../../chatHelpers'

export function ChatComposerSection(props: Record<string, unknown>) {
  const {
    replyToMessage,
    getMessageOwnerLabel,
    setReplyToMessageId,
    composerAttachments,
    handleRemoveComposerAttachment,
    isRecordingVoice,
    voiceRecordingElapsedMs,
    mediaAttachmentInputRef,
    handleMediaInputChange,
    cameraPhotoAttachmentInputRef,
    handleCameraPhotoInputChange,
    cameraVideoAttachmentInputRef,
    handleCameraVideoInputChange,
    fileAttachmentInputRef,
    handleFileInputChange,
    attachMenuRef,
    isAttachMenuOpen,
    setIsAttachMenuOpen,
    selectedChatId,
    sending,
    hasUploadingAttachments,
    openMediaPicker,
    openCameraPhotoPicker,
    openCameraVideoPicker,
    openFilePicker,
    composerRef,
    draft,
    setDraft,
    touchTypingActivity,
    stopTyping,
    handleComposerPaste,
    readyComposerAttachments,
    selectedChat,
    canSendMessage,
    handleSend,
    startVoiceRecording,
    stopVoiceRecording,
  } = props as any

  return (
    <div className="sticky bottom-0 border-t border-border/60 bg-background/92 px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3.25rem)] backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-4 md:pb-3">
      {replyToMessage && (
        <div className="mb-2 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
          <div className="truncate">
            Ответ на: <span className="text-muted-foreground">{getMessageOwnerLabel(replyToMessage)}</span> ·{' '}
            {scanSensitiveText(replyToMessage.body.trim()).maskedText || (getMessageAttachments(replyToMessage).length > 0 ? 'Вложение' : '')}
          </div>
          <button type="button" onClick={() => setReplyToMessageId(null)} className="ml-2 rounded px-1 hover:bg-muted/50">
            ×
          </button>
        </div>
      )}

      {composerAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {composerAttachments.map((attachment: any) => {
            const isUploading = attachment.status === 'uploading'
            const isReady = attachment.status === 'ready'
            const isError = attachment.status === 'error'
            const isVoice = isVoiceAttachment(attachment.contentType)
            return (
              <div
                key={attachment.clientId}
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                  isReady
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                    : isError
                      ? 'border-destructive/30 bg-destructive/10 text-destructive'
                      : 'border-primary/30 bg-primary/10 text-primary'
                }`}
              >
                {isUploading ? <SpinnerGap size={14} className="animate-spin" /> : <PaperclipHorizontal size={14} />}
                <div className="min-w-0">
                  <div className="max-w-[220px] truncate">
                    {isVoice ? 'Голосовое сообщение' : attachment.originalName}
                  </div>
                  <div className="text-[10px] opacity-80">
                    {isUploading
                      ? 'Загрузка...'
                      : isReady
                        ? isVoice
                          ? `${formatDurationLabel(attachment.durationMs || 0)} · ${formatFileSize(attachment.size)}`
                          : formatFileSize(attachment.size)
                        : attachment.error || 'Ошибка'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveComposerAttachment(attachment.clientId)}
                  className="ml-1 rounded-full p-0.5 hover:bg-black/10"
                  aria-label={`Удалить вложение ${attachment.originalName}`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      {isRecordingVoice && (
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Идет запись: {formatDurationLabel(voiceRecordingElapsedMs)} / 01:00
        </div>
      )}

      <input
        ref={mediaAttachmentInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => void handleMediaInputChange(event)}
      />
      <input
        ref={cameraPhotoAttachmentInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleCameraPhotoInputChange(event)}
      />
      <input
        ref={cameraVideoAttachmentInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleCameraVideoInputChange(event)}
      />
      <input
        ref={fileAttachmentInputRef}
        type="file"
        className="hidden"
        onChange={(event) => void handleFileInputChange(event)}
      />

      <div className="relative flex items-end gap-2 rounded-3xl border border-border/70 bg-background/95 p-2 shadow-sm" ref={attachMenuRef}>
        <div className="relative shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-full border border-border/70 bg-background/80"
            onClick={() => setIsAttachMenuOpen((prev: boolean) => !prev)}
            disabled={!selectedChatId || sending || isRecordingVoice || composerAttachments.length >= 1 || hasUploadingAttachments}
            aria-label="Открыть меню вложений"
            title="Вложения"
          >
            <Plus size={20} />
          </Button>
          {isAttachMenuOpen && (
            <div className="absolute bottom-12 left-0 z-40 w-[min(280px,calc(100vw-4rem))] rounded-xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                  onClick={openMediaPicker}
                >
                  <Image size={16} />
                  Фото/Видео
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                  onClick={openCameraPhotoPicker}
                >
                  <Camera size={16} />
                  Камера
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                  onClick={openCameraVideoPicker}
                >
                  <VideoCamera size={16} />
                  Видео
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-left text-xs hover:bg-muted/30"
                  onClick={openFilePicker}
                >
                  <FilePlus size={16} />
                  Файл
                </button>
              </div>
            </div>
          )}
        </div>
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            touchTypingActivity()
          }}
          maxLength={MESSAGE_MAX_CHARS}
          rows={1}
          placeholder={selectedChat ? 'Напишите сообщение...' : 'Выберите чат'}
          disabled={!selectedChat || sending || isRecordingVoice}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-2xl border border-transparent bg-transparent px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onBlur={() => stopTyping()}
          onPaste={handleComposerPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (draft.trim().length > 0 || readyComposerAttachments.length > 0)) {
              e.preventDefault()
              void handleSend()
            }
          }}
        />
        {isRecordingVoice ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="h-10 w-10 rounded-full shadow-sm"
            onClick={() => stopVoiceRecording(true)}
            aria-label="Остановить запись голосового"
            title="Стоп запись"
          >
            <Square size={16} />
          </Button>
        ) : canSendMessage ? (
          <Button
            type="button"
            size="icon"
            className="h-10 w-10 rounded-full bg-primary shadow-sm hover:bg-primary/90"
            onClick={() => void handleSend()}
            disabled={sending || draft.trim().length > MESSAGE_MAX_CHARS || hasUploadingAttachments}
            aria-label="Отправить сообщение"
            title="Отправить"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-full border border-border/70"
            onClick={() => void startVoiceRecording()}
            disabled={!selectedChatId || sending || composerAttachments.length >= 1 || hasUploadingAttachments}
            aria-label="Записать голосовое сообщение"
            title="Голосовое"
          >
            <Microphone size={16} />
          </Button>
        )}
      </div>
    </div>
  )
}
