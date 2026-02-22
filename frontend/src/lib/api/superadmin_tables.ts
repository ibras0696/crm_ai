import type { ApiResponse } from './types'
import { superadminHttp } from './superadmin_client'

export interface SATableListItem {
  id: string
  org_id: string
  folder_id: string | null
  name: string
  description: string | null
  icon: string | null
  color: string | null
  is_archived: boolean
  created_at: string | null
  columns: number
  records: number
}

export interface SATableListPage {
  items: SATableListItem[]
  total: number
  limit: number
  offset: number
}

export interface SATableDetail {
  id: string
  org_id: string
  folder_id: string | null
  name: string
  description: string | null
  icon: string | null
  color: string | null
  is_archived: boolean
  created_at: string | null
  columns: Array<{ id: string; name: string; field_type: string; position: number; is_required: boolean; is_primary: boolean }>
}

export interface SARecordItem {
  id: string
  table_id: string
  data: Record<string, unknown>
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  position: number
}

export interface SARecordListPage {
  items: SARecordItem[]
  total: number
  limit: number
  offset: number
}

export const superadminTablesApi = {
  listOrgTables: (orgId: string, params: { q?: string; include_archived?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    q.set('include_archived', String(params.include_archived ?? true))
    q.set('limit', String(params.limit ?? 50))
    q.set('offset', String(params.offset ?? 0))
    return superadminHttp.get<ApiResponse<SATableListPage>>(`/orgs/${orgId}/tables?${q.toString()}`)
  },
  getTable: (orgId: string, tableId: string) => superadminHttp.get<ApiResponse<SATableDetail>>(`/orgs/${orgId}/tables/${tableId}`),
  listRecords: (
    orgId: string,
    tableId: string,
    params: { q?: string; sort_col_id?: string; sort_dir?: 'asc' | 'desc'; limit?: number; offset?: number }
  ) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.sort_col_id) q.set('sort_col_id', params.sort_col_id)
    q.set('sort_dir', params.sort_dir ?? 'asc')
    q.set('limit', String(params.limit ?? 100))
    q.set('offset', String(params.offset ?? 0))
    return superadminHttp.get<ApiResponse<SARecordListPage>>(`/orgs/${orgId}/tables/${tableId}/records?${q.toString()}`)
  },
  exportCsv: (orgId: string, tableId: string) => superadminHttp.get(`/orgs/${orgId}/tables/${tableId}/export/csv`, { responseType: 'blob' }),
  exportXlsx: (orgId: string, tableId: string) => superadminHttp.get(`/orgs/${orgId}/tables/${tableId}/export/xlsx`, { responseType: 'blob' }),
}
