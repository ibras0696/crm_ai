import api from './client'
import type { ApiResponse } from './types'

export interface AIChatResponse {
  reply: string
  model: string
  usage: Record<string, unknown> | null
  chat_id?: string | null
  context_estimate?: AIContextEstimate | null
  action_result?: Record<string, unknown> | null
}

export interface AIContextOptions {
  include_kb?: boolean
  include_table_schema?: boolean
  include_table_records?: boolean
  kb_limit?: number
  tables_limit?: number
  records_per_table?: number
  selected_kb_page_ids?: string[]
  selected_table_ids?: string[]
}

export interface AIChatSession {
  id: string
  title: string
  created_at: string
  updated_at: string
  last_message_preview?: string | null
}

export interface AIChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  token_count?: number | null
  created_at: string
  meta?: Record<string, unknown> | null
}

export interface AIContextSourcePage {
  id: string
  title: string
}

export interface AIContextSourceTable {
  id: string
  name: string
  columns: Array<{ id: string; name: string }>
}

export interface AIContextEstimate {
  enabled: boolean
  estimated_total_tokens: number
  model_overhead_tokens?: number
  sources: {
    kb: { enabled: boolean; chars: number; estimated_tokens: number }
    table_schema: { enabled: boolean; chars: number; estimated_tokens: number }
    table_records: { enabled: boolean; chars: number; estimated_tokens: number }
  }
}

export const aiApi = {
  chat: (data: {
    message: string
    history?: Array<{ role: string; content: string }>
    system_prompt?: string
    include_context?: boolean
    chat_id?: string
    context_options?: AIContextOptions
  }) => api.post<ApiResponse<AIChatResponse>>('/ai/chat', data),
  status: () => api.get<ApiResponse<{ configured: boolean; stats: { total_requests: number; total_tokens: number; prompt_tokens: number; completion_tokens: number } }>>('/ai/status'),
  usage: () => api.get<ApiResponse<Array<{ user_id: string; requests: number; tokens: number }>>>('/ai/usage'),
  chats: () => api.get<ApiResponse<AIChatSession[]>>('/ai/chats'),
  createChat: (title?: string) => api.post<ApiResponse<AIChatSession>>('/ai/chats', { title }),
  deleteChat: (chatId: string) => api.delete<ApiResponse<null>>(`/ai/chats/${chatId}`),
  chatMessages: (chatId: string) => api.get<ApiResponse<AIChatMessage[]>>(`/ai/chats/${chatId}/messages`),
  estimateContext: (include_context: boolean, context_options?: AIContextOptions) =>
    api.post<ApiResponse<AIContextEstimate>>('/ai/context-estimate', { include_context, context_options }),
  contextSources: () => api.get<ApiResponse<{ kb_pages: AIContextSourcePage[]; tables: AIContextSourceTable[] }>>('/ai/context-sources'),
}
