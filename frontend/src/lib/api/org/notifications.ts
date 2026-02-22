import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface NotificationInfo {
  id: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
}

export interface UnreadCount {
  count: number
}

export const notificationsApi = {
  list: (limit = 50, offset = 0) => api.get<ApiResponse<NotificationInfo[]>>(`/notifications/?limit=${limit}&offset=${offset}`),
  unreadCount: () => api.get<ApiResponse<UnreadCount>>('/notifications/unread-count'),
  markRead: (id: string) => api.post<ApiResponse<null>>(`/notifications/${id}/read`),
  markAllRead: () => api.post<ApiResponse<null>>('/notifications/read-all'),
}
