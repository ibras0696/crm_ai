import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface ColumnInfo {
  id: string
  name: string
  field_type: string
  position: number
  is_required: boolean
  is_primary: boolean
  config: Record<string, unknown> | null
  default_value: string | null
}

export interface TableInfo {
  id: string
  org_id: string
  folder_id: string | null
  name: string
  description: string | null
  icon: string | null
  color: string | null
  is_archived: boolean
  columns: ColumnInfo[]
  created_at: string
}

export interface FolderInfo {
  id: string
  org_id: string
  parent_id: string | null
  name: string
  position: number
  created_at: string
}

export interface TableViewInfo {
  id: string
  table_id: string
  name: string
  view_type: string
  is_default: boolean
  filters: unknown
  sorts: unknown
  config: unknown
  created_at: string
}

export interface RelationOptionInfo {
  id: string
  label: string
}

export interface FormulaPreviewInfo {
  expression: string
  referenced_column_ids: string[]
  value_preview: unknown | null
  warnings: string[]
  is_valid: boolean
  error: string | null
}

export const tablesApi = {
  list: () => api.get<ApiResponse<TableInfo[]>>('/tables/'),
  get: (id: string) => api.get<ApiResponse<TableInfo>>(`/tables/${id}`),
  create: (data: { name: string; description?: string; icon?: string; color?: string; folder_id?: string }) =>
    api.post<ApiResponse<TableInfo>>('/tables/', data),
  update: (id: string, data: { name?: string; description?: string; icon?: string; color?: string; is_archived?: boolean; folder_id?: string | null }) =>
    api.patch<ApiResponse<TableInfo>>(`/tables/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/tables/${id}`),
  createColumn: (tableId: string, data: { name: string; field_type: string; is_required?: boolean; config?: Record<string, unknown> | null }) =>
    api.post<ApiResponse<ColumnInfo>>(`/tables/${tableId}/columns`, data),
  updateColumn: (tableId: string, columnId: string, data: { name?: string; field_type?: string; position?: number; is_required?: boolean; config?: Record<string, unknown> | null }) =>
    api.patch<ApiResponse<ColumnInfo>>(`/tables/${tableId}/columns/${columnId}`, data),
  deleteColumn: (tableId: string, columnId: string) =>
    api.delete<ApiResponse<null>>(`/tables/${tableId}/columns/${columnId}`),
  relationOptions: (tableId: string, columnId: string, params?: { limit?: number; search?: string }) => {
    const q = new URLSearchParams()
    if (typeof params?.limit === 'number') q.set('limit', String(params.limit))
    if (params?.search) q.set('search', params.search)
    const suffix = q.toString() ? `?${q.toString()}` : ''
    return api.get<ApiResponse<RelationOptionInfo[]>>(`/tables/${tableId}/columns/${columnId}/relation-options${suffix}`)
  },
  previewFormula: (tableId: string, data: { expression: string; sample_row?: Record<string, unknown> | null }) =>
    api.post<ApiResponse<FormulaPreviewInfo>>(`/tables/${tableId}/formula/preview`, data),

  // Folder endpoints
  listFolders: () => api.get<ApiResponse<FolderInfo[]>>('/tables/folders/'),
  createFolder: (data: { name: string; parent_id?: string | null }) => api.post<ApiResponse<FolderInfo>>('/tables/folders/', data),
  updateFolder: (folderId: string, data: { name?: string; position?: number; parent_id?: string | null }) =>
    api.patch<ApiResponse<FolderInfo>>(`/tables/folders/${folderId}`, data),
  deleteFolder: (folderId: string) => api.delete<ApiResponse<null>>(`/tables/folders/${folderId}`),

  // Saved views
  listViews: (tableId: string) => api.get<ApiResponse<TableViewInfo[]>>(`/tables/${tableId}/views/`),
  createView: (
    tableId: string,
    data: {
      name: string
      view_type?: string
      is_default?: boolean
      filters?: unknown
      sorts?: unknown
      config?: unknown
    },
  ) => api.post<ApiResponse<TableViewInfo>>(`/tables/${tableId}/views/`, data),
  updateView: (
    tableId: string,
    viewId: string,
    data: {
      name?: string
      view_type?: string
      is_default?: boolean
      filters?: unknown
      sorts?: unknown
      config?: unknown
    },
  ) => api.patch<ApiResponse<TableViewInfo>>(`/tables/${tableId}/views/${viewId}`, data),
  deleteView: (tableId: string, viewId: string) =>
    api.delete<ApiResponse<null>>(`/tables/${tableId}/views/${viewId}`),
}
