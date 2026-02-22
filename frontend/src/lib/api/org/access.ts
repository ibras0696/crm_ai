import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface AccessRule {
  id: string
  resource_type: string
  resource_id: string | null
  role: string | null
  user_id: string | null
  can_read: boolean
  can_write: boolean
  can_delete: boolean
  created_at: string
}

export const accessApi = {
  list: (resource_type?: string, resource_id?: string) => {
    const params = new URLSearchParams()
    if (resource_type) params.set('resource_type', resource_type)
    if (resource_id) params.set('resource_id', resource_id)
    return api.get<ApiResponse<AccessRule[]>>(`/access/rules?${params}`)
  },
  create: (data: { resource_type: string; resource_id?: string; role?: string; user_id?: string; can_read?: boolean; can_write?: boolean; can_delete?: boolean }) =>
    api.post<ApiResponse<AccessRule>>('/access/rules', data),
  update: (id: string, data: { can_read?: boolean; can_write?: boolean; can_delete?: boolean }) =>
    api.patch<ApiResponse<AccessRule>>(`/access/rules/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/access/rules/${id}`),
}
