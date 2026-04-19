import api from '../core/client'
import type { ApiResponse } from '../core/types'
import type { UserInfo } from './auth'

export const profileApi = {
  update: (data: { first_name?: string; last_name?: string; timezone?: string; locale?: 'ru' | 'en' }) =>
    api.patch<ApiResponse<UserInfo>>('/auth/me', data),
}
