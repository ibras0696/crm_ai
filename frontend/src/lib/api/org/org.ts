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

export const orgApi = {
  getCurrent: () => api.get<ApiResponse<OrgInfo>>('/orgs/current'),
  deleteCurrent: () => api.delete<ApiResponse<null>>('/orgs/current'),
  updateCurrent: (data: { name?: string }) => api.patch<ApiResponse<OrgInfo>>('/orgs/current', data),
  getMyOrgs: () =>
    api.get<ApiResponse<Array<{ org_id: string; org_name: string; org_slug: string; role: string }>>>('/orgs/my'),
  getMembers: () => api.get<ApiResponse<MemberInfo[]>>('/orgs/members'),
  createInvite: (data: { email: string; role: string }) => api.post<ApiResponse<unknown>>('/orgs/invites', data),
  acceptInvite: (data: { token: string }) => api.post<ApiResponse<unknown>>('/orgs/invites/accept', data),
  updateMemberRole: (memberId: string, role: string) =>
    api.put<ApiResponse<unknown>>(`/orgs/members/${memberId}/role`, { role }),
  removeMember: (memberId: string) => api.delete<ApiResponse<unknown>>(`/orgs/members/${memberId}`),
  switchOrg: (org_id: string) => api.post<ApiResponse<TokenResponse>>('/orgs/switch', { org_id }),
}
