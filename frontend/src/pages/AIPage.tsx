import { useCallback, useEffect, useRef, useState } from 'react'
import {
  aiApi,
  type AIChatMessage,
  type AIChatSession,
  type AIContextOptions,
  type AIContextEstimate,
  type AIContextSourcePage,
  type AIContextSourceTable,
} from '@/lib/api'
import ContextControl from '@/components/ai/ContextControl'
import {
  Send,
  Bot,
  User,
  Zap,
  BarChart3,
  RefreshCw,
  Trash2,
  Plus,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  MessageSquareDashed,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, CartesianGrid } from 'recharts'

interface Message {
  id?: string
  role: 'user' | 'assistant'
  content: string
  tokens?: number
  actionResult?: Record<string, unknown> | null
}

interface AIStatus {
  configured: boolean
  stats: {
    total_requests: number
    total_tokens: number
    prompt_tokens: number
    completion_tokens: number
  }
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316']
const EXAMPLES = [
  'Покажи топ 10 клиентов по выручке за месяц',
  'Собери дашборд по продажам с графиком по статусам',
  'Найди узкие места в воронке и предложи действия',
  'Сделай сводку по задачам команды за неделю',
]

function getStoredBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  return raw === '1'
}

function DashboardPreview({ result }: { result: Record<string, unknown> }) {
  const dashboard = (result.dashboard || {}) as Record<string, unknown>
  const items = Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : []
  if (String(result.action || '') !== 'create_dashboard') return null

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Создан дашборд</p>
          <p className="text-sm font-semibold">{String(dashboard.name || 'AI дашборд')}</p>
        </div>
        <Link to="/reports" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
          Открыть в отчетах
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.map((item, idx) => {
          const title = String(item.title || `Виджет ${idx + 1}`)
          const widgetType = String(item.widget_type || '')
          const data = (item.data || {}) as Record<string, unknown>
          const type = String(data.type || widgetType)

          if (type === 'metric') {
            return (
              <div key={idx} className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">{title}</p>
                <p className="text-2xl font-bold mt-1">{String(data.value ?? '—')}</p>
              </div>
            )
          }

          if (type === 'table') {
            const header = Array.isArray(data.header) ? (data.header as string[]) : []
            const rows = Array.isArray(data.rows) ? (data.rows as string[][]) : []
            return (
              <div key={idx} className="rounded-lg border border-border overflow-hidden bg-card">
                <div className="px-3 py-2 border-b border-border text-sm font-medium">{title}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/30">
                      <tr>{header.map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 6).map((r, ridx) => (
                        <tr key={ridx} className="border-t border-border/40">
                          {r.map((c, cidx) => <td key={cidx} className="px-2 py-1">{c || '—'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          }

          const points = Array.isArray(data.points) ? (data.points as Array<{ x: string; y: number }>) : []
          return (
            <div key={idx} className="rounded-lg border border-border p-3 bg-card">
              <p className="text-sm font-medium mb-2">{title}</p>
              <ResponsiveContainer width="100%" height={220}>
                {type === 'line' ? (
                  <LineChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="y" stroke="#3b82f6" strokeWidth={2} />
                  </LineChart>
                ) : type === 'pie' ? (
                  <PieChart>
                    <Pie data={points} dataKey="y" nameKey="x" outerRadius={80} labelLine={false}>
                      {points.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                ) : (
                  <BarChart data={points}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="x" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="y" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [tab, setTab] = useState<'chat' | 'stats'>('chat')

  const [chats, setChats] = useState<AIChatSession[]>([])
  const [currentChatId, setCurrentChatId] = useState<string>('')
  const [loadingChats, setLoadingChats] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(() => getStoredBool('ai:historyCollapsed', false))
  const [historyMobileOpen, setHistoryMobileOpen] = useState(false)

  const [contextSources, setContextSources] = useState<{ kb_pages: AIContextSourcePage[]; tables: AIContextSourceTable[] }>({ kb_pages: [], tables: [] })
  const [includeContext, setIncludeContext] = useState(true)
  const [contextOptions, setContextOptions] = useState<AIContextOptions>({
    include_kb: true,
    include_table_schema: true,
    include_table_records: true,
    kb_limit: 30,
    tables_limit: 20,
    records_per_table: 5,
    selected_kb_page_ids: [],
    selected_table_ids: [],
  })
  const [contextEstimate, setContextEstimate] = useState<AIContextEstimate | null>(null)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const r = await aiApi.status()
      if (r.data.ok && r.data.data) setStatus(r.data.data as AIStatus)
    } catch {
      // ignore
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
      const r = await aiApi.contextSources()
      if (r.data.ok && r.data.data) setContextSources(r.data.data)
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
          actionResult: (m.meta?.action_result as Record<string, unknown> | undefined) || null,
        }))
        setMessages(rows)
      }
    } catch {
      // ignore
    }
  }, [])

  const loadContextEstimate = useCallback(async () => {
    try {
      const r = await aiApi.estimatePrompt({
        include_context: includeContext,
        context_options: contextOptions,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        user_message: input || '',
      })
      if (r.data.ok && r.data.data) setContextEstimate(r.data.data)
    } catch {
      // ignore
    }
  }, [includeContext, contextOptions, messages, input])

  useEffect(() => {
    loadStatus()
    loadChats()
    loadContextSources()
  }, [loadStatus, loadChats, loadContextSources])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => { loadChatMessages(currentChatId) }, [currentChatId, loadChatMessages])

  useEffect(() => {
    const t = setTimeout(() => loadContextEstimate(), 200)
    return () => clearTimeout(t)
  }, [loadContextEstimate])

  useEffect(() => {
    window.localStorage.setItem('ai:historyCollapsed', historyCollapsed ? '1' : '0')
  }, [historyCollapsed])

  const handleSend = async (preset?: string) => {
    const messageText = (preset ?? input).trim()
    if (!messageText || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: messageText }])
    setInput('')
    setSending(true)
    try {
      const r = await aiApi.chat({
        message: messageText,
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        include_context: includeContext,
        chat_id: currentChatId || undefined,
        context_options: contextOptions,
      })
      if (r.data.ok && r.data.data) {
        const d = r.data.data
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: d.reply,
            tokens: Number((d.usage as { total_tokens?: number } | null)?.total_tokens || 0) || undefined,
            actionResult: d.action_result || null,
          },
        ])
        if (d.chat_id && d.chat_id !== currentChatId) setCurrentChatId(d.chat_id)
        await loadChats()
        loadStatus()
        if (d.context_estimate) setContextEstimate(d.context_estimate)
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

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-0">
      <div className="flex items-center gap-3 pb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> AI Агент</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loadingStatus ? 'Загрузка...' : status?.configured ? 'AI агент подключен' : 'Не настроен — добавьте OPENAI_BEARER_TOKEN в .env'}
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
          onClick={() => { loadStatus(); loadChats(); loadContextEstimate(); loadContextSources() }}
          disabled={loadingStatus}
          className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab === 'stats' && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Запросов', value: status?.stats.total_requests ?? 0, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Токенов всего', value: status?.stats.total_tokens ?? 0, icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: 'Входящих', value: status?.stats.prompt_tokens ?? 0, icon: User, color: 'text-violet-500', bg: 'bg-violet-500/10' },
              { label: 'Исходящих', value: status?.stats.completion_tokens ?? 0, icon: Bot, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-xl ${card.bg} flex items-center justify-center shrink-0`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{(card.value as number).toLocaleString('ru')}</p>
                  <p className="text-xs text-muted-foreground">{card.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'chat' && (
        <>
          <div className="mb-3">
            <ContextControl
              includeContext={includeContext}
              setIncludeContext={setIncludeContext}
              contextOptions={contextOptions}
              setContextOptions={(updater) => setContextOptions(updater)}
              contextEstimate={contextEstimate}
              contextSources={contextSources}
            />
          </div>

          {/* Desktop layout: left history panel (collapsible) + chat */}
          <div className={`hidden lg:grid flex-1 min-h-0 gap-3 ${historyCollapsed ? 'lg:grid-cols-[56px_1fr]' : 'lg:grid-cols-[300px_1fr]'}`}>
            {historyCollapsed ? (
              <div className="rounded-xl border border-border bg-card p-2 flex flex-col items-center gap-2">
                <button
                  onClick={() => setHistoryCollapsed(false)}
                  className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                  title="Развернуть историю"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <button
                  onClick={handleNewChat}
                  className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                  title="Новый чат"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-card p-3 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <History className="h-4 w-4" />
                    <span>История</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleNewChat}
                      className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-secondary"
                      title="Новый чат"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setHistoryCollapsed(true)}
                      className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-secondary"
                      title="Свернуть историю"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1">
                  {loadingChats && <p className="text-xs text-muted-foreground px-2 py-1">Загрузка...</p>}
                  {chats.map((c) => (
                    <div key={c.id} className={`group rounded-lg ${currentChatId === c.id ? 'bg-primary text-white' : 'hover:bg-secondary'} transition-colors`}>
                      <button
                        onClick={() => setCurrentChatId(c.id)}
                        className="w-full text-left px-2 py-2 text-sm"
                      >
                        <p className="truncate font-medium">{c.title}</p>
                        <p className={`truncate text-xs ${currentChatId === c.id ? 'text-white/80' : 'text-muted-foreground'}`}>{c.last_message_preview || 'Пустой чат'}</p>
                      </button>
                      <div className={`px-2 pb-2 ${currentChatId === c.id ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                        <button
                          onClick={() => handleDeleteChat(c.id)}
                          className={`text-xs inline-flex items-center gap-1 ${currentChatId === c.id ? 'text-white/90 hover:text-white' : 'text-destructive hover:text-destructive/80'}`}
                        >
                          <Trash2 className="h-3 w-3" /> Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                  {chats.length === 0 && !loadingChats && <p className="text-xs text-muted-foreground px-2 py-1">Пока нет чатов</p>}
                </div>
              </div>
            )}

            <div className="flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card flex flex-col min-h-0">
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
                      <div key={`${msg.id || 'm'}-${i}`} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-secondary'}`}>
                          {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                        </div>
                        <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-primary text-white rounded-tr-sm' : 'bg-secondary rounded-tl-sm'}`}>
                          {msg.role === 'user' ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                          ) : (
                            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                            </div>
                          )}
                          {msg.tokens && <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`}>{msg.tokens} токенов</p>}
                          {msg.actionResult && <DashboardPreview result={msg.actionResult} />}
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
                <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder={status?.configured ? 'Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)' : 'AI не настроен'}
                    disabled={!status?.configured || sending}
                    rows={1}
                    className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed max-h-32 disabled:opacity-50"
                    style={{ minHeight: '24px' }}
                    onInput={(e) => {
                      const t = e.target as HTMLTextAreaElement
                      t.style.height = 'auto'
                      t.style.height = `${Math.min(t.scrollHeight, 128)}px`
                    }}
                  />
                  <button onClick={() => void handleSend()} disabled={!input.trim() || sending || !status?.configured} className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile layout: chat + history drawer */}
          <div className="lg:hidden flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card flex flex-col min-h-0">
              <div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
                <button
                  onClick={() => setHistoryMobileOpen(true)}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                  title="Открыть историю"
                >
                  <History className="h-4 w-4" />
                </button>
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
                    <div key={`${msg.id || 'm'}-${i}`} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-secondary'}`}>
                        {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </div>
                      <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-primary text-white rounded-tr-sm' : 'bg-secondary rounded-tl-sm'}`}>
                        {msg.role === 'user' ? (
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                        ) : (
                          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2 prose-code:before:content-none prose-code:after:content-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          </div>
                        )}
                        {msg.tokens && <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`}>{msg.tokens} токенов</p>}
                        {msg.actionResult && <DashboardPreview result={msg.actionResult} />}
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
              <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={status?.configured ? 'Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)' : 'AI не настроен'}
                  disabled={!status?.configured || sending}
                  rows={1}
                  className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed max-h-32 disabled:opacity-50"
                  style={{ minHeight: '24px' }}
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement
                    t.style.height = 'auto'
                    t.style.height = `${Math.min(t.scrollHeight, 128)}px`
                  }}
                />
                <button onClick={() => void handleSend()} disabled={!input.trim() || sending || !status?.configured} className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0">
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {historyMobileOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <button className="absolute inset-0 bg-black/50" onClick={() => setHistoryMobileOpen(false)} aria-label="Закрыть историю" />
              <div className="absolute left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-card border-r border-border p-3 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <History className="h-4 w-4" />
                    <span>История</span>
                  </div>
                  <button
                    onClick={() => setHistoryMobileOpen(false)}
                    className="h-7 w-7 rounded-md border border-border flex items-center justify-center hover:bg-secondary"
                    title="Закрыть"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1">
                  {loadingChats && <p className="text-xs text-muted-foreground px-2 py-1">Загрузка...</p>}
                  {chats.map((c) => (
                    <div key={c.id} className={`group rounded-lg ${currentChatId === c.id ? 'bg-primary text-white' : 'hover:bg-secondary'} transition-colors`}>
                      <button
                        onClick={() => { setCurrentChatId(c.id); setHistoryMobileOpen(false) }}
                        className="w-full text-left px-2 py-2 text-sm"
                      >
                        <p className="truncate font-medium">{c.title}</p>
                        <p className={`truncate text-xs ${currentChatId === c.id ? 'text-white/80' : 'text-muted-foreground'}`}>{c.last_message_preview || 'Пустой чат'}</p>
                      </button>
                      <div className={`px-2 pb-2 ${currentChatId === c.id ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                        <button
                          onClick={() => handleDeleteChat(c.id)}
                          className={`text-xs inline-flex items-center gap-1 ${currentChatId === c.id ? 'text-white/90 hover:text-white' : 'text-destructive hover:text-destructive/80'}`}
                        >
                          <Trash2 className="h-3 w-3" /> Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                  {chats.length === 0 && !loadingChats && <p className="text-xs text-muted-foreground px-2 py-1">Пока нет чатов</p>}
                </div>
                <div className="pt-2 border-t border-border mt-2">
                  <button
                    onClick={async () => { await handleNewChat(); setHistoryMobileOpen(false) }}
                    className="w-full h-9 rounded-lg border border-border text-sm hover:bg-secondary flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-4 w-4" /> Новый чат
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
