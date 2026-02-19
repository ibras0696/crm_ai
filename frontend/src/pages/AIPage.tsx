import { useState, useEffect, useRef, useCallback } from 'react'
import { aiApi } from '@/lib/api'
import { Send, Bot, User, Settings, Zap, BarChart3, RefreshCw, Trash2, Database } from 'lucide-react'

interface Message { role: 'user' | 'assistant'; content: string; tokens?: number }
interface AIStatus {
  configured: boolean; model: string; base_url: string; system_prompt: string
  stats: { total_requests: number; total_tokens: number; prompt_tokens: number; completion_tokens: number }
}

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tab, setTab] = useState<'chat' | 'stats'>('chat')
  const [includeContext, setIncludeContext] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const r = await aiApi.status()
      if (r.data.ok && r.data.data) {
        const s = r.data.data as AIStatus
        setStatus(s)
        setSystemPrompt(s.system_prompt || '')
      }
    } catch { /* ignore */ }
    setLoadingStatus(false)
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = async () => {
    if (!input.trim() || sending) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    try {
      const r = await aiApi.chat(input.trim(), messages.slice(-10), systemPrompt || undefined, includeContext)
      if (r.data.ok && r.data.data) {
        const d = r.data.data as { reply: string; model: string; usage?: { total_tokens?: number } }
        setMessages(prev => [...prev, { role: 'assistant', content: d.reply, tokens: d.usage?.total_tokens }])
        loadStatus()
      } else {
        const err = (r.data as { error?: { message?: string } }).error
        setMessages(prev => [...prev, { role: 'assistant', content: `Ошибка: ${err?.message || 'Неизвестная ошибка'}` }])
      }
    } catch (e: unknown) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Ошибка соединения: ${e instanceof Error ? e.message : String(e)}` }])
    }
    setSending(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /> AI Агент</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loadingStatus ? 'Загрузка...' : status?.configured ? 'AI агент подключён' : 'Не настроен — добавьте OPENAI_API_KEY в .env'}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-secondary/30">
          {(['chat', 'stats'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {t === 'chat' ? 'Чат' : 'Статистика'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowSettings(s => !s)} className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-colors ${showSettings ? 'bg-primary text-white border-primary' : 'border-border hover:bg-secondary'}`}>
          <Settings className="h-4 w-4" />
        </button>
        <button onClick={loadStatus} disabled={loadingStatus} className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loadingStatus ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Not configured banner */}
      {!loadingStatus && !status?.configured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 mb-4 flex gap-3">
          <Zap className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-semibold text-amber-600 dark:text-amber-400">AI не настроен — требуется API ключ xAI</p>
            <p className="text-muted-foreground">Получите ключ на <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="underline text-primary">console.x.ai</a>, затем добавьте в <code className="bg-secondary px-1 rounded text-xs">backend/.env</code>:</p>
            <pre className="bg-secondary/60 rounded-lg px-3 py-2 text-xs mt-2 select-all">OPENAI_API_KEY=xai-ваш_реальный_ключ_здесь</pre>
            <p className="text-muted-foreground text-xs">После этого перезапустите контейнеры: <code className="bg-secondary px-1 rounded">docker compose down && docker compose up -d --build</code></p>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="rounded-xl border border-border bg-card p-4 mb-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-2"><Settings className="h-4 w-4" /> Настройки AI</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Модель</label>
              <div className="h-9 px-3 rounded-lg border border-border bg-secondary/30 flex items-center text-sm">AI агент</div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">API Endpoint</label>
              <div className="h-9 px-3 rounded-lg border border-border bg-secondary/30 flex items-center text-sm truncate">Настроен администратором</div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Системный промпт (для текущего сеанса)</label>
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary resize-none"
              placeholder="Ты — AI-ассистент CRM платформы..." />
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex-1 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${status?.configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
              <Zap className="h-4 w-4" />
              {status?.configured ? 'API ключ настроен' : 'API ключ не настроен. Добавьте OPENAI_API_KEY в backend/.env'}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/50">
              <input type="checkbox" checked={includeContext} onChange={e => setIncludeContext(e.target.checked)} className="rounded" />
              <Database className="h-3.5 w-3.5" />
              Контекст организации
            </label>
          </div>
        </div>
      )}

      {/* Stats tab */}
      {tab === 'stats' && (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Запросов', value: status?.stats.total_requests ?? 0, icon: BarChart3, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Токенов всего', value: status?.stats.total_tokens ?? 0, icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10' },
              { label: 'Входящих', value: status?.stats.prompt_tokens ?? 0, icon: User, color: 'text-violet-500', bg: 'bg-violet-500/10' },
              { label: 'Исходящих', value: status?.stats.completion_tokens ?? 0, icon: Bot, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            ].map(card => (
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
          {status && status.stats.total_requests > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-semibold text-sm mb-3">Среднее на запрос</h3>
              <div className="space-y-2">
                {[
                  { label: 'Входящих токенов', value: Math.round(status.stats.prompt_tokens / status.stats.total_requests) },
                  { label: 'Исходящих токенов', value: Math.round(status.stats.completion_tokens / status.stats.total_requests) },
                  { label: 'Всего токенов', value: Math.round(status.stats.total_tokens / status.stats.total_requests) },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground flex-1">{row.label}</span>
                    <div className="flex-1 bg-secondary/50 rounded-full h-2 overflow-hidden">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (row.value / 2000) * 100)}%` }} />
                    </div>
                    <span className="text-sm font-medium w-12 text-right">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(!status || status.stats.total_requests === 0) && (
            <div className="text-center py-16 text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Нет данных. Начните чат с AI.</p>
            </div>
          )}
        </div>
      )}

      {/* Chat tab */}
      {tab === 'chat' && (
        <>
          <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card flex flex-col">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 p-8">
                <Bot className="h-16 w-16 opacity-20" />
                <p className="text-lg font-medium">Начните диалог с AI</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md mt-2">
                  {['Помоги проанализировать данные таблицы', 'Как улучшить воронку продаж?', 'Составь отчёт по клиентам', 'Что такое CRM?'].map(q => (
                    <button key={q} onClick={() => { setInput(q); textareaRef.current?.focus() }}
                      className="text-left text-sm px-3 py-2.5 rounded-lg border border-border hover:bg-secondary/50 hover:border-primary/30 transition-colors">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-secondary'}`}>
                      {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${msg.role === 'user' ? 'bg-primary text-white rounded-tr-sm' : 'bg-secondary rounded-tl-sm'}`}>
                      <pre className="whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
                      {msg.tokens && <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`}>{msg.tokens} токенов</p>}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0"><Bot className="h-4 w-4" /></div>
                    <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-5">
                        {[0, 1, 2].map(i => <span key={i} className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="pt-3 flex gap-2 items-end">
            {messages.length > 0 && (
              <button onClick={() => setMessages([])} className="h-10 w-10 rounded-xl border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors shrink-0" title="Очистить чат">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <div className="flex-1 flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
                placeholder={status?.configured ? 'Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)' : 'AI не настроен'}
                disabled={!status?.configured || sending}
                rows={1}
                className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed max-h-32 disabled:opacity-50"
                style={{ minHeight: '24px' }}
                onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 128) + 'px' }}
              />
              <button onClick={handleSend} disabled={!input.trim() || sending || !status?.configured}
                className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
