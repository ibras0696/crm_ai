import api from '../core/client'
import type { ApiResponse } from '../core/types'

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
  ai_max_tokens_per_request?: number
  ai_tokens_per_day?: number
  ai_rpm_per_user?: number
  features: Record<string, unknown> | null
}

export interface UsageInfo {
  members: number
  tables: number
  records: number
  files: number
  storage_bytes: number
}

export interface TokenBalanceInfo {
  org_id: string
  cycle_key: string
  plan_tokens_monthly_quota: number
  plan_tokens_remaining: number
  addon_tokens_remaining: number
  total_tokens_remaining: number
}

export interface TokenPackageInfo {
  code: string
  display_name: string
  badge_text?: string | null
  description?: string | null
  button_text?: string | null
  payment_note?: string | null
  price_caption?: string | null
  tokens: number
  price_rub_cents: number
}

export interface TokenPurchaseResponse {
  purchase_applied: boolean
  requires_payment: boolean
  confirmation_url: string
  payment_id?: string | null
  status?: string
  amount?: number
  package_code: string
  package_display_name?: string
  package_tokens?: number
  tokens_added?: number
  expires_at?: string | null
  plan_tokens_remaining?: number
  addon_tokens_remaining?: number
  total_tokens_remaining?: number
}

export interface BillingPaymentStatusInfo {
  payment_id: string
  status: string
  paid: boolean
  amount_value?: string | null
  amount_currency?: string | null
  description?: string | null
  confirmation_url?: string | null
  created_at?: string | null
  metadata?: Record<string, string> | null
}

export const billingApi = {
  plans: () => api.get<ApiResponse<PlanInfo[]>>('/billing/plans'),
  usage: () => api.get<ApiResponse<UsageInfo>>('/billing/usage'),
  subscription: () => api.get<ApiResponse<{ plan: string; status: string; current_period_start: string | null; current_period_end: string | null; grace_period_end?: string | null; data_purge_at?: string | null; external_id?: string }>>('/billing/subscription'),
  paymentStatus: (payment_id: string) => api.get<ApiResponse<BillingPaymentStatusInfo>>(`/billing/payments/${payment_id}`),
  tokenBalance: () => api.get<ApiResponse<TokenBalanceInfo>>('/billing/tokens/balance'),
  tokenPackages: () => api.get<ApiResponse<TokenPackageInfo[]>>('/billing/tokens/packages'),
  purchaseTokens: (package_code: string) => api.post<ApiResponse<TokenPurchaseResponse>>('/billing/tokens/purchase', { package_code }),
  createPayment: (plan_name: string, period: 'monthly' = 'monthly') =>
    api.post<ApiResponse<{ payment_id: string; status: string; confirmation_url: string; amount: number; plan: string }>>('/billing/create-payment', { plan_name, period }),
  cancelSubscription: () => api.post<ApiResponse<{ plan: string; status: string }>>('/billing/cancel-subscription', {}),
}
