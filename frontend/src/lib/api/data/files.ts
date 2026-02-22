import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface FileInfo {
  id: string
  org_id: string
  uploaded_by: string | null
  filename: string
  original_name: string
  content_type: string
  size: number
  created_at: string
}

export const filesApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ApiResponse<FileInfo>>('/files/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  list: (limit = 50, offset = 0) => api.get<ApiResponse<FileInfo[]>>(`/files/?limit=${limit}&offset=${offset}`),
  downloadUrl: (fileId: string) => `/api/v1/files/${fileId}/download`,
  delete: (fileId: string) => api.delete<ApiResponse<null>>(`/files/${fileId}`),
}
