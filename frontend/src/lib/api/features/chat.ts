import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface ChatInfo {
  id: string
  org_id: string
  created_by: string
  chat_type: 'direct' | 'group' | 'channel'
  title: string | null
  member_ids: string[]
  created_at: string
  updated_at: string
}

export interface ChatMessageInfo {
  id: string
  chat_id: string
  sender_id: string
  seq_no: number
  body: string
  body_type: string
  meta: ChatMessageMeta | null
  created_at: string
}

export interface ChatAttachmentInfo {
  file_id: string
  original_name: string
  content_type: string
  size: number
  status: string
}

export interface ChatMessageMeta {
  reply_to_message_id?: string
  attachment_ids?: string[]
  attachments?: ChatAttachmentInfo[]
  voice_note?: {
    file_id?: string
    duration_ms: number
  }
  [key: string]: unknown
}

export interface InitChatAttachmentUploadPayload {
  filename: string
  size_bytes: number
  content_type: string
}

export interface InitChatAttachmentUploadResult {
  file_id: string
  upload_url: string
  upload_headers: Record<string, string>
  expires_in: number
}

export interface FinishChatAttachmentUploadPayload {
  file_id: string
  size_bytes: number
}

export interface ChatAttachmentResult {
  file_id: string
  filename: string
  original_name: string
  content_type: string
  size: number
  status: string
}

export interface ChatMemberInfo {
  id: string
  chat_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'readonly'
  last_read_seq_no: number
  created_at: string
}

export interface ChatClientConfigInfo {
  realtime_enabled: boolean
  realtime_rollout_percent: number
  telemetry_enabled: boolean
}

export interface ChatTelemetryPayload {
  event: 'ws_reconnect' | 'message_lag' | 'attachment_fetch'
  value?: number
  meta?: Record<string, unknown>
}

export const chatApi = {
  listChats: (limit = 50, offset = 0) =>
    api.get<ApiResponse<ChatInfo[]>>(`/chat/chats?limit=${limit}&offset=${offset}`),
  getChat: (chatId: string) => api.get<ApiResponse<ChatInfo>>(`/chat/chats/${chatId}`),
  createChat: (data: { chat_type: 'direct' | 'group' | 'channel'; title?: string; member_ids?: string[] }) =>
    api.post<ApiResponse<ChatInfo>>('/chat/chats', data),
  updateChat: (chatId: string, data: { title: string }) =>
    api.patch<ApiResponse<ChatInfo>>(`/chat/chats/${chatId}`, data),
  deleteChat: (chatId: string) => api.delete<ApiResponse<null>>(`/chat/chats/${chatId}`),
  addMember: (chatId: string, data: { user_id: string; role?: 'owner' | 'admin' | 'member' | 'readonly' }) =>
    api.post<ApiResponse<ChatMemberInfo>>(`/chat/chats/${chatId}/members`, data),
  listMembers: (chatId: string) =>
    api.get<ApiResponse<ChatMemberInfo[]>>(`/chat/chats/${chatId}/members`),
  getPresence: (chatId: string) =>
    api.get<ApiResponse<Record<string, boolean>>>(`/chat/chats/${chatId}/presence`),
  sendTyping: (chatId: string, is_typing = true) =>
    api.post<ApiResponse<null>>(`/chat/chats/${chatId}/typing`, { is_typing }),
  listMessages: (
    chatId: string,
    params: { limit?: number; offset?: number; before_seq_no?: number; after_seq_no?: number; latest?: boolean } = {},
  ) => {
    const query = new URLSearchParams()
    query.set('limit', String(params.limit ?? 100))
    query.set('offset', String(params.offset ?? 0))
    if (typeof params.before_seq_no === 'number') query.set('before_seq_no', String(params.before_seq_no))
    if (typeof params.after_seq_no === 'number') query.set('after_seq_no', String(params.after_seq_no))
    if (params.latest) query.set('latest', 'true')
    return api.get<ApiResponse<ChatMessageInfo[]>>(`/chat/chats/${chatId}/messages?${query.toString()}`)
  },
  sendMessage: (chatId: string, data: { body: string; body_type?: string; client_message_id?: string; meta?: ChatMessageMeta }) =>
    api.post<ApiResponse<ChatMessageInfo>>(`/chat/chats/${chatId}/messages`, data),
  deleteMessage: (messageId: string) =>
    api.delete<ApiResponse<null>>(`/chat/messages/${messageId}`),
  updateReadCursor: (chatId: string, data: { last_read_seq_no: number }) =>
    api.post<ApiResponse<{ chat_id: string; user_id: string; last_read_seq_no: number }>>(
      `/chat/chats/${chatId}/read-cursor`,
      data,
    ),
  initAttachmentUpload: (chatId: string, data: InitChatAttachmentUploadPayload) =>
    api.post<ApiResponse<InitChatAttachmentUploadResult>>(`/chat/chats/${chatId}/attachments/init-upload`, data),
  finishAttachmentUpload: (chatId: string, data: FinishChatAttachmentUploadPayload) =>
    api.post<ApiResponse<ChatAttachmentResult>>(`/chat/chats/${chatId}/attachments/finish-upload`, data),
  abortAttachmentUpload: (chatId: string, fileId: string) =>
    api.post<ApiResponse<null>>(`/chat/chats/${chatId}/attachments/${fileId}/abort-upload`, {}),
  getAttachmentDownloadUrl: (chatId: string, fileId: string) =>
    api.get<ApiResponse<{ url: string; expires_in: number }>>(`/chat/chats/${chatId}/attachments/${fileId}/download-url`),
  getClientConfig: () =>
    api.get<ApiResponse<ChatClientConfigInfo>>('/chat/client-config'),
  sendTelemetry: (payload: ChatTelemetryPayload) =>
    api.post<ApiResponse<null>>('/chat/telemetry', payload),
}
