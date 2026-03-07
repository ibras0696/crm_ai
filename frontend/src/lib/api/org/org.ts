import api from '../core/client'
import type { ApiResponse } from '../core/types'
import type { TokenResponse } from '../auth/auth'

export interface OrgInfo {
  id: string
  name: string
  slug: string
  plan: string
  created_at: string
}

export interface MemberInfo {
  id: string
  user_id: string
  org_id: string
  role: string
  user_email: string | null
  user_first_name: string | null
  user_last_name: string | null
  created_at: string
}

export interface OrgAILimitUserInfo {
  user_id: string
  membership_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string
  daily_tokens_limit: number
  rpm_limit: number
  usage_today_tokens: number
  usage_month_tokens: number
  usage_last_min_requests: number
}

export interface OrgAILimitsInfo {
  org_limits: {
    daily_tokens_limit: number
    monthly_tokens_limit: number
  }
  effective_defaults: {
    plan_daily_tokens_limit: number
    plan_rpm_per_user: number
    plan_max_tokens_per_request: number
  }
  users: OrgAILimitUserInfo[]
}

export interface InviteInfo {
  id: string
  org_id: string
  email: string
  role: string
  status: string
  token?: string | null
  invitee_exists?: boolean | null
  expires_at: string
  created_at: string
}

export interface AcceptInvitePayload {
  token: string
  password: string
  first_name: string
  last_name?: string
}

export const orgApi = {
  getCurrent: () => api.get<ApiResponse<OrgInfo>>('/orgs/current'),
  deleteCurrent: () => api.delete<ApiResponse<null>>('/orgs/current'),
  updateCurrent: (data: { name?: string }) => api.patch<ApiResponse<OrgInfo>>('/orgs/current', data),
  getMyOrgs: () =>
    api.get<ApiResponse<Array<{ org_id: string; org_name: string; org_slug: string; role: string }>>>('/orgs/my'),
  getMembers: () => api.get<ApiResponse<MemberInfo[]>>('/orgs/members'),
  createInvite: (data: { email: string; role: string }) => api.post<ApiResponse<InviteInfo>>('/orgs/invites', data),
  acceptInvite: (data: AcceptInvitePayload) => api.post<ApiResponse<TokenResponse>>('/orgs/invites/accept', data),
  updateMemberRole: (memberId: string, role: string) =>
    api.put<ApiResponse<unknown>>(`/orgs/members/${memberId}/role`, { role }),
  removeMember: (memberId: string) => api.delete<ApiResponse<unknown>>(`/orgs/members/${memberId}`),
  switchOrg: (org_id: string) => api.post<ApiResponse<TokenResponse>>('/orgs/switch', { org_id }),
  getAiLimits: () => api.get<ApiResponse<OrgAILimitsInfo>>('/orgs/ai/limits'),
  updateAiOrgLimits: (data: { daily_tokens_limit: number; monthly_tokens_limit: number }) =>
    api.patch<ApiResponse<OrgAILimitsInfo>>('/orgs/ai/limits', data),
  upsertAiUserLimits: (userId: string, data: { daily_tokens_limit: number; rpm_limit: number }) =>
    api.put<ApiResponse<OrgAILimitsInfo>>(`/orgs/ai/limits/users/${userId}`, data),
}
