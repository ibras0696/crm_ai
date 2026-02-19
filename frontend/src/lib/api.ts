import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach access token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor: handle 401 → try refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      const refreshToken = localStorage.getItem('refresh_token')
      if (refreshToken) {
        try {
          const resp = await axios.post('/api/v1/auth/refresh', {
            refresh_token: refreshToken,
          })
          const { access_token, refresh_token } = resp.data.data
          localStorage.setItem('access_token', access_token)
          localStorage.setItem('refresh_token', refresh_token)
          originalRequest.headers.Authorization = `Bearer ${access_token}`
          return api(originalRequest)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/login'
        }
      } else {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api

// --- Auth ---
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

export interface ApiResponse<T> {
  ok: boolean
  data: T | null
  error: { code: string; message: string; field?: string } | null
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
  register: (data: RegisterPayload) =>
    api.post<ApiResponse<TokenResponse>>('/auth/register', data),
  login: (data: LoginPayload) =>
    api.post<ApiResponse<TokenResponse>>('/auth/login', data),
  me: () => api.get<ApiResponse<UserInfo>>('/auth/me'),
  logout: (refresh_token: string) =>
    api.post<ApiResponse<null>>('/auth/logout', { refresh_token }),
}

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
  list: (limit = 50, offset = 0) =>
    api.get<ApiResponse<AuditLogItem[]>>(`/audit/logs?limit=${limit}&offset=${offset}`),
}

export const orgApi = {
  getCurrent: () => api.get<ApiResponse<OrgInfo>>('/orgs/current'),
  deleteCurrent: () => api.delete<ApiResponse<null>>('/orgs/current'),
  updateCurrent: (data: { name?: string }) => api.patch<ApiResponse<OrgInfo>>('/orgs/current', data),
  getMyOrgs: () => api.get<ApiResponse<Array<{ org_id: string; org_name: string; org_slug: string; role: string }>>>('/orgs/my'),
  getMembers: () => api.get<ApiResponse<MemberInfo[]>>('/orgs/members'),
  createInvite: (data: { email: string; role: string }) =>
    api.post<ApiResponse<unknown>>('/orgs/invites', data),
  acceptInvite: (data: { token: string }) =>
    api.post<ApiResponse<unknown>>('/orgs/invites/accept', data),
  updateMemberRole: (memberId: string, role: string) =>
    api.put<ApiResponse<unknown>>(`/orgs/members/${memberId}/role`, { role }),
  removeMember: (memberId: string) =>
    api.delete<ApiResponse<unknown>>(`/orgs/members/${memberId}`),
  switchOrg: (org_id: string) =>
    api.post<ApiResponse<TokenResponse>>('/orgs/switch', { org_id }),
}

export const profileApi = {
  update: (data: { first_name?: string; last_name?: string; timezone?: string }) =>
    api.patch<ApiResponse<UserInfo>>('/auth/me', data),
}

// --- Files ---
export interface FileInfo {
  id: string
  org_id: string
  uploaded_by: string | null
  filename: string
  original_name: string
  content_type: string
  size: number
  created_at: string
}

export const filesApi = {
  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ApiResponse<FileInfo>>('/files/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  list: (limit = 50, offset = 0) =>
    api.get<ApiResponse<FileInfo[]>>(`/files/?limit=${limit}&offset=${offset}`),
  downloadUrl: (fileId: string) => `/api/v1/files/${fileId}/download`,
  delete: (fileId: string) =>
    api.delete<ApiResponse<null>>(`/files/${fileId}`),
}

// --- Notifications ---
export interface NotificationInfo {
  id: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
}

export interface UnreadCount {
  count: number
}

export const notificationsApi = {
  list: (limit = 50, offset = 0) =>
    api.get<ApiResponse<NotificationInfo[]>>(`/notifications/?limit=${limit}&offset=${offset}`),
  unreadCount: () =>
    api.get<ApiResponse<UnreadCount>>('/notifications/unread-count'),
  markRead: (id: string) =>
    api.post<ApiResponse<null>>(`/notifications/${id}/read`),
  markAllRead: () =>
    api.post<ApiResponse<null>>('/notifications/read-all'),
}

// --- Tables ---
export interface ColumnInfo {
  id: string
  name: string
  field_type: string
  position: number
  is_required: boolean
  is_primary: boolean
  config: Record<string, unknown> | null
  default_value: string | null
}

export interface TableInfo {
  id: string
  org_id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  is_archived: boolean
  columns: ColumnInfo[]
  created_at: string
}

export const tablesApi = {
  list: () =>
    api.get<ApiResponse<TableInfo[]>>('/tables/'),
  get: (id: string) =>
    api.get<ApiResponse<TableInfo>>(`/tables/${id}`),
  create: (data: { name: string; description?: string; icon?: string; color?: string }) =>
    api.post<ApiResponse<TableInfo>>('/tables/', data),
  update: (id: string, data: { name?: string; description?: string; icon?: string; color?: string; is_archived?: boolean }) =>
    api.patch<ApiResponse<TableInfo>>(`/tables/${id}`, data),
  delete: (id: string) =>
    api.delete<ApiResponse<null>>(`/tables/${id}`),
  createColumn: (tableId: string, data: { name: string; field_type: string; is_required?: boolean; config?: Record<string, unknown> }) =>
    api.post<ApiResponse<ColumnInfo>>(`/tables/${tableId}/columns`, data),
  updateColumn: (tableId: string, columnId: string, data: { name?: string; field_type?: string; position?: number; is_required?: boolean; config?: Record<string, unknown> }) =>
    api.patch<ApiResponse<ColumnInfo>>(`/tables/${tableId}/columns/${columnId}`, data),
  deleteColumn: (tableId: string, columnId: string) =>
    api.delete<ApiResponse<null>>(`/tables/${tableId}/columns/${columnId}`),
}

// --- Records ---
export interface RecordInfo {
  id: string
  table_id: string
  data: Record<string, unknown>
  created_by: string | null
  created_at: string
  updated_at: string
  position: number
}

export interface RecordListResponse {
  records: RecordInfo[]
  total: number
}

export const recordsApi = {
  list: (tableId: string, limit = 100, offset = 0) =>
    api.get<ApiResponse<RecordListResponse>>(`/tables/${tableId}/records/?limit=${limit}&offset=${offset}`),
  get: (tableId: string, recordId: string) =>
    api.get<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`),
  create: (tableId: string, data: Record<string, unknown>) =>
    api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/`, { data }),
  update: (tableId: string, recordId: string, data: Record<string, unknown>) =>
    api.patch<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}`, { data }),
  delete: (tableId: string, recordId: string) =>
    api.delete<ApiResponse<null>>(`/tables/${tableId}/records/${recordId}`),
  move: (tableId: string, recordId: string, direction: 'up' | 'down') =>
    api.post<ApiResponse<RecordInfo>>(`/tables/${tableId}/records/${recordId}/move`, { direction }),
  filter: (tableId: string, filters?: Record<string, unknown>, sorts?: Array<{col_id: string; dir: string}>, limit = 100, offset = 0) =>
    api.post<ApiResponse<{records: RecordInfo[]; total: number}>>(`/tables/${tableId}/filter?limit=${limit}&offset=${offset}`, { filters, sorts }),
  exportCsv: (tableId: string) =>
    api.get(`/tables/${tableId}/export/csv`, { responseType: 'blob' }),
  exportXlsx: (tableId: string) =>
    api.get(`/tables/${tableId}/export/xlsx`, { responseType: 'blob' }),
}

// --- Knowledge Base ---
export interface KBPageInfo {
  id: string
  parent_id: string | null
  title: string
  slug: string
  content: string | null
  icon: string | null
  position: number
  is_published: boolean
  created_at: string
}

export const knowledgeApi = {
  list: () => api.get<ApiResponse<KBPageInfo[]>>('/knowledge/pages'),
  get: (id: string) => api.get<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`),
  create: (data: { title: string; content?: string; parent_id?: string; icon?: string }) =>
    api.post<ApiResponse<KBPageInfo>>('/knowledge/pages', data),
  update: (id: string, data: { title?: string; content?: string; parent_id?: string; icon?: string; position?: number; is_published?: boolean }) =>
    api.patch<ApiResponse<KBPageInfo>>(`/knowledge/pages/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/knowledge/pages/${id}`),
}

// --- Reports ---
export interface TableSummary {
  id: string
  name: string
  records_count: number
  columns_count: number
}

export interface OrgReport {
  tables_count: number
  records_count: number
  columns_count: number
  tables: TableSummary[]
}

export interface ColumnAggResult {
  column_id: string
  column_name: string
  field_type: string
  count: number
  non_empty: number
  sum: number | null
  avg: number | null
  min_val: string | null
  max_val: string | null
  top_values: Array<{ value: string; count: number }> | null
}

export interface TableAggResponse {
  table_id: string
  table_name: string
  total_records: number
  columns: ColumnAggResult[]
}

export interface TimeSeriesPoint {
  date: string
  count: number
}

export const reportsApi = {
  summary: () => api.get<ApiResponse<OrgReport>>('/reports/summary'),
  tableAnalytics: (table_id: string, column_ids: string[] = []) =>
    api.post<ApiResponse<TableAggResponse>>('/reports/table-analytics', { table_id, column_ids }),
  timeline: (days = 30) => api.get<ApiResponse<TimeSeriesPoint[]>>(`/reports/timeline?days=${days}`),
}

// --- Billing ---
export interface PlanInfo {
  id: string
  name: string
  display_name: string
  price_monthly: number
  price_yearly: number
  max_members: number
  max_tables: number
  max_records: number
  max_storage_mb: number
  has_ai: boolean
  features: Record<string, unknown> | null
}

export interface UsageInfo {
  members: number
  tables: number
  records: number
  files: number
  storage_bytes: number
}

export const billingApi = {
  plans: () => api.get<ApiResponse<PlanInfo[]>>('/billing/plans'),
  usage: () => api.get<ApiResponse<UsageInfo>>('/billing/usage'),
  subscription: () => api.get<ApiResponse<{plan: string; status: string; current_period_start: string | null; current_period_end: string | null; external_id?: string}>>('/billing/subscription'),
  createPayment: (plan_name: string, period: 'monthly' | 'yearly' = 'monthly') =>
    api.post<ApiResponse<{payment_id: string; status: string; confirmation_url: string; amount: number; plan: string}>>('/billing/create-payment', { plan_name, period }),
  cancelSubscription: () =>
    api.post<ApiResponse<{plan: string; status: string}>>('/billing/cancel-subscription', {}),
}

// --- AI ---
export interface AIChatResponse {
  reply: string
  model: string
  usage: Record<string, unknown> | null
}

export const aiApi = {
  chat: (message: string, history: Array<{role: string; content: string}> = [], system_prompt?: string, include_context = true) =>
    api.post<ApiResponse<AIChatResponse>>('/ai/chat', { message, history, system_prompt, include_context }),
  status: () => api.get<ApiResponse<{
    configured: boolean; model: string; base_url: string; system_prompt: string
    stats: { total_requests: number; total_tokens: number; prompt_tokens: number; completion_tokens: number }
  }>>('/ai/status'),
  usage: () => api.get<ApiResponse<Array<{user_id: string; requests: number; tokens: number}>>>('/ai/usage'),
}

// --- Schedule ---
export interface EventInfo {
  id: string
  title: string
  description: string | null
  start_at: string
  end_at: string | null
  all_day: boolean
  color: string | null
  is_done: boolean
  assigned_to: string | null
  created_at: string
}

// --- Access Control ---
export interface AccessRule {
  id: string
  resource_type: string
  resource_id: string | null
  role: string | null
  user_id: string | null
  can_read: boolean
  can_write: boolean
  can_delete: boolean
  created_at: string
}

export const accessApi = {
  list: (resource_type?: string, resource_id?: string) => {
    const params = new URLSearchParams()
    if (resource_type) params.set('resource_type', resource_type)
    if (resource_id) params.set('resource_id', resource_id)
    return api.get<ApiResponse<AccessRule[]>>(`/access/rules?${params}`)
  },
  create: (data: { resource_type: string; resource_id?: string; role?: string; user_id?: string; can_read?: boolean; can_write?: boolean; can_delete?: boolean }) =>
    api.post<ApiResponse<AccessRule>>('/access/rules', data),
  update: (id: string, data: { can_read?: boolean; can_write?: boolean; can_delete?: boolean }) =>
    api.patch<ApiResponse<AccessRule>>(`/access/rules/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/access/rules/${id}`),
}

export const scheduleApi = {
  list: (start?: string, end?: string) => {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    return api.get<ApiResponse<EventInfo[]>>(`/schedule/events?${params}`)
  },
  get: (id: string) => api.get<ApiResponse<EventInfo>>(`/schedule/events/${id}`),
  create: (data: { title: string; start_at: string; end_at?: string; description?: string; all_day?: boolean; color?: string; assigned_to?: string; recurrence?: string }) =>
    api.post<ApiResponse<EventInfo>>('/schedule/events', data),
  update: (id: string, data: { title?: string; start_at?: string; end_at?: string; description?: string; all_day?: boolean; color?: string; is_done?: boolean; recurrence?: string }) =>
    api.patch<ApiResponse<EventInfo>>(`/schedule/events/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<null>>(`/schedule/events/${id}`),
}
