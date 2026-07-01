import api from '../core/client'
import type { ApiResponse } from '../core/types'

export type KBContentType = 'text' | 'html'

export interface KBPageInfo {
  id: string
  parent_id: string | null
  title: string
  slug: string
  content: string | null
  sanitized_content: string | null
  content_type: KBContentType
  icon: string | null
  position: number
  is_published: boolean
  created_at: string
  updated_at?: string
}

export const knowledgeApi = {
  list: () => api.get<ApiResponse<KBPageInfo[]>>('/knowledge/pages'),
  get: (id: string) => api.get<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`),
  create: (data: { title: string; content?: string; content_type?: KBContentType; parent_id?: string; icon?: string }) =>
    api.post<ApiResponse<KBPageInfo>>('/knowledge/pages', data),
  update: (id: string, data: { expected_updated_at: string; title?: string; content?: string; content_type?: KBContentType; parent_id?: string | null; icon?: string; position?: number; is_published?: boolean }) =>
    api.patch<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/knowledge/pages/${id}`),
}
