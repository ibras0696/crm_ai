import axios from 'axios'

const SA_TOKEN_KEY = 'sa_access_token'

export const superadminHttp = axios.create({
  baseURL: '/api/v1/superadmin',
  headers: { 'Content-Type': 'application/json' },
})

superadminHttp.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(SA_TOKEN_KEY)
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

