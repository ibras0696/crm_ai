import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { superadminApi, type SuperadminBillingConfig, type SuperadminBillingPlanItem, type SuperadminTokenPackageItem } from '@/lib/api'
import { SaAiIcon, SaBillingIcon, SaUsersIcon } from '@/components/icons/modules/SuperadminModuleIcons'

const EMPTY: SuperadminBillingConfig = { plans: [], token_packages: [] }

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
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <input
      className="h-10 w-full rounded-lg border border-border/80 bg-background px-3 text-sm transition-colors outline-none focus:border-primary/60"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
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

export function SuperadminBillingView() {
  const [data, setData] = useState<SuperadminBillingConfig>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingPlan, setSavingPlan] = useState<string | null>(null)
  const [savingPackage, setSavingPackage] = useState<string | null>(null)

  const [planDrafts, setPlanDrafts] = useState<Record<string, SuperadminBillingPlanItem>>({})
  const [packageDrafts, setPackageDrafts] = useState<Record<string, SuperadminTokenPackageItem>>({})

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
    try {
      const r = await superadminApi.upsertTokenPackage(code, {
        display_name: draft.display_name,
        tokens: Number(draft.tokens),
        price_rub_cents: Number(draft.price_rub_cents),
        is_active: Boolean(draft.is_active),
        sort_order: Number(draft.sort_order),
      })
      if (!r.data.ok) throw new Error(r.data.error?.message || 'Не удалось сохранить пакет')
      await load()
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Не удалось сохранить пакет')
    }
    setSavingPackage(null)
  }

  if (loading) return <div className="rounded-xl border border-border p-5">Загрузка...</div>

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
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
                    <Field label="Токенов в месяц">
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
          {packages.map((pkg) => {
            const d = packageDrafts[pkg.code] || pkg
            return (
              <article key={pkg.code} className="rounded-xl border border-sidebar-border bg-sidebar-background/40 p-4 space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
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
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    Цена: <span className="font-semibold text-foreground">{rubFromCents(d.price_rub_cents)} ₽</span> · Токены:{' '}
                    <span className="font-semibold text-foreground">{Number(d.tokens || 0).toLocaleString('ru-RU')}</span>
                  </div>
                  <button
                    onClick={() => void savePackage(pkg.code)}
                    disabled={savingPackage !== null}
                    className="h-10 px-4 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
                  >
                    {savingPackage === pkg.code ? 'Сохранение...' : 'Сохранить'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
