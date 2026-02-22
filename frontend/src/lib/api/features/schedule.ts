import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface EventInfo {
  id: string
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  all_day: boolean
  color: string | null
  is_done: boolean
  recurrence: string | null
  assigned_to: string | null
  created_at: string
}

export const scheduleApi = {
  list: (start?: string, end?: string) => {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    return api.get<ApiResponse<EventInfo[]>>(`/schedule/events?${params}`)
  },
  get: (id: string) => api.get<ApiResponse<EventInfo>>(`/schedule/events/${id}`),
  create: (data: { title: string; start_at: string; end_at?: string; description?: string; all_day?: boolean; color?: string; assigned_to?: string; recurrence?: string }) =>
    api.post<ApiResponse<EventInfo>>('/schedule/events', data),
  update: (id: string, data: { title?: string; start_at?: string; end_at?: string; description?: string; all_day?: boolean; color?: string; is_done?: boolean; recurrence?: string }) =>
    api.patch<ApiResponse<EventInfo>>(`/schedule/events/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/schedule/events/${id}`),
}
