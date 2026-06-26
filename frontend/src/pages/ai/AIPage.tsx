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
import {
  ActionErrorPreview,
  DashboardPreview,
  DocumentPreview,
  KnowledgePreview,
  PendingActionPreview,
  SchedulePreview,
  TablePreview,
} from '@/components/ai/ActionPreviews'
import StatsTab from '@/components/ai/StatsTab'
import ChatHistory from '@/components/ai/ChatHistory'
import ContextHoverPickers from '@/components/ai/ContextHoverPickers'
import {
  PaperPlaneTilt,
  Robot,
  User,
  ArrowClockwise,
  Plus,
  ClockCounterClockwise,
  Sparkle,
  ChatDots,
  X,
  Translate,
} from '@phosphor-icons/react'
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

// Custom markdown components — no @tailwindcss/typography needed
const mdComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: (props) => <p className="my-1.5 leading-relaxed [overflow-wrap:anywhere]" {...props} />,
  h1: (props) => <h1 className="text-base font-semibold mt-3 mb-1.5 leading-snug" {...props} />,
  h2: (props) => <h2 className="text-sm font-semibold mt-3 mb-1 leading-snug" {...props} />,
  h3: (props) => <h3 className="text-sm font-medium mt-2 mb-1 leading-snug" {...props} />,
  ul: (props) => <ul className="my-1.5 ml-4 space-y-0.5 list-disc" {...props} />,
  ol: (props) => <ol className="my-1.5 ml-4 space-y-0.5 list-decimal" {...props} />,
  li: (props) => <li className="leading-relaxed" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic"
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-x-auto my-2 rounded-lg border border-border">
      <table className="min-w-full text-xs border-collapse" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-muted/60" {...props} />,
  th: (props) => (
    <th
      className="border-b border-border px-3 py-1.5 text-left font-semibold text-foreground"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border-b border-border/50 px-3 py-1.5 last:border-b-0" {...props} />
  ),
  tr: (props) => <tr className="even:bg-muted/20" {...props} />,
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { className?: string; children?: React.ReactNode }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) {
      return (
        <code
          className="block bg-muted rounded-xl p-3 text-[11px] font-mono overflow-x-auto whitespace-pre leading-relaxed [overflow-wrap:anywhere]"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        className="bg-muted/70 rounded px-1 py-0.5 text-[11px] font-mono [overflow-wrap:anywhere] break-all"
        {...props}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="my-2 [overflow-wrap:anywhere]">{children}</pre>,
  a: (props) => (
    <a
      className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-border/50" />,
}

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
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)

  const [contextSources, setContextSources] = useState<{
    kb_pages: AIContextSourcePage[]
    tables: AIContextSourceTable[]
  }>({ kb_pages: [], tables: [] })
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
  const languageMenuRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    loadChatMessages(currentChatId)
  }, [currentChatId, loadChatMessages])

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!languageMenuRef.current) return
      if (!languageMenuRef.current.contains(event.target as Node)) {
        setLanguageMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

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
        if ((d.action_result as Record<string, unknown> | null)?.ok) setUiIntent(null)
      } else {
        const err = (r.data as { error?: { message?: string } }).error
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Ошибка: ${err?.message || 'Неизвестная ошибка'}` },
        ])
      }
    } catch (e: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Ошибка соединения: ${e instanceof Error ? e.message : String(e)}`,
        },
      ])
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

  const statusLabel = loadingStatus
    ? 'Загрузка...'
    : statusError === 'auth'
      ? 'Требуется вход — обновите страницу'
      : statusError
        ? 'Нет доступа к AI API'
        : status?.enabled === false
          ? 'AI отключен администратором'
          : status?.configured
            ? 'AI агент подключен'
            : 'AI не настроен — задайте OPENAI_BEARER_TOKEN'

  const isDisabled = sending || statusError === 'auth' || status?.enabled === false || !status?.configured

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 z-10 flex flex-col overflow-hidden px-4 md:static md:inset-auto md:bottom-auto md:z-auto md:h-[calc(100dvh-8rem)] md:px-0">
      {/* Page header */}
      <div className="flex items-center gap-3 pt-4 pb-3 flex-wrap shrink-0 md:pt-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Robot className="h-5 w-5 text-primary" weight="fill" />
            AI Агент
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{statusLabel}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-secondary/30">
          {(['chat', 'stats'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-background shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'chat' ? 'Чат' : 'Статистика'}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            loadStatus()
            loadChats()
            loadContextSources()
          }}
          disabled={loadingStatus}
          className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <ArrowClockwise className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab === 'stats' && <StatsTab status={status} onRefresh={loadStatus} />}

      {tab === 'chat' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Chat card */}
          <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-border bg-card overflow-hidden">
            {/* Chat toolbar */}
            <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between shrink-0 bg-card/80 backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setHistoryMobileOpen(true)}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                  title="Открыть историю"
                >
                  <ClockCounterClockwise className="h-4 w-4" />
                </button>
                <ContextHoverPickers
                  includeContext={includeContext}
                  contextOptions={contextOptions}
                  setContextOptions={(updater) => setContextOptions(updater)}
                  contextSources={contextSources}
                  tableFolders={contextTableFolders}
                  tableFolderById={contextTableFolderById}
                />
                <div className="relative" ref={languageMenuRef}>
                  <button
                    type="button"
                    onClick={() => setLanguageMenuOpen((prev) => !prev)}
                    className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg border border-border bg-card hover:bg-secondary transition-colors text-sm"
                  >
                    <Translate className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline text-xs">
                      {language === 'ru' ? 'Русский' : language === 'ce' ? 'Нохчийн' : 'English'}
                    </span>
                  </button>
                  {languageMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-36 bg-popover border border-border shadow-lg rounded-xl overflow-hidden z-[60]">
                      {(['ru', 'ce', 'en'] as const).map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => {
                            setLanguage(lang)
                            setLanguageMenuOpen(false)
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition-colors ${language === lang ? 'font-medium bg-secondary/50' : ''}`}
                        >
                          {lang === 'ru' ? 'Русский' : lang === 'ce' ? 'Нохчийн' : 'English'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={handleNewChat}
                className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                title="Новый чат"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Message list */}
            {messages.length === 0 ? (
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-5 p-6 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.08),_transparent_60%)]">
                <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Robot className="h-7 w-7 text-primary" weight="fill" />
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold text-foreground">Начните диалог с AI</p>
                  <p className="text-xs text-muted-foreground mt-1">Задайте вопрос или выберите пример</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => void handleSend(ex)}
                      disabled={isDisabled}
                      className="text-left rounded-xl border border-border bg-secondary/20 px-3.5 py-3 text-sm hover:bg-secondary/50 hover:border-primary/30 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="inline-flex items-center gap-1 mb-1.5 text-xs text-primary font-medium">
                        <Sparkle className="h-3 w-3" weight="fill" />
                        Пример
                      </span>
                      <p className="text-foreground leading-snug">{ex}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message thread */
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-4 space-y-3 pb-2">
                  {messages.map((msg, i) => (
                    <div
                      key={getMessageKey(msg, i)}
                      className={`flex gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200 ${
                        msg.role === 'user' ? 'flex-row-reverse' : ''
                      }`}
                    >
                      {/* Avatar */}
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary border border-border'
                        }`}
                      >
                        {msg.role === 'user' ? (
                          <User className="h-3.5 w-3.5" weight="bold" />
                        ) : (
                          <Robot className="h-3.5 w-3.5 text-primary" weight="fill" />
                        )}
                      </div>

                      {/* Bubble */}
                      <div
                        className={`min-w-0 text-sm ${
                          msg.role === 'user'
                            ? 'max-w-[85%] sm:max-w-[78%]'
                            : 'max-w-[92%] sm:max-w-[86%]'
                        }`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-3 ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground rounded-tr-md'
                              : 'bg-secondary/60 border border-border/60 rounded-tl-md'
                          }`}
                        >
                          {msg.role === 'user' ? (
                            <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                              {msg.content}
                            </p>
                          ) : (
                            <div className="min-w-0 text-sm leading-relaxed text-foreground">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={mdComponents}
                              >
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>

                        {/* Token count */}
                        {msg.tokens != null && (
                          <p
                            className={`text-[10px] mt-1 px-1 ${
                              msg.role === 'user'
                                ? 'text-right text-muted-foreground'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {msg.tokensEstimated
                              ? `~${msg.tokens} токенов`
                              : `${msg.tokens} токенов`}
                          </p>
                        )}

                        {/* Action result cards */}
                        {msg.actionResult && (
                          <div className="mt-2 space-y-2">
                            <TablePreview result={msg.actionResult} />
                            <DashboardPreview result={msg.actionResult} />
                            <DocumentPreview result={msg.actionResult} />
                            <SchedulePreview result={msg.actionResult} />
                            <KnowledgePreview result={msg.actionResult} />
                            <PendingActionPreview
                              result={msg.actionResult}
                              disabled={
                                sending ||
                                i !== lastPendingIndex ||
                                pendingActionLocks[getMessageKey(msg, i)] === true
                              }
                              onConfirm={() => {
                                const key = getMessageKey(msg, i)
                                if (pendingActionLocks[key] || sending || i !== lastPendingIndex)
                                  return
                                setPendingActionLocks((prev) => ({ ...prev, [key]: true }))
                                void handleSend('подтверждаю')
                              }}
                              onCancel={() => {
                                const key = getMessageKey(msg, i)
                                if (pendingActionLocks[key] || sending || i !== lastPendingIndex)
                                  return
                                setPendingActionLocks((prev) => ({ ...prev, [key]: true }))
                                void handleSend('отмена')
                              }}
                            />
                            <ActionErrorPreview result={msg.actionResult} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {sending && (
                    <div className="flex gap-2.5 animate-in fade-in duration-200">
                      <div className="h-7 w-7 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                        <ChatDots className="h-3.5 w-3.5 text-primary" weight="fill" />
                      </div>
                      <div className="bg-secondary/60 border border-border/60 rounded-2xl rounded-tl-md px-4 py-3">
                        <div className="flex gap-1 items-center h-4">
                          {[0, 1, 2].map((dot) => (
                            <span
                              key={dot}
                              className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                              style={{ animationDelay: `${dot * 0.15}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </div>
            )}
          </div>

          {/* Input area — sticky above bottom nav */}
          <div className="shrink-0 pt-2 pb-[calc(env(safe-area-inset-bottom)+3.25rem)] md:pb-2">
            {/* Active intent chip */}
            {uiIntent && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                    Режим
                  </p>
                  <p className="text-sm font-medium truncate">
                    {uiIntent.type === 'create_table'
                      ? 'Создание таблицы'
                      : uiIntent.type === 'create_dashboard'
                        ? `Создание дашборда${(uiIntent.params as Record<string, unknown>)?.widget_type ? ` (${String((uiIntent.params as Record<string, unknown>).widget_type)})` : ''}`
                        : uiIntent.type === 'create_document'
                          ? `Создание документа${(uiIntent.params as Record<string, unknown>)?.file_type ? ` (${String((uiIntent.params as Record<string, unknown>).file_type).toUpperCase()})` : ''}`
                          : uiIntent.type === 'create_schedule_event'
                            ? 'Создание события в расписании'
                            : uiIntent.type === 'create_kb_page'
                              ? 'Создание страницы базы знаний'
                              : uiIntent.type}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {uiIntent.type === 'create_document'
                      ? 'Опишите документ для подготовки'
                      : 'Опишите, что нужно сделать'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={clearUiIntent}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors shrink-0"
                  title="Сбросить режим"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Input box */}
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 focus-within:border-primary/50 focus-within:shadow-sm transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={
                  isDisabled
                    ? statusError === 'auth'
                      ? 'Требуется вход'
                      : 'AI не настроен'
                    : 'Напишите сообщение...'
                }
                disabled={isDisabled}
                rows={1}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed max-h-32 disabled:opacity-50 placeholder:text-muted-foreground/60"
                style={{ minHeight: '28px' }}
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 128)}px`
                }}
              />
              <CapabilitiesMenu
                includeContext={includeContext}
                disabled={isDisabled}
                tables={contextSources.tables}
                selectedTableIds={contextOptions.selected_table_ids ?? []}
                onSelect={(intent) => {
                  setUiIntent(intent)
                  requestAnimationFrame(() => textareaRef.current?.focus())
                }}
              />
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || isDisabled}
                className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 active:scale-95 disabled:opacity-35 transition-all shrink-0"
              >
                <PaperPlaneTilt className="h-4 w-4" weight="fill" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5 hidden md:block">
              Enter — отправить · Shift+Enter — перенос строки
            </p>
          </div>
        </div>
      )}

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
    </div>
  )
}
