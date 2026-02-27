import { useEffect, useMemo, useState } from 'react'
import { Bot, KeyRound, Loader2, RefreshCw, Save, SlidersHorizontal, Sparkles } from 'lucide-react'

import { superadminApi } from '@/lib/api'
import { SuperadminEmptyState } from '../shared/EmptyState'

type AIUsage = { org_id: string; org_name: string; requests: number; tokens: number }
type RuntimeConfig = {
  model: string
  ai_base_url: string
  ai_provider_mode: 'openai_compatible' | 'timeweb_native'
  ai_bearer_token: string
  system_prompt: string
  temperature: number
  max_tokens_per_request: number
  strict_actions: boolean
}

const DEFAULT_RUNTIME: RuntimeConfig = {
  model: 'gpt-4.1',
  ai_base_url: '',
  ai_provider_mode: 'openai_compatible',
  ai_bearer_token: '',
  system_prompt: '',
  temperature: 0.3,
  max_tokens_per_request: 2000,
  strict_actions: true,
}

export function SuperadminAIView() {
  const [usage, setUsage] = useState<AIUsage[]>([])
  const [config, setConfig] = useState<any>(null)
  const [runtimeDraft, setRuntimeDraft] = useState<RuntimeConfig>(DEFAULT_RUNTIME)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [clearTokenRequested, setClearTokenRequested] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    setOkMsg('')
    try {
      const [u, c] = await Promise.all([superadminApi.aiUsage(), superadminApi.aiConfig()])
      if (u.data.ok && u.data.data) setUsage(u.data.data as AIUsage[])
      if (c.data.ok && c.data.data) {
        setConfig(c.data.data)
        setRuntimeDraft({
          model: String(c.data.data.runtime?.model || c.data.data.model || DEFAULT_RUNTIME.model),
          ai_base_url: String(c.data.data.runtime?.ai_base_url || DEFAULT_RUNTIME.ai_base_url),
          ai_provider_mode: (String(c.data.data.runtime?.ai_provider_mode || DEFAULT_RUNTIME.ai_provider_mode) as RuntimeConfig['ai_provider_mode']),
          ai_bearer_token: '',
          system_prompt: String(c.data.data.runtime?.system_prompt || DEFAULT_RUNTIME.system_prompt),
          temperature: Number(c.data.data.runtime?.temperature ?? DEFAULT_RUNTIME.temperature),
          max_tokens_per_request: Number(c.data.data.runtime?.max_tokens_per_request ?? DEFAULT_RUNTIME.max_tokens_per_request),
          strict_actions: Boolean(c.data.data.runtime?.strict_actions ?? DEFAULT_RUNTIME.strict_actions),
        })
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить AI данные')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totals = useMemo(() => {
    return usage.reduce(
      (acc, r) => {
        acc.requests += Number(r.requests || 0)
        acc.tokens += Number(r.tokens || 0)
        return acc
      },
      { requests: 0, tokens: 0 }
    )
  }, [usage])

  const saveRuntime = async () => {
    setSaving(true)
    setError('')
    setOkMsg('')
    try {
      const payload = {
        model: runtimeDraft.model.trim(),
        ai_base_url: runtimeDraft.ai_base_url.trim(),
        ai_provider_mode: runtimeDraft.ai_provider_mode,
        ...(clearTokenRequested ? { ai_bearer_token: '' } : {}),
        ...(runtimeDraft.ai_bearer_token.trim() ? { ai_bearer_token: runtimeDraft.ai_bearer_token.trim() } : {}),
        system_prompt: runtimeDraft.system_prompt.trim(),
        temperature: Number(runtimeDraft.temperature || 0),
        max_tokens_per_request: Number(runtimeDraft.max_tokens_per_request || 0),
        strict_actions: Boolean(runtimeDraft.strict_actions),
      }
      const r = await superadminApi.updateAiConfig(payload)
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось сохранить настройки AI')
      setOkMsg('Настройки AI сохранены')
      if (r.data.data) setConfig(r.data.data)
      if (r.data.data?.runtime) {
        setRuntimeDraft({
          model: String(r.data.data.runtime.model || payload.model),
          ai_base_url: String(r.data.data.runtime.ai_base_url || payload.ai_base_url || ''),
          ai_provider_mode: (String(r.data.data.runtime.ai_provider_mode || payload.ai_provider_mode) as RuntimeConfig['ai_provider_mode']),
          ai_bearer_token: '',
          system_prompt: String(r.data.data.runtime.system_prompt || payload.system_prompt),
          temperature: Number(r.data.data.runtime.temperature),
          max_tokens_per_request: Number(r.data.data.runtime.max_tokens_per_request),
          strict_actions: Boolean(r.data.data.runtime.strict_actions),
        })
        setClearTokenRequested(false)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось сохранить настройки AI')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-5">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">AI аналитика и контроль</h2>
              <p className="mt-1 text-sm text-muted-foreground">Мониторинг использования + управление характеристиками модели и системным промптом</p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            className="h-10 px-4 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm inline-flex items-center gap-2 shrink-0"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-14 text-muted-foreground rounded-xl border border-sidebar-border bg-sidebar-background/40">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка...
        </div>
      )}

      {!loading && error && <div className="px-4 py-3 text-sm rounded-xl border border-destructive/40 bg-destructive/10 text-destructive">{error}</div>}
      {!loading && okMsg && <div className="px-4 py-3 text-sm rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">{okMsg}</div>}

      {!loading && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Запросов</div>
              <div className="mt-1 text-3xl font-semibold leading-none">{totals.requests.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Токенов</div>
              <div className="mt-1 text-3xl font-semibold leading-none">{totals.tokens.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/50 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Ключ API</div>
              <div className="mt-2 inline-flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-primary" />
                <span className="font-medium">{config?.key_configured ? `Настроен (${config?.key_prefix || ''})` : 'Не настроен'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Контроль нейронки</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Модель</span>
                <input
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.model}
                  onChange={(e) => setRuntimeDraft((p) => ({ ...p, model: e.target.value }))}
                  placeholder="Например: gpt-4.1"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Режим провайдера</span>
                <select
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.ai_provider_mode}
                  onChange={(e) => setRuntimeDraft((p) => ({ ...p, ai_provider_mode: e.target.value as RuntimeConfig['ai_provider_mode'] }))}
                >
                  <option value="openai_compatible">openai_compatible</option>
                  <option value="timeweb_native">timeweb_native</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Температура (0..2)</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.temperature}
                  onChange={(e) => setRuntimeDraft((p) => ({ ...p, temperature: Number(e.target.value || 0) }))}
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Макс. токенов за ответ</span>
                <input
                  type="number"
                  min={64}
                  max={12000}
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.max_tokens_per_request}
                  onChange={(e) => setRuntimeDraft((p) => ({ ...p, max_tokens_per_request: Number(e.target.value || 64) }))}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">AI base URL</span>
                <input
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.ai_base_url}
                  onChange={(e) => setRuntimeDraft((p) => ({ ...p, ai_base_url: e.target.value }))}
                  placeholder="https://.../v1"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Bearer token (замена)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  className="h-10 w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 text-sm"
                  value={runtimeDraft.ai_bearer_token}
                  onChange={(e) => {
                    setClearTokenRequested(false)
                    setRuntimeDraft((p) => ({ ...p, ai_bearer_token: e.target.value }))
                  }}
                  placeholder={config?.runtime?.ai_bearer_token_masked ? `Текущий: ${config.runtime.ai_bearer_token_masked}` : 'Введите токен'}
                />
              </label>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-background/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Runtime token: {config?.runtime?.ai_bearer_token_configured ? (config?.runtime?.ai_bearer_token_masked || 'настроен') : 'не настроен'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRuntimeDraft((p) => ({ ...p, ai_bearer_token: '' }))
                  setClearTokenRequested(true)
                }}
                className="text-xs rounded-md border border-sidebar-border px-2 py-1 hover:bg-sidebar-accent"
              >
                Очистить runtime токен
              </button>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-xs text-muted-foreground">Системный промпт</span>
              <textarea
                rows={8}
                className="w-full rounded-xl border border-sidebar-border bg-sidebar-background px-3 py-2 text-sm"
                value={runtimeDraft.system_prompt}
                onChange={(e) => setRuntimeDraft((p) => ({ ...p, system_prompt: e.target.value }))}
                placeholder="Опиши правила поведения AI простым и четким языком"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={runtimeDraft.strict_actions}
                onChange={(e) => setRuntimeDraft((p) => ({ ...p, strict_actions: e.target.checked }))}
              />
              Строгий режим действий (AI выполняет только явно запрошенные действия)
            </label>

            <div className="flex items-center justify-end">
              <button
                onClick={() => void saveRuntime()}
                disabled={saving}
                className="h-10 px-4 rounded-xl border border-primary/40 bg-primary/10 text-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Сохранение...' : 'Сохранить настройки AI'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">По организациям</span>
            </div>
            {usage.length === 0 ? (
              <div className="p-4">
                <SuperadminEmptyState
                  icon={Bot}
                  title="Пока нет AI активности"
                  description="Как только появятся запросы, статистика отобразится здесь."
                />
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-sidebar-border bg-secondary/20">
                      <th className="px-4 py-3 text-left">Организация</th>
                      <th className="px-4 py-3 text-center">Запросов</th>
                      <th className="px-4 py-3 text-center">Токенов</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((r, i) => (
                      <tr key={r.org_id} className={`border-b border-sidebar-border/40 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.org_name}</div>
                          <div className="text-xs text-muted-foreground">{r.org_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3 text-center font-medium">{Number(r.requests || 0).toLocaleString('ru-RU')}</td>
                        <td className="px-4 py-3 text-center font-medium">{Number(r.tokens || 0).toLocaleString('ru-RU')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
