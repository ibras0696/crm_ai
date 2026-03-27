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
  meta: Record<string, unknown> | null
  created_at: string
}

export interface ChatMemberInfo {
  id: string
  chat_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member' | 'readonly'
  last_read_seq_no: number
  created_at: string
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
  listMessages: (
    chatId: string,
    params: { limit?: number; offset?: number; before_seq_no?: number; latest?: boolean } = {},
  ) => {
    const query = new URLSearchParams()
    query.set('limit', String(params.limit ?? 100))
    query.set('offset', String(params.offset ?? 0))
    if (typeof params.before_seq_no === 'number') query.set('before_seq_no', String(params.before_seq_no))
    if (params.latest) query.set('latest', 'true')
    return api.get<ApiResponse<ChatMessageInfo[]>>(`/chat/chats/${chatId}/messages?${query.toString()}`)
  },
  sendMessage: (chatId: string, data: { body: string; body_type?: string; meta?: Record<string, unknown> }) =>
    api.post<ApiResponse<ChatMessageInfo>>(`/chat/chats/${chatId}/messages`, data),
  updateReadCursor: (chatId: string, data: { last_read_seq_no: number }) =>
    api.post<ApiResponse<{ chat_id: string; user_id: string; last_read_seq_no: number }>>(
      `/chat/chats/${chatId}/read-cursor`,
      data,
    ),
}
