import api from './client'
import type { ApiResponse } from './types'

export interface RegisterPayload {
  email: string
  password: string
  first_name: string
  last_name: string
  org_name: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface UserInfo {
  id: string
  email: string
  first_name: string
  last_name: string
  is_active: boolean
  timezone: string
  created_at: string
}

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

export const authApi = {
  register: (data: RegisterPayload) => api.post<ApiResponse<TokenResponse>>('/auth/register', data),
  login: (data: LoginPayload) => api.post<ApiResponse<TokenResponse>>('/auth/login', data),
  me: () => api.get<ApiResponse<UserInfo>>('/auth/me'),
  logout: (refresh_token: string) => api.post<ApiResponse<null>>('/auth/logout', { refresh_token }),
}

export const orgApi = {
  getCurrent: () => api.get<ApiResponse<OrgInfo>>('/orgs/current'),
  deleteCurrent: () => api.delete<ApiResponse<null>>('/orgs/current'),
  updateCurrent: (data: { name?: string }) => api.patch<ApiResponse<OrgInfo>>('/orgs/current', data),
  getMyOrgs: () => api.get<ApiResponse<Array<{ org_id: string; org_name: string; org_slug: string; role: string }>>>('/orgs/my'),
  getMembers: () => api.get<ApiResponse<MemberInfo[]>>('/orgs/members'),
  createInvite: (data: { email: string; role: string }) => api.post<ApiResponse<unknown>>('/orgs/invites', data),
  acceptInvite: (data: { token: string }) => api.post<ApiResponse<unknown>>('/orgs/invites/accept', data),
  updateMemberRole: (memberId: string, role: string) => api.put<ApiResponse<unknown>>(`/orgs/members/${memberId}/role`, { role }),
  removeMember: (memberId: string) => api.delete<ApiResponse<unknown>>(`/orgs/members/${memberId}`),
  switchOrg: (org_id: string) => api.post<ApiResponse<TokenResponse>>('/orgs/switch', { org_id }),
}

export const profileApi = {
  update: (data: { first_name?: string; last_name?: string; timezone?: string }) => api.patch<ApiResponse<UserInfo>>('/auth/me', data),
}
