import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'

import {
  superadminApi,
  type SuperadminBillingConfig,
  type SuperadminBillingPlanItem,
  type SuperadminTokenPackageItem,
} from '@/lib/api'
import { SaAiIcon, SaBillingIcon, SaUsersIcon } from '@/components/icons/modules/SuperadminModuleIcons'

const EMPTY: SuperadminBillingConfig = {
  plans: [],
  token_packages: [],
  recent_purchases: [],
  yookassa: {
    shop_id: '',
    return_url: '',
    webhook_url: '',
    secret_key_configured: false,
    secret_key_masked: '',
    audit: [],
  },
}

type YooKassaDraft = {
  shop_id: string
  secret_key: string
  return_url: string
  webhook_url: string
}

type NewPackageDraft = {
  code: string
  display_name: string
  tokens: number
  price_rub_cents: number
  sort_order: number
}

function rubFromCents(v: number) {
  return (Number(v || 0) / 100).toLocaleString('ru-RU')
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground/80">{hint}</span> : null}
      </div>
      {children}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  type = 'text',
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  type?: string
}) {
  return (
    <input
      className="h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-sm transition-colors outline-none focus:border-primary/60"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      type={type}
      autoComplete={type === 'password' ? 'new-password' : undefined}
    />
  )
}

function NumberInput({
  value,
  min = 0,
  onChange,
}: {
  value: number
  min?: number
  onChange: (value: number) => void
}) {
  return (
    <input
      className="h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-sm transition-colors outline-none focus:border-primary/60"
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Number(e.target.value || 0))}
    />
  )
}

function toLocalDateTime(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleString('ru-RU')
}

function statusLabel(v: string): string {
  if (v === 'active') return 'Активна'
  if (v === 'exhausted') return 'Израсходована'
  if (v === 'expired') return 'Истекла'
  if (v === 'inactive') return 'Деактивирована'
  return v
}

export function SuperadminBillingView() {
  const [data, setData] = useState<SuperadminBillingConfig>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [savingPlan, setSavingPlan] = useState<string | null>(null)
  const [savingPackage, setSavingPackage] = useState<string | null>(null)
  const [deletingPackage, setDeletingPackage] = useState<string | null>(null)
  const [savingYooKassa, setSavingYooKassa] = useState(false)
  const [testingYooKassa, setTestingYooKassa] = useState(false)
  const [clearYooSecretRequested, setClearYooSecretRequested] = useState(false)

  const [planDrafts, setPlanDrafts] = useState<Record<string, SuperadminBillingPlanItem>>({})
  const [packageDrafts, setPackageDrafts] = useState<Record<string, SuperadminTokenPackageItem>>({})
  const [yookassaDraft, setYookassaDraft] = useState<YooKassaDraft>({
    shop_id: '',
    secret_key: '',
    return_url: '',
    webhook_url: '',
  })
  const [newPackageDraft, setNewPackageDraft] = useState<NewPackageDraft>({
    code: '',
    display_name: '',
    tokens: 50000,
    price_rub_cents: 99000,
    sort_order: 100,
  })

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await superadminApi.billingConfig()
      if (r.data.ok && r.data.data) {
        setData(r.data.data)
        setPlanDrafts(
          Object.fromEntries(r.data.data.plans.map((p) => [p.name, { ...p }])),
        )
        setPackageDrafts(
          Object.fromEntries(r.data.data.token_packages.map((p) => [p.code, { ...p }])),
        )
        setYookassaDraft({
          shop_id: String(r.data.data.yookassa?.shop_id || ''),
          secret_key: '',
          return_url: String(r.data.data.yookassa?.return_url || ''),
          webhook_url: String(r.data.data.yookassa?.webhook_url || ''),
        })
        setClearYooSecretRequested(false)
      } else {
        setError(r.data.error?.message || 'Не удалось загрузить конфигурацию')
      }
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось загрузить конфигурацию')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const plans = useMemo(() => data.plans, [data.plans])
  const packages = useMemo(() => data.token_packages, [data.token_packages])
  const purchases = useMemo(() => data.recent_purchases || [], [data.recent_purchases])

  const updatePlanDraft = (name: string, patch: Partial<SuperadminBillingPlanItem>) => {
    setPlanDrafts((prev) => {
      const existing = prev[name]
      if (!existing) return prev
      return { ...prev, [name]: { ...existing, ...patch } }
    })
  }

  const savePlan = async (name: string) => {
    const draft = planDrafts[name]
    if (!draft) return
    setSavingPlan(name)
    setError('')
    setOkMsg('')
    try {
      const r = await superadminApi.updateBillingPlan(name, {
        display_name: draft.display_name,
        price_monthly: Number(draft.price_monthly),
        price_yearly: Number(draft.price_yearly),
        max_members: Number(draft.max_members),
        max_tables: Number(draft.max_tables),
        max_records: Number(draft.max_records),
        max_storage_mb: Number(draft.max_storage_mb),
        has_ai: Boolean(draft.has_ai),
        ai_max_tokens_per_request: Number(draft.ai_max_tokens_per_request),
        ai_tokens_per_day: Number(draft.ai_tokens_per_day),
        ai_rpm_per_user: Number(draft.ai_rpm_per_user),
        is_active: Boolean(draft.is_active),
      })
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось сохранить тариф')
      setOkMsg(`Тариф "${name}" обновлен`)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось сохранить тариф')
    }
    setSavingPlan(null)
  }

  const updatePackageDraft = (code: string, patch: Partial<SuperadminTokenPackageItem>) => {
    setPackageDrafts((prev) => {
      const existing = prev[code]
      if (!existing) return prev
      return { ...prev, [code]: { ...existing, ...patch } }
    })
  }

  const savePackage = async (code: string) => {
    const draft = packageDrafts[code]
    if (!draft) return
    setSavingPackage(code)
    setError('')
    setOkMsg('')
    try {
      const r = await superadminApi.upsertTokenPackage(code, {
        display_name: draft.display_name,
        tokens: Number(draft.tokens),
        price_rub_cents: Number(draft.price_rub_cents),
        is_active: Boolean(draft.is_active),
        sort_order: Number(draft.sort_order),
      })
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось сохранить пакет')
      setOkMsg(`Пакет "${code}" сохранен`)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось сохранить пакет')
    }
    setSavingPackage(null)
  }

  const deletePackage = async (code: string) => {
    setDeletingPackage(code)
    setError('')
    setOkMsg('')
    try {
      const r = await superadminApi.deleteTokenPackage(code)
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось деактивировать пакет')
      setOkMsg(`Пакет "${code}" деактивирован`)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось деактивировать пакет')
    }
    setDeletingPackage(null)
  }

  const createPackage = async () => {
    const code = newPackageDraft.code.trim()
    if (!code) {
      setError('Укажите код нового пакета')
      return
    }
    setSavingPackage(code)
    setError('')
    setOkMsg('')
    try {
      const r = await superadminApi.upsertTokenPackage(code, {
        display_name: newPackageDraft.display_name.trim() || code,
        tokens: Number(newPackageDraft.tokens || 0),
        price_rub_cents: Number(newPackageDraft.price_rub_cents || 0),
        is_active: true,
        sort_order: Number(newPackageDraft.sort_order || 0),
      })
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось создать пакет')
      setOkMsg(`Пакет "${code}" создан`)
      setNewPackageDraft({
        code: '',
        display_name: '',
        tokens: 50000,
        price_rub_cents: 99000,
        sort_order: 100,
      })
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось создать пакет')
    }
    setSavingPackage(null)
  }

  const saveYooKassa = async () => {
    setSavingYooKassa(true)
    setError('')
    setOkMsg('')
    try {
      const payload: Record<string, string> = {
        yookassa_shop_id: yookassaDraft.shop_id.trim(),
        yookassa_return_url: yookassaDraft.return_url.trim(),
        yookassa_webhook_url: yookassaDraft.webhook_url.trim(),
      }
      if (clearYooSecretRequested) payload.yookassa_secret_key = ''
      if (yookassaDraft.secret_key.trim()) payload.yookassa_secret_key = yookassaDraft.secret_key.trim()
      const r = await superadminApi.updateYooKassaConfig(payload)
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось сохранить YooKassa настройки')
      setOkMsg('YooKassa настройки сохранены')
      setYookassaDraft((prev) => ({ ...prev, secret_key: '' }))
      setClearYooSecretRequested(false)
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось сохранить YooKassa настройки')
    }
    setSavingYooKassa(false)
  }

  const testYooKassa = async () => {
    setTestingYooKassa(true)
    setError('')
    setOkMsg('')
    try {
      const r = await superadminApi.testYooKassaConfig()
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Тест YooKassa завершился с ошибкой')
      const d = r.data.data
      setOkMsg(`YooKassa подключена (HTTP ${d?.status_code || 200})`)
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось проверить подключение YooKassa')
    }
    setTestingYooKassa(false)
  }

  if (loading) return <div className="rounded-xl border border-border p-5">Загрузка...</div>

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {okMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
          {okMsg}
        </div>
      )}

      <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 w-full">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
                <SaBillingIcon className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold leading-none">Тарифы</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Настройка стоимости и лимитов. Каждый тариф разделен по подмодулям.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-5">
          {plans.map((plan) => {
            const d = planDrafts[plan.name] || plan
            return (
              <article
                key={plan.name}
                className="rounded-2xl border border-sidebar-border bg-sidebar-background/40 p-4 lg:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 items-center rounded-full border border-primary/30 bg-primary/10 px-3 text-xs font-semibold uppercase tracking-wide text-primary">
                      {plan.name}
                    </span>
                    <span className="text-sm text-muted-foreground">{d.display_name}</span>
                  </div>
                  <button
                    onClick={() => void savePlan(plan.name)}
                    disabled={savingPlan !== null}
                    className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
                  >
                    {savingPlan === plan.name ? 'Сохранение...' : 'Сохранить тариф'}
                  </button>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="rounded-xl border border-sidebar-border bg-card/60 p-3 space-y-3">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                      <SaBillingIcon className="h-4 w-4 text-primary" />
                      Основное
                    </h3>
                    <Field label="Название тарифа (для UI)">
                      <TextInput
                        value={d.display_name}
                        onChange={(value) => updatePlanDraft(plan.name, { display_name: value })}
                        placeholder="Название"
                      />
                    </Field>
                    <Field label="Цена в месяц" hint="в копейках">
                      <NumberInput
                        value={d.price_monthly}
                        onChange={(value) => updatePlanDraft(plan.name, { price_monthly: value })}
                      />
                    </Field>
                    <Field label="Цена в год" hint="в копейках">
                      <NumberInput
                        value={d.price_yearly}
                        onChange={(value) => updatePlanDraft(plan.name, { price_yearly: value })}
                      />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-sidebar-border bg-card/60 p-3 space-y-3">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                      <SaUsersIcon className="h-4 w-4 text-primary" />
                      Лимиты команды
                    </h3>
                    <Field label="Участники">
                      <NumberInput
                        value={d.max_members}
                        onChange={(value) => updatePlanDraft(plan.name, { max_members: value })}
                      />
                    </Field>
                    <Field label="Таблицы">
                      <NumberInput
                        value={d.max_tables}
                        onChange={(value) => updatePlanDraft(plan.name, { max_tables: value })}
                      />
                    </Field>
                    <Field label="Записи">
                      <NumberInput
                        value={d.max_records}
                        onChange={(value) => updatePlanDraft(plan.name, { max_records: value })}
                      />
                    </Field>
                    <Field label="Хранилище" hint="МБ">
                      <NumberInput
                        value={d.max_storage_mb}
                        onChange={(value) => updatePlanDraft(plan.name, { max_storage_mb: value })}
                      />
                    </Field>
                  </div>

                  <div className="rounded-xl border border-sidebar-border bg-card/60 p-3 space-y-3">
                    <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                      <SaAiIcon className="h-4 w-4 text-primary" />
                      AI лимиты
                    </h3>
                    <Field label="Токенов в день">
                      <NumberInput
                        value={d.ai_tokens_per_day}
                        onChange={(value) => updatePlanDraft(plan.name, { ai_tokens_per_day: value })}
                      />
                    </Field>
                    <Field label="Токенов за запрос">
                      <NumberInput
                        value={d.ai_max_tokens_per_request}
                        onChange={(value) => updatePlanDraft(plan.name, { ai_max_tokens_per_request: value })}
                      />
                    </Field>
                    <Field label="Запросов в минуту на пользователя">
                      <NumberInput
                        value={d.ai_rpm_per_user}
                        onChange={(value) => updatePlanDraft(plan.name, { ai_rpm_per_user: value })}
                      />
                    </Field>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-sidebar-border bg-card/40 p-3">
                  <div>
                    <div className="text-[11px] text-muted-foreground">Текущая цена / месяц</div>
                    <div className="text-sm font-semibold">{rubFromCents(d.price_monthly)} ₽</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Текущая цена / год</div>
                    <div className="text-sm font-semibold">{rubFromCents(d.price_yearly)} ₽</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">AI в тарифе</div>
                    <div className="text-sm font-semibold">{d.has_ai ? 'Включен' : 'Выключен'}</div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 shadow-sm">
        <div className="mb-4 rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">Пакеты токенов</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Настройка отдельных пакетов покупки токенов AI.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <article className="rounded-xl border border-sidebar-border bg-sidebar-background/30 p-4 space-y-3">
            <div className="text-sm font-semibold">Создать новый пакет</div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
              <Field label="Код пакета">
                <TextInput
                  value={newPackageDraft.code}
                  onChange={(value) => setNewPackageDraft((prev) => ({ ...prev, code: value }))}
                  placeholder="например: pack_200k"
                />
              </Field>
              <Field label="Название">
                <TextInput
                  value={newPackageDraft.display_name}
                  onChange={(value) => setNewPackageDraft((prev) => ({ ...prev, display_name: value }))}
                  placeholder="Пакет 200k"
                />
              </Field>
              <Field label="Токенов">
                <NumberInput
                  min={1}
                  value={newPackageDraft.tokens}
                  onChange={(value) => setNewPackageDraft((prev) => ({ ...prev, tokens: value }))}
                />
              </Field>
              <Field label="Цена (коп.)">
                <NumberInput
                  min={0}
                  value={newPackageDraft.price_rub_cents}
                  onChange={(value) => setNewPackageDraft((prev) => ({ ...prev, price_rub_cents: value }))}
                />
              </Field>
              <Field label="Сортировка">
                <NumberInput
                  min={0}
                  value={newPackageDraft.sort_order}
                  onChange={(value) => setNewPackageDraft((prev) => ({ ...prev, sort_order: value }))}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => void createPackage()}
                disabled={savingPackage !== null || deletingPackage !== null}
                className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
              >
                {savingPackage === newPackageDraft.code.trim() ? 'Создание...' : 'Создать пакет'}
              </button>
            </div>
          </article>

          {packages.map((pkg) => {
            const d = packageDrafts[pkg.code] || pkg
            return (
              <article key={pkg.code} className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
                  <Field label="Код пакета">
                    <TextInput value={d.code} disabled />
                  </Field>
                  <Field label="Название пакета">
                    <TextInput
                      value={d.display_name}
                      onChange={(value) => updatePackageDraft(pkg.code, { display_name: value })}
                    />
                  </Field>
                  <Field label="Токенов" hint="шт.">
                    <NumberInput
                      value={d.tokens}
                      min={1}
                      onChange={(value) => updatePackageDraft(pkg.code, { tokens: value })}
                    />
                  </Field>
                  <Field label="Цена" hint="в копейках">
                    <NumberInput
                      value={d.price_rub_cents}
                      min={0}
                      onChange={(value) => updatePackageDraft(pkg.code, { price_rub_cents: value })}
                    />
                  </Field>
                  <Field label="Порядок сортировки">
                    <NumberInput
                      value={d.sort_order}
                      min={0}
                      onChange={(value) => updatePackageDraft(pkg.code, { sort_order: value })}
                    />
                  </Field>
                  <Field label="Активен">
                    <label className="h-10 rounded-lg border border-border/80 bg-background px-3 text-sm flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(d.is_active)}
                        onChange={(e) => updatePackageDraft(pkg.code, { is_active: e.target.checked })}
                      />
                      <span>{d.is_active ? 'Да' : 'Нет'}</span>
                    </label>
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    Цена: <span className="font-semibold text-foreground">{rubFromCents(d.price_rub_cents)} ₽</span> · Токены:{' '}
                    <span className="font-semibold text-foreground">{Number(d.tokens || 0).toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void deletePackage(pkg.code)}
                      disabled={deletingPackage !== null || savingPackage !== null}
                      className="h-10 px-4 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm font-medium disabled:opacity-50"
                    >
                      {deletingPackage === pkg.code ? 'Деактивация...' : 'Деактивировать'}
                    </button>
                    <button
                      onClick={() => void savePackage(pkg.code)}
                      disabled={savingPackage !== null || deletingPackage !== null}
                      className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
                    >
                      {savingPackage === pkg.code ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 shadow-sm">
        <div className="mb-4 rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-semibold leading-none">YooKassa</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Runtime-настройки платежного шлюза. Секрет хранится в зашифрованном виде.
                </p>
              </div>
            </div>
            <button
              onClick={() => void load()}
              className="h-10 px-4 rounded-lg border border-sidebar-border bg-sidebar-background/60 text-sm inline-flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Field label="Shop ID">
              <TextInput
                value={yookassaDraft.shop_id}
                onChange={(value) => setYookassaDraft((prev) => ({ ...prev, shop_id: value }))}
                placeholder="Введите shop_id"
              />
            </Field>
            <Field label="Secret key (замена)">
              <TextInput
                type="password"
                value={yookassaDraft.secret_key}
                onChange={(value) => {
                  setClearYooSecretRequested(false)
                  setYookassaDraft((prev) => ({ ...prev, secret_key: value }))
                }}
                placeholder={data.yookassa.secret_key_masked ? `Текущий: ${data.yookassa.secret_key_masked}` : 'Введите secret_key'}
              />
            </Field>
            <Field label="Return URL">
              <TextInput
                value={yookassaDraft.return_url}
                onChange={(value) => setYookassaDraft((prev) => ({ ...prev, return_url: value }))}
                placeholder="https://..."
              />
            </Field>
            <Field label="Webhook URL">
              <TextInput
                value={yookassaDraft.webhook_url}
                onChange={(value) => setYookassaDraft((prev) => ({ ...prev, webhook_url: value }))}
                placeholder="https://..."
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-background/50 px-3 py-2">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Secret: {data.yookassa.secret_key_configured ? (data.yookassa.secret_key_masked || 'настроен') : 'не настроен'}
            </span>
            <button
              type="button"
              onClick={() => {
                setYookassaDraft((prev) => ({ ...prev, secret_key: '' }))
                setClearYooSecretRequested(true)
              }}
              className="text-xs rounded-md border border-sidebar-border px-2 py-1 hover:bg-sidebar-accent"
            >
              Очистить runtime secret
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => void testYooKassa()}
              disabled={testingYooKassa || savingYooKassa}
              className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
            >
              {testingYooKassa ? 'Проверка...' : 'Проверить подключение'}
            </button>
            <button
              onClick={() => void saveYooKassa()}
              disabled={savingYooKassa || testingYooKassa}
              className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
            >
              {savingYooKassa ? 'Сохранение...' : 'Сохранить YooKassa'}
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-sidebar-border text-sm font-semibold">Аудит YooKassa (последние 20)</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border bg-secondary/20">
                  <th className="px-4 py-3 text-left">Когда</th>
                  <th className="px-4 py-3 text-left">Кто</th>
                  <th className="px-4 py-3 text-left">Поля</th>
                </tr>
              </thead>
              <tbody>
                {data.yookassa.audit.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-muted-foreground" colSpan={3}>
                      Изменений пока нет
                    </td>
                  </tr>
                ) : (
                  data.yookassa.audit.map((row, idx) => (
                    <tr key={row.id} className={`border-b border-sidebar-border/40 ${idx % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                      <td className="px-4 py-3">{toLocalDateTime(row.created_at)}</td>
                      <td className="px-4 py-3">{row.actor || 'superadmin'}</td>
                      <td className="px-4 py-3">{(row.changed_fields || []).join(', ') || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 shadow-sm">
        <div className="mb-4 rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
          <h2 className="text-xl font-semibold leading-none">Последние покупки токенов</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Последние 50 покупок по организациям со статусами.
          </p>
        </div>
        <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border bg-secondary/20">
                  <th className="px-4 py-3 text-left">Организация</th>
                  <th className="px-4 py-3 text-left">Пакет</th>
                  <th className="px-4 py-3 text-right">Всего</th>
                  <th className="px-4 py-3 text-right">Остаток</th>
                  <th className="px-4 py-3 text-left">Статус</th>
                  <th className="px-4 py-3 text-left">Оплата</th>
                  <th className="px-4 py-3 text-left">Создана</th>
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-muted-foreground" colSpan={7}>
                      Покупок пока нет
                    </td>
                  </tr>
                ) : (
                  purchases.map((row, idx) => (
                    <tr key={row.id} className={`border-b border-sidebar-border/40 ${idx % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.org_name}</div>
                        <div className="text-xs text-muted-foreground">{row.org_id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-3">{row.package_code}</td>
                      <td className="px-4 py-3 text-right font-medium">{Number(row.tokens_total || 0).toLocaleString('ru-RU')}</td>
                      <td className="px-4 py-3 text-right font-medium">{Number(row.tokens_remaining || 0).toLocaleString('ru-RU')}</td>
                      <td className="px-4 py-3">{statusLabel(row.status)}</td>
                      <td className="px-4 py-3">
                        {row.payment_status || '—'}
                        {row.payment_id ? <div className="text-xs text-muted-foreground">{row.payment_id}</div> : null}
                      </td>
                      <td className="px-4 py-3">{toLocalDateTime(row.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
