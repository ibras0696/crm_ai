import axios from 'axios'
import { getPreferredLocale } from '@/lib/i18n'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

let refreshPromise: Promise<void> | null = null
let authRedirectInProgress = false

api.interceptors.request.use((config) => {
  const locale = getPreferredLocale()
  if (config.headers && typeof config.headers.set === 'function') {
    config.headers.set('Accept-Language', locale)
  } else {
    ;(config.headers as Record<string, string>)['Accept-Language'] = locale
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const reqUrl = String(originalRequest?.url || '')
    const isAuthEndpoint =
      reqUrl.includes('/auth/login') ||
      reqUrl.includes('/auth/register') ||
      reqUrl.includes('/auth/refresh') ||
      reqUrl.includes('/auth/logout')
    const isBootstrapAuthProbe =
      reqUrl.includes('/auth/me') ||
      reqUrl.includes('/orgs/current') ||
      reqUrl.includes('/orgs/members')

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint && !isBootstrapAuthProbe) {
      originalRequest._retry = true
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post('/api/v1/auth/refresh', {}, { withCredentials: true, timeout: 10_000 })
            .then(() => undefined)
            .finally(() => {
              refreshPromise = null
            })
        }
        await refreshPromise
        return api(originalRequest)
      } catch {
        refreshPromise = null
        const path = window.location.pathname
        const isAuthPage = path.startsWith('/login') || path.startsWith('/register')
        if (!isAuthPage && !authRedirectInProgress) {
          authRedirectInProgress = true
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api
