import apiClient from '../core/client'

export interface AppearanceData {
  mode: 'dark' | 'light'
  accent: string
  custom_enabled: boolean
  primary_h: number
  primary_s: number
  primary_l: number
  radius: number
}

export const appearanceApi = {
  get: () => apiClient.get<{ ok: boolean; data: AppearanceData }>('/appearance'),
  update: (data: Partial<AppearanceData>) =>
    apiClient.put<{ ok: boolean; data: AppearanceData }>('/appearance', data),
}
