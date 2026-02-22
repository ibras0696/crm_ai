import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface AuditLogItem {
  id: string
  org_id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  meta: Record<string, unknown> | null
  ip_address: string | null
  correlation_id: string | null
  created_at: string
}

export const auditApi = {
  list: (limit = 50, offset = 0) => api.get<ApiResponse<AuditLogItem[]>>(`/audit/logs?limit=${limit}&offset=${offset}`),
}
