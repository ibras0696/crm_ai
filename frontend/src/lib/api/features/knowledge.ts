import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface KBPageInfo {
  id: string
  parent_id: string | null
  title: string
  slug: string
  content: string | null
  icon: string | null
  position: number
  is_published: boolean
  created_at: string
  updated_at?: string
}

export const knowledgeApi = {
  list: () => api.get<ApiResponse<KBPageInfo[]>>('/knowledge/pages'),
  get: (id: string) => api.get<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`),
  create: (data: { title: string; content?: string; parent_id?: string; icon?: string }) => api.post<ApiResponse<KBPageInfo>>('/knowledge/pages', data),
  update: (id: string, data: { title?: string; content?: string; parent_id?: string | null; icon?: string; position?: number; is_published?: boolean }) =>
    api.patch<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/knowledge/pages/${id}`),
}
