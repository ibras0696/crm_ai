import type { ApiResponse } from '../core/types'
import { superadminHttp } from './client'

export interface SuperadminDashboard {
  totals: {
    orgs: number
    users: number
    tables: number
    records: number
    files: number
    storage_bytes: number
    ai_requests: number
    ai_tokens: number
  }
  registrations_timeline: { date: string; count: number }[]
  orgs_by_plan: { plan: string; count: number }[]
  analytics?: Record<string, any>
}

export interface SuperadminOrgOption {
  id: string
  name: string
  slug: string
  plan: string
  created_at?: string | null
}

export interface SuperadminOverview {
  dashboard: SuperadminDashboard
  orgs: SuperadminOrgOption[]
  generated_at: string
}

export interface SuperadminSubscriptionInfo {
  plan: string
  status: string
  current_period_start?: string | null
  current_period_end?: string | null
  external_id?: string | null
}

export interface SuperadminOrgListItem {
  id: string
  name: string
  slug: string
  plan: string
  created_at?: string | null
  members: number
  tables: number
  records: number
  subscription?: SuperadminSubscriptionInfo | null
}

export interface SuperadminOrgListPage {
  items: SuperadminOrgListItem[]
  total: number
  limit: number
  offset: number
}

export interface SuperadminPlanLimits {
  name: string
  display_name: string
  price_monthly: number
  price_yearly: number
  max_members: number
  max_tables: number
  max_records: number
  max_storage_mb: number
  has_ai: boolean
  ai_max_tokens_per_request: number
  ai_tokens_per_day: number
  ai_rpm_per_user: number
}

export interface SuperadminOrgDetail {
  org: { id: string; name: string; slug: string; plan: string; ai_enabled: boolean; created_at?: string | null }
  subscription?: SuperadminSubscriptionInfo | null
  plan_limits?: SuperadminPlanLimits | null
  usage: { members: number; tables: number; records: number; files: number; storage_bytes: number }
  ai_usage_today: { tokens_used: number }
}

export interface SuperadminOrgMemberItem {
  user: {
    id: string
    email: string
    first_name: string
    last_name: string
    is_active: boolean
    created_at?: string | null
  }
  membership: { id: string; role: string; created_at?: string | null }
}

export interface SuperadminOrgMembersPage {
  items: SuperadminOrgMemberItem[]
  total: number
  limit: number
  offset: number
}

export interface SuperadminUserListItem {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  created_at?: string | null
  orgs: Array<{ org_id: string; role: string }>
}

export interface SuperadminUserListPage {
  items: SuperadminUserListItem[]
  total: number
  limit: number
  offset: number
}

export interface SuperadminAuditItem {
  id: string
  org_id: string
  org_name: string
  actor_id?: string | null
  action: string
  entity_type: string
  entity_id?: string | null
  meta?: Record<string, unknown> | null
  ip_address?: string | null
  correlation_id?: string | null
  created_at?: string | null
}

export interface SuperadminAuditPage {
  items: SuperadminAuditItem[]
  total: number
  limit: number
  offset: number
}

export const superadminApi = {
  login: (email: string, password: string) =>
    superadminHttp.post<ApiResponse<{ access_token: string; token_type: string }>>('/login', { email, password }),
  logout: () => superadminHttp.post<ApiResponse<null>>('/logout', {}),
  overview: (org_limit = 200) => superadminHttp.get<ApiResponse<SuperadminOverview>>(`/overview?org_limit=${org_limit}`),
  orgs: (params: { q?: string; plan?: string; sub_status?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.plan) q.set('plan', params.plan)
    if (params.sub_status) q.set('sub_status', params.sub_status)
    q.set('limit', String(params.limit ?? 50))
    q.set('offset', String(params.offset ?? 0))
    return superadminHttp.get<ApiResponse<SuperadminOrgListPage>>(`/orgs?${q.toString()}`)
  },
  orgDetail: (orgId: string) => superadminHttp.get<ApiResponse<SuperadminOrgDetail>>(`/orgs/${orgId}`),
  orgMembers: (orgId: string, params: { limit?: number; offset?: number }) =>
    superadminHttp.get<ApiResponse<SuperadminOrgMembersPage>>(`/orgs/${orgId}/members?limit=${params.limit ?? 50}&offset=${params.offset ?? 0}`),
  setPlan: (orgId: string, plan: string) => superadminHttp.patch<ApiResponse<{ org_id: string; plan: string }>>(`/orgs/${orgId}/plan`, { plan }),
  setOrgAiEnabled: (orgId: string, enabled: boolean) =>
    superadminHttp.patch<ApiResponse<{ org_id: string; ai_enabled: boolean }>>(`/orgs/${orgId}/ai-enabled`, { enabled }),
  resetOrgAiUsage: (orgId: string) =>
    superadminHttp.post<ApiResponse<{ org_id: string; scope: string; removed_requests: number; removed_tokens: number }>>(
      `/orgs/${orgId}/ai/reset-usage`
    ),
  users: (params: { q?: string; org_id?: string; is_active?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.org_id) q.set('org_id', params.org_id)
    if (params.is_active !== undefined) q.set('is_active', String(params.is_active))
    q.set('limit', String(params.limit ?? 50))
    q.set('offset', String(params.offset ?? 0))
    return superadminHttp.get<ApiResponse<SuperadminUserListPage>>(`/users?${q.toString()}`)
  },
  audit: (params: { org_id?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params.org_id) q.set('org_id', params.org_id)
    q.set('limit', String(params.limit ?? 50))
    q.set('offset', String(params.offset ?? 0))
    return superadminHttp.get<ApiResponse<SuperadminAuditPage>>(`/audit/logs?${q.toString()}`)
  },
  aiUsage: () => superadminHttp.get<ApiResponse<Array<{ org_id: string; org_name: string; requests: number; tokens: number }>>>('/ai-usage'),
  aiConfig: () =>
    superadminHttp.get<
      ApiResponse<{
        provider: string
        base_url: string
        official_provider_docs_url?: string
        model: string
        key_configured: boolean
        key_prefix: string
      }>
    >('/ai-config'),
}
