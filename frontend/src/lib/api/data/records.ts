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

export interface RecordFilterItem {
  col_id: string
  op: 'eq' | 'neq' | 'gt' | 'lt' | 'between' | 'contains' | 'is_empty' | 'in'
  value?: unknown
}

export interface RecordSortItem {
  col_id: string
  dir: 'asc' | 'desc'
}

export interface CsvImportRowError {
  row_number: number
  column: string
  code: string
  message: string
  raw_value?: string | null
}

export interface CsvImportPreview {
  mode: 'append' | 'replace'
  header: string[]
  matched_columns: Array<{ csv_column: string; table_column_id: string | null; table_column_name: string | null }>
  total_rows: number
  valid_rows: number
  invalid_rows: number
  sample_rows: Array<{ row_number: number; data: Record<string, unknown> }>
  errors: CsvImportRowError[]
}

export interface CsvImportCommit {
  mode: 'append' | 'replace'
  records_created: number
  records_skipped: number
  deleted_before: number
  total_rows: number
  errors: CsvImportRowError[]
}

export interface RecordHistoryItem {
  id: string
  action: string
  actor_id: string | null
  changed_columns: string[]
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  source: string | null
  created_at: string
}

export interface RecordHistoryPage {
  items: RecordHistoryItem[]
  total: number
}

export const recordsApi = {
  list: (tableId: string, limit = 100, offset = 0) => api.get<ApiResponse<RecordListResponse>>(`/tables/${tableId}/records/?limit=${limit}&offset=${offset}`),
  get: (tableId: string, recordId: string) => api.get<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`),
  create: (tableId: string, data: Record<string, unknown>) => api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/`, { data }),
  update: (tableId: string, recordId: string, data: Record<string, unknown>, expectedUpdatedAt: string) =>
    api.patch<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`, { data, expected_updated_at: expectedUpdatedAt }),
  delete: (tableId: string, recordId: string) => api.delete<ApiResponse<null>>(`/tables/${tableId}/records/${recordId}`),
  move: (tableId: string, recordId: string, direction: 'up' | 'down') => api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}/move`, { direction }),
  filter: (
    tableId: string,
    payload: {
      search?: string
      filters?: RecordFilterItem[] | Record<string, unknown>
      sorts?: RecordSortItem[]
    },
    limit = 100,
    offset = 0,
  ) =>
    api.post<ApiResponse<{ records: RecordInfo[]; total: number }>>(
      `/tables/${tableId}/filter?limit=${limit}&offset=${offset}`,
      payload,
    ),
  exportCsv: (tableId: string) => api.get(`/tables/${tableId}/export/csv`, { responseType: 'blob' }),
  exportXlsx: (tableId: string) => api.get(`/tables/${tableId}/export/xlsx`, { responseType: 'blob' }),
  bulkUpdate: (tableId: string, recordIds: string[], data: Record<string, unknown>) =>
    api.post<ApiResponse<{ updated: number }>>(`/tables/${tableId}/records/actions/bulk-update`, { record_ids: recordIds, data }),
  bulkDelete: (tableId: string, recordIds: string[]) =>
    api.post<ApiResponse<{ deleted: number }>>(`/tables/${tableId}/records/actions/bulk-delete`, { record_ids: recordIds }),
  importCsv: (tableId: string, file: File, mode: 'append' | 'replace' = 'append') => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ApiResponse<{ records_created: number; deleted_before: number; mode: string }>>(
      `/tables/${tableId}/import/csv?mode=${mode}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
  previewImportCsv: (tableId: string, file: File, mode: 'append' | 'replace' = 'append', mapping?: Record<string, string>) => {
    const form = new FormData()
    form.append('file', file)
    if (mapping && Object.keys(mapping).length > 0) {
      form.append('mapping_json', JSON.stringify(mapping))
    }
    return api.post<ApiResponse<CsvImportPreview>>(
      `/tables/${tableId}/import/csv/preview?mode=${mode}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
  commitImportCsv: (
    tableId: string,
    file: File,
    mode: 'append' | 'replace' = 'append',
    strict = false,
    mapping?: Record<string, string>,
  ) => {
    const form = new FormData()
    form.append('file', file)
    if (mapping && Object.keys(mapping).length > 0) {
      form.append('mapping_json', JSON.stringify(mapping))
    }
    return api.post<ApiResponse<CsvImportCommit>>(
      `/tables/${tableId}/import/csv/commit?mode=${mode}&strict=${strict ? 'true' : 'false'}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
  listHistory: (tableId: string, recordId: string, limit = 50, offset = 0) =>
    api.get<ApiResponse<RecordHistoryPage>>(`/tables/${tableId}/records/${recordId}/history?limit=${limit}&offset=${offset}`),
  rollbackLast: (tableId: string, recordId: string) =>
    api.post<ApiResponse<{ record: RecordInfo; rollback_from_history_id: string }>>(
      `/tables/${tableId}/records/${recordId}/history/rollback-last`,
    ),
}
