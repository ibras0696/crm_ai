import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aiApi,
  tablesApi,
  type AIChatMessage,
  type AIChatSession,
  type AIContextOptions,
  type AIContextSourcePage,
  type AIContextSourceTable,
  type FolderInfo,
  type TableInfo,
} from '@/lib/api'
import CapabilitiesMenu from '@/components/ai/CapabilitiesMenu'
import { ActionErrorPreview, DashboardPreview, DocumentPreview, KnowledgePreview, PendingActionPreview, SchedulePreview, TablePreview } from '@/components/ai/ActionPreviews'
import StatsTab from '@/components/ai/StatsTab'
import ChatHistory from '@/components/ai/ChatHistory'
import ContextHoverPickers from '@/components/ai/ContextHoverPickers'
import {
  Send,
  Bot,
  User,
  RefreshCw,
  Plus,
  History,
  Sparkles,
  MessageSquareDashed,
  X,
  Languages,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isAxiosError } from 'axios'

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  tokens?: number
  tokensEstimated?: boolean
  actionResult?: Record<string, unknown> | null
}

interface AIStatus {
  enabled: boolean
  configured: boolean
  plan?: string
  stats: {
    total_requests: number
    total_tokens: number
    prompt_tokens: number
    completion_tokens: number
  }
  today?: {
    requests: number
    total_tokens: number
    prompt_tokens: number
    completion_tokens: number
  }
  limits?: {
    daily_tokens: number
    rpm_per_user: number
    max_tokens_per_request: number
  }
  token_wallet?: {
    cycle_key: string
    plan_tokens_monthly_quota: number
    plan_tokens_remaining: number
    addon_tokens_remaining: number
    total_tokens_remaining: number
  }
}

const EXAMPLES = [
  'Покажи топ 10 клиентов по выручке за месяц',
  'Собери дашборд по продажам с графиком по статусам',
  'Найди узкие места в воронке и предложи действия',
  'Сделай сводку по задачам команды за неделю',
]

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [statusError, setStatusError] = useState<'auth' | 'network' | 'unknown' | null>(null)
  const [tab, setTab] = useState<'chat' | 'stats'>('chat')

  const [chats, setChats] = useState<AIChatSession[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [historyMobileOpen, setHistoryMobileOpen] = useState(false)
  const [language, setLanguage] = useState<'ru' | 'ce' | 'en'>('ru')

  const [contextSources, setContextSources] = useState<{ kb_pages: AIContextSourcePage[]; tables: AIContextSourceTable[] }>({ kb_pages: [], tables: [] })
  const [contextTableFolders, setContextTableFolders] = useState<FolderInfo[]>([])
  const [contextTableFolderById, setContextTableFolderById] = useState<Record<string, string | null>>({})
  const [includeContext] = useState(true)
  const [contextOptions, setContextOptions] = useState<AIContextOptions>({
    include_kb: true,
    include_table_schema: true,
    include_table_records: true,
    table_records_mode: 'sample',
    kb_limit: 1000,
    tables_limit: 5000,
    records_per_table: 5,
    selected_kb_page_ids: [],
    selected_table_ids: [],
  })

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uiIntent, setUiIntent] = useState<{ type: string; params?: Record<string, unknown> } | null>(null)
  const [pendingActionLocks, setPendingActionLocks] = useState<Record<string, boolean>>({})
  const clearUiIntent = useCallback(() => setUiIntent(null), [])

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const r = await aiApi.status()
      if (r.data.ok && r.data.data) {
        setStatus(r.data.data as AIStatus)
      } else {
        setStatus(null)
        setStatusError('unknown')
      }
    } catch (e: unknown) {
      setStatus(null)
      if (isAxiosError(e) && e.response?.status === 401) setStatusError('auth')
      else setStatusError('network')
    }
    setLoadingStatus(false)
  }, [])

  const loadChats = useCallback(async () => {
    setLoadingChats(true)
    try {
      const r = await aiApi.chats()
      if (r.data.ok && r.data.data) {
        setChats(r.data.data)
        if (!currentChatId && r.data.data[0]) setCurrentChatId(r.data.data[0].id)
      }
    } catch {
      // ignore
    }
    setLoadingChats(false)
  }, [currentChatId])

  const loadContextSources = useCallback(async () => {
    try {
      const [ctxResp, foldersResp, tablesResp] = await Promise.all([
        aiApi.contextSources(),
        tablesApi.listFolders(),
        tablesApi.list(),
      ])
      if (ctxResp.data.ok && ctxResp.data.data) setContextSources(ctxResp.data.data)
      if (foldersResp.data.ok && foldersResp.data.data) setContextTableFolders(foldersResp.data.data)
      if (tablesResp.data.ok && tablesResp.data.data) {
        const map: Record<string, string | null> = {}
        for (const t of tablesResp.data.data as TableInfo[]) {
          map[t.id] = t.folder_id ?? null
        }
        setContextTableFolderById(map)
      }
    } catch {
      // ignore
    }
  }, [])

  const loadChatMessages = useCallback(async (chatId: string) => {
    if (!chatId) {
      setMessages([])
      return
    }
    try {
      const r = await aiApi.chatMessages(chatId)
      if (r.data.ok && r.data.data) {
        const rows = (r.data.data as AIChatMessage[]).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          tokens: m.token_count || undefined,
          tokensEstimated: Boolean((m.meta as Record<string, unknown> | null)?.usage_estimated),
          actionResult: (m.meta?.action_result as Record<string, unknown> | undefined) || null,
        }))
        setMessages(rows)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadChats()
    loadContextSources()
  }, [loadStatus, loadChats, loadContextSources])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { loadChatMessages(currentChatId) }, [currentChatId, loadChatMessages])

  const handleSend = async (preset?: string) => {
    const messageText = (preset ?? input).trim()
    if (!messageText || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: messageText }])
    setInput('')
    setSending(true)
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`
    try {
      const r = await aiApi.chat({
        message: messageText,
        include_context: includeContext,
        chat_id: currentChatId || undefined,
        request_id: requestId,
        context_options: contextOptions,
        ui_intent: uiIntent?.type,
        ui_intent_params: uiIntent?.params,
        language: language,
      })
      if (r.data.ok && r.data.data) {
        const d = r.data.data
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: d.reply,
            tokens: Number((d.usage as { total_tokens?: number } | null)?.total_tokens || 0) || undefined,
            tokensEstimated: Boolean((d.usage as { estimated?: boolean } | null)?.estimated),
            actionResult: d.action_result || null,
          },
        ])
        if (d.chat_id && d.chat_id !== currentChatId) setCurrentChatId(d.chat_id)
        await loadChats()
        loadStatus()
        // Сбрасываем режим, если AI реально выполнил действие (чтобы не было случайных повторов).
        if ((d.action_result as any)?.ok) setUiIntent(null)
      } else {
        const err = (r.data as { error?: { message?: string } }).error
        setMessages((prev) => [...prev, { role: 'assistant', content: `Ошибка: ${err?.message || 'Неизвестная ошибка'}` }])
      }
    } catch (e: unknown) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Ошибка соединения: ${e instanceof Error ? e.message : String(e)}` }])
    }
    setSending(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleNewChat = async () => {
    try {
      const r = await aiApi.createChat('Новый чат')
      if (r.data.ok && r.data.data) {
        setCurrentChatId(r.data.data.id)
        setMessages([])
        await loadChats()
      }
    } catch {
      // ignore
    }
  }

  const handleDeleteChat = async (chatId: string) => {
    try {
      await aiApi.deleteChat(chatId)
      if (chatId === currentChatId) {
        const rest = chats.filter((c) => c.id !== chatId)
        setCurrentChatId(rest[0]?.id || '')
        if (!rest[0]) setMessages([])
      }
      await loadChats()
    } catch {
      // ignore
    }
  }

  const getMessageKey = (msg: Message, index: number) => `${msg.id || 'm'}-${index}`
  const isPendingActionMessage = (msg: Message) => msg.actionResult?.needs_confirmation === true
  const lastPendingIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (msg && isPendingActionMessage(msg)) return i
    }
    return -1
  })()

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-0">
      <div className="flex items-center gap-3 pb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> AI Агент</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loadingStatus
              ? 'Загрузка...'
              : statusError === 'auth'
                ? 'Требуется вход. Обновите страницу или войдите заново.'
                : statusError
                  ? 'Не удалось получить статус AI. Проверьте доступ к API.'
                  : status?.enabled === false
                    ? 'AI отключен администратором.'
                    : status?.configured
                      ? 'AI агент подключен'
                      : 'AI не настроен на сервере: задайте OPENAI_BEARER_TOKEN (через secrets.yml или переменные окружения) и перезапустите backend.'}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-secondary/30">
          {(['chat', 'stats'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'chat' ? 'Чат' : 'Статистика'}
            </button>
          ))}
        </div>
        <button
          onClick={() => { loadStatus(); loadChats(); loadContextSources() }}
          disabled={loadingStatus}
          className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab === 'stats' && (
        <StatsTab status={status} onRefresh={loadStatus} />
      )}

      {tab === 'chat' && (
        <>
          {/* Chat layout: chat + history drawer */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHistoryMobileOpen(true)}
                    className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                    title="Открыть историю"
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <ContextHoverPickers
                    includeContext={includeContext}
                    contextOptions={contextOptions}
                    setContextOptions={(updater) => setContextOptions(updater)}
                    contextSources={contextSources}
                    tableFolders={contextTableFolders}
                    tableFolderById={contextTableFolderById}
                  />
                  <div className="relative group">
                    <button className="h-8 flex items-center gap-1.5 px-2 rounded-md border border-border bg-card hover:bg-secondary transition-colors text-sm">
                      <Languages className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {language === 'ru' ? 'Русский' : language === 'ce' ? 'Нохчийн' : 'English'}
                      </span>
                    </button>
                    <div className="absolute top-full left-0 mt-1 w-36 bg-popover border border-border shadow-lg rounded-md overflow-hidden z-[60] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                      <button onClick={() => setLanguage('ru')} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${language === 'ru' ? 'font-medium bg-secondary/50' : ''}`}>Русский</button>
                      <button onClick={() => setLanguage('ce')} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${language === 'ce' ? 'font-medium bg-secondary/50' : ''}`}>Нохчийн</button>
                      <button onClick={() => setLanguage('en')} className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary ${language === 'en' ? 'font-medium bg-secondary/50' : ''}`}>English</button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleNewChat}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                  title="Новый чат"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4 p-8 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%)]">
                  <Bot className="h-16 w-16 opacity-20" />
                  <p className="text-lg font-medium">Начните диалог с AI</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-2xl">
                    {EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => void handleSend(ex)}
                        className="text-left rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm hover:bg-secondary/40 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1.5 mb-1 text-xs text-primary"><Sparkles className="h-3 w-3" /> Пример</span>
                        <p>{ex}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {messages.map((msg, i) => (
                    <div key={getMessageKey(msg, i)} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-secondary'}`}>
                        {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div className={`ai-message min-w-0 max-w-[88%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-primary text-white rounded-tr-sm' : 'bg-secondary rounded-tl-sm'}`}>
                        {msg.role === 'user' ? (
                          <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{msg.content}</p>
                        ) : (
                          <div className="min-w-0 prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-p:[overflow-wrap:anywhere] prose-pre:my-2 prose-pre:whitespace-pre-wrap prose-pre:[overflow-wrap:anywhere] prose-code:before:content-none prose-code:after:content-none prose-code:whitespace-pre-wrap prose-code:[overflow-wrap:anywhere] prose-code:break-all">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                        {msg.tokens && (
                          <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`}>
                            {msg.tokensEstimated ? `≈ ${msg.tokens} токенов (оценка)` : `${msg.tokens} токенов`}
                          </p>
                        )}
                        {msg.actionResult && (
                          <>
                            <TablePreview result={msg.actionResult} />
                            <DashboardPreview result={msg.actionResult} />
                            <DocumentPreview result={msg.actionResult} />
                            <SchedulePreview result={msg.actionResult} />
                            <KnowledgePreview result={msg.actionResult} />
                            <PendingActionPreview
                              result={msg.actionResult}
                              disabled={
                                sending
                                || i !== lastPendingIndex
                                || pendingActionLocks[getMessageKey(msg, i)] === true
                              }
                              onConfirm={() => {
                                const key = getMessageKey(msg, i)
                                if (pendingActionLocks[key] || sending || i !== lastPendingIndex) return
                                setPendingActionLocks((prev) => ({ ...prev, [key]: true }))
                                void handleSend('подтверждаю')
                              }}
                              onCancel={() => {
                                const key = getMessageKey(msg, i)
                                if (pendingActionLocks[key] || sending || i !== lastPendingIndex) return
                                setPendingActionLocks((prev) => ({ ...prev, [key]: true }))
                                void handleSend('отмена')
                              }}
                            />
                            <ActionErrorPreview result={msg.actionResult} />
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {sending && (
                    <div className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0"><MessageSquareDashed className="h-4 w-4" /></div>
                      <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3">
                        <div className="flex gap-1 items-center h-5">
                          {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="pt-3 flex gap-2 items-end">
              <div className="flex-1">
                {uiIntent && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Выбран режим</p>
                      <p className="text-sm font-medium truncate">
                        {uiIntent.type === 'create_table'
                          ? 'Создание таблицы'
                          : uiIntent.type === 'create_dashboard'
                            ? `Создание дашборда${(uiIntent.params as any)?.widget_type ? ` (${String((uiIntent.params as any).widget_type)})` : ''}`
                            : uiIntent.type === 'create_document'
                              ? `Создание документа${(uiIntent.params as any)?.file_type ? ` (${String((uiIntent.params as any).file_type).toUpperCase()})` : ''}`
                            : uiIntent.type === 'create_schedule_event'
                              ? 'Создание события в расписании'
                              : uiIntent.type === 'create_kb_page'
                                ? 'Создание страницы базы знаний'
                                : uiIntent.type}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {uiIntent.type === 'create_document'
                          ? 'Опишите документ, который нужно подготовить (например: "сделай коммерческое предложение для клиента").'
                          : 'Опишите, что нужно сделать (например: "придумай 10 тестовых товаров").'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={clearUiIntent}
                      className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-secondary shrink-0"
                      title="Сбросить режим"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder={status?.configured ? 'Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)' : statusError === 'auth' ? 'Требуется вход' : 'AI не настроен'}
                    disabled={sending || statusError === 'auth' || status?.enabled === false || !status?.configured}
                    rows={1}
                    className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed max-h-32 disabled:opacity-50"
                    style={{ minHeight: '24px' }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement
                      t.style.height = 'auto'
                      t.style.height = `${Math.min(t.scrollHeight, 128)}px`
                    }}
                  />
                  <CapabilitiesMenu
                    includeContext={includeContext}
                    disabled={sending || statusError === 'auth' || status?.enabled === false || !status?.configured}
                    tables={contextSources.tables}
                    selectedTableIds={contextOptions.selected_table_ids ?? []}
                    onSelect={(intent) => { setUiIntent(intent); requestAnimationFrame(() => textareaRef.current?.focus()) }}
                  />
                  <button
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || sending || statusError === 'auth' || status?.enabled === false || !status?.configured}
                    className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {historyMobileOpen && (
            <ChatHistory
              chats={chats}
              currentChatId={currentChatId}
              loadingChats={loadingChats}
              onSelect={(chatId) => setCurrentChatId(chatId)}
              onDelete={handleDeleteChat}
              onNewChat={handleNewChat}
              onClose={() => setHistoryMobileOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
