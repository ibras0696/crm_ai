import api from '../core/client'
import type { ApiResponse } from '../core/types'

export interface RegisterPayload {
  email: string
  password: string
  first_name: string
  last_name: string
  org_name: string
  accepted_privacy_policy: true
}

export interface RegisterConfirmPayload {
  token: string
}

export interface LoginPayload {
  email: string
  password: string
  remember_me?: boolean
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
  avatar_url?: string | null
  is_active: boolean
  timezone: string
  locale: 'ru' | 'en'
  created_at: string
}

export const authApi = {
  register: (data: RegisterPayload) => api.post<ApiResponse<TokenResponse>>('/auth/register', data),
  requestRegistration: (data: RegisterPayload) => api.post<ApiResponse<null>>('/auth/register/request', data),
  confirmRegistration: (data: RegisterConfirmPayload) => api.post<ApiResponse<TokenResponse>>('/auth/register/confirm', data),
  login: (data: LoginPayload) => api.post<ApiResponse<TokenResponse>>('/auth/login', data),
  refresh: () => api.post<ApiResponse<TokenResponse>>('/auth/refresh', {}),
  me: () => api.get<ApiResponse<UserInfo>>('/auth/me'),
  logout: () => api.post<ApiResponse<null>>('/auth/logout', {}),
  forgotPassword: (data: { email: string }) => api.post<ApiResponse<null>>('/auth/forgot-password', data),
  resetPassword: (data: { token: string; new_password: string }) => api.post<ApiResponse<null>>('/auth/reset-password', data),
}
