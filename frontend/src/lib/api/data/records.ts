import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface RecordInfo {
  id: string
  table_id: string
  data: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
  position: number
}

export interface RecordListResponse {
  records: RecordInfo[]
  total: number
}

export const recordsApi = {
  list: (tableId: string, limit = 100, offset = 0) => api.get<ApiResponse<RecordListResponse>>(`/tables/${tableId}/records/?limit=${limit}&offset=${offset}`),
  get: (tableId: string, recordId: string) => api.get<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`),
  create: (tableId: string, data: Record<string, unknown>) => api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/`, { data }),
  update: (tableId: string, recordId: string, data: Record<string, unknown>) => api.patch<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`, { data }),
  delete: (tableId: string, recordId: string) => api.delete<ApiResponse<null>>(`/tables/${tableId}/records/${recordId}`),
  move: (tableId: string, recordId: string, direction: 'up' | 'down') => api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}/move`, { direction }),
  filter: (tableId: string, filters?: Record<string, unknown>, sorts?: Array<{ col_id: string; dir: string }>, limit = 100, offset = 0) =>
    api.post<ApiResponse<{ records: RecordInfo[]; total: number }>>(`/tables/${tableId}/filter?limit=${limit}&offset=${offset}`, { filters, sorts }),
  exportCsv: (tableId: string) => api.get(`/tables/${tableId}/export/csv`, { responseType: 'blob' }),
  exportXlsx: (tableId: string) => api.get(`/tables/${tableId}/export/xlsx`, { responseType: 'blob' }),
}
