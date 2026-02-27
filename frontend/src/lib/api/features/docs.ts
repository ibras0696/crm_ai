import api from '../core/client'
import type { ApiResponse } from '../core/types'

export type DocsFileType = 'txt' | 'pdf' | 'docx'
export type DocsFileStatus = 'draft' | 'uploading' | 'scanning' | 'ready' | 'blocked' | 'deleted'

export interface DocsFolder {
  id: string
  org_id: string
  parent_id: string | null
  name: string
  position: number
  created_at: string
}

export interface DocsFile {
  id: string
  org_id: string
  folder_id: string | null
  title: string | null
  type: DocsFileType | null
  status: DocsFileStatus | null
  original_name: string
  content_type: string
  size: number
  current_version_id: string | null
  created_at: string
  updated_at: string
}

export interface DocsTree {
  folders: DocsFolder[]
  files: DocsFile[]
}

export interface InitUploadPayload {
  filename: string
  size_bytes: number
  content_type: string
  folder_id?: string | null
  title?: string
}

export interface CreateEmptyFilePayload {
  type: DocsFileType
  title?: string | null
  folder_id?: string | null
}

export interface InitUploadResult {
  file_id: string
  upload_url: string
  upload_headers: Record<string, string>
  expires_in: number
}

export interface DocsUsageInfo {
  used_bytes: number
  reserved_bytes: number
  limit_bytes: number
  available_bytes: number
  percent_used: number
}

export interface DocsFileVersion {
  id: string
  file_id: string
  size_bytes: number
  mime: string
  created_by: string | null
  created_at: string
}

export interface DocsFileText {
  file_id: string
  version_id: string
  content: string
  size_bytes: number
  updated_at: string
}

export interface DocsPdfSignPayload {
  page: number
  x: number
  y: number
  width: number
  height: number
  image: string
  author?: string | null
}

export interface DocsOpenDocxResult {
  file: DocsFile
  document_server_url: string
  config: Record<string, unknown>
  token?: string | null
}

export type DocsAIGenerationJobStatus = 'queued' | 'running' | 'scanning' | 'ready' | 'blocked' | 'failed'

export interface DocsAIGeneratePayload {
  type: DocsFileType
  prompt: string
  template?: string | null
  folder_id?: string | null
  title?: string | null
  language?: string | null
}

export interface DocsAIGenerateResult {
  job_id: string
  file_id: string
  status: DocsAIGenerationJobStatus
  estimated_request_tokens: number
}

export interface DocsAIGenerationJob {
  id: string
  org_id: string
  user_id: string | null
  file_id: string | null
  file_type: DocsFileType
  status: DocsAIGenerationJobStatus
  template: string | null
  title: string | null
  language: string | null
  provider_model: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  error_message: string | null
  task_id: string | null
  meta_json?: Record<string, unknown> | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export const docsApi = {
  getTree: () => api.get<ApiResponse<DocsTree>>('/docs/tree'),
  createFolder: (payload: { name: string; parent_id?: string | null }) => api.post<ApiResponse<DocsFolder>>('/docs/folders', payload),
  updateFolder: (folderId: string, payload: { name?: string; parent_id?: string | null; position?: number }) =>
    api.patch<ApiResponse<DocsFolder>>(`/docs/folders/${folderId}`, payload),
  deleteFolder: (folderId: string) => api.delete<ApiResponse<null>>(`/docs/folders/${folderId}`),
  initUpload: (payload: InitUploadPayload) => api.post<ApiResponse<InitUploadResult>>('/docs/files/init-upload', payload),
  createEmptyFile: (payload: CreateEmptyFilePayload) => api.post<ApiResponse<DocsFile>>('/docs/files/create-empty', payload),
  finishUpload: (payload: { file_id: string; size_bytes: number; sha256?: string }) =>
    api.post<ApiResponse<DocsFile>>('/docs/files/finish-upload', payload),
  abortUpload: (fileId: string) => api.post<ApiResponse<DocsFile>>(`/docs/files/${fileId}/abort-upload`, {}),
  moveFile: (fileId: string, payload: { folder_id?: string | null }) =>
    api.patch<ApiResponse<DocsFile>>(`/docs/files/${fileId}`, payload),
  getFile: (fileId: string) => api.get<ApiResponse<DocsFile>>(`/docs/files/${fileId}`),
  getFileText: (fileId: string) => api.get<ApiResponse<DocsFileText>>(`/docs/files/${fileId}/text`),
  listFileVersions: (fileId: string) => api.get<ApiResponse<DocsFileVersion[]>>(`/docs/files/${fileId}/versions`),
  saveFileText: (fileId: string, payload: { content: string; title?: string | null }) =>
    api.post<ApiResponse<DocsFile>>(`/docs/files/${fileId}/save-text`, payload),
  signPdf: (fileId: string, payload: DocsPdfSignPayload) =>
    api.post<ApiResponse<DocsFile>>(`/docs/files/${fileId}/pdf/sign`, payload),
  openDocx: (fileId: string) => api.post<ApiResponse<DocsOpenDocxResult>>(`/docs/files/${fileId}/open-docx`, {}),
  aiGenerate: (payload: DocsAIGeneratePayload) =>
    api.post<ApiResponse<DocsAIGenerateResult>>('/docs/files/ai/generate', payload),
  getAIGenerationJob: (jobId: string) =>
    api.get<ApiResponse<DocsAIGenerationJob>>(`/docs/files/ai/jobs/${jobId}`),
  getDownload: (fileId: string) => api.get<ApiResponse<{ url: string; expires_in: number }>>(`/docs/files/${fileId}/download`),
  getUsage: () => api.get<ApiResponse<DocsUsageInfo>>('/docs/usage'),
}
