import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  billingApi,
  type PlanInfo,
  type TokenBalanceInfo,
  type TokenPackageInfo,
  type TokenPurchaseResponse,
  type UsageInfo,
} from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { CreditCard, Zap, Users, Database, HardDrive, FileText, Check, Crown, Sparkles } from 'lucide-react'

const BILLING_PENDING_PAYMENT_KEY = 'billing_pending_payment'

interface SubInfo {
  plan: string; status: string
  current_period_start: string | null; current_period_end: string | null
  grace_period_end?: string | null
  data_purge_at?: string | null
}

const PLAN_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  free: { bg: 'bg-secondary/30', border: 'border-border', text: 'text-muted-foreground', badge: 'bg-secondary text-muted-foreground' },
  team: { bg: 'bg-blue-500/5', border: 'border-blue-500/30', text: 'text-blue-500', badge: 'bg-blue-500/10 text-blue-600' },
}

const DEFAULT_PLAN_COLORS = PLAN_COLORS.free ?? { bg: 'bg-secondary/30', border: 'border-border', text: 'text-muted-foreground', badge: 'bg-secondary text-muted-foreground' }

function getApiErrorMessage(error: unknown, fallback: string): string {
  const err = error as { response?: { data?: { error?: { code?: string; message?: string } } } } | undefined
  const code = err?.response?.data?.error?.code
  const message = err?.response?.data?.error?.message
  const mapped: Record<string, string> = {
    MEMBER_LIMIT_REACHED: 'Достигнут лимит участников по вашему тарифу.',
    STORAGE_LIMIT_REACHED: 'Достигнут лимит хранилища по вашему тарифу.',
    PAYMENT_REQUIRED: 'Для этого действия нужна активная подписка.',
    AI_TOKEN_LIMIT_EXCEEDED: 'Лимит AI токенов исчерпан.',
  }
  return (code && mapped[code]) || message || fallback
}

function savePendingPayment(paymentId: string, kind: 'plan' | 'token_package', title: string) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(
    BILLING_PENDING_PAYMENT_KEY,
    JSON.stringify({
      paymentId,
      kind,
      title,
      createdAt: new Date().toISOString(),
    }),
  )
}

function formatNumber(value: number) {
  return value.toLocaleString('ru-RU')
}

function getPackageMeta(index: number, total: number) {
  if (total <= 1) {
    return {
      badge: 'Пакет токенов',
      note: 'Подойдет для разовой покупки.',
      featured: true,
    }
  }
  if (index === 0) {
    return {
      badge: 'На пробу',
      note: 'Чтобы быстро докупить токены и продолжить работу.',
      featured: false,
    }
  }
  if (index === total - 1) {
    return {
      badge: 'Самый выгодный',
      note: 'Лучший вариант, если AI используете регулярно.',
      featured: true,
    }
  }
  return {
    badge: 'Для регулярной работы',
    note: 'Оптимальный пакет для постоянной нагрузки.',
    featured: false,
  }
}

export default function BillingPage() {
  const { user, members } = useAuth()
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [sub, setSub] = useState<SubInfo | null>(null)
  const [tokenBalance, setTokenBalance] = useState<TokenBalanceInfo | null>(null)
  const [tokenPackages, setTokenPackages] = useState<TokenPackageInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [buyingPackage, setBuyingPackage] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const isOrgOwner = useMemo(() => {
    if (!user) return false
    return members.find((m) => m.user_id === user.id)?.role === 'owner'
  }, [members, user])

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const [pR, uR, sR, tbR, tpR] = await Promise.all([
        billingApi.plans(),
        billingApi.usage(),
        billingApi.subscription(),
        billingApi.tokenBalance(),
        billingApi.tokenPackages(),
      ])
      if (pR.data.ok && pR.data.data) setPlans(pR.data.data)
      if (uR.data.ok && uR.data.data) setUsage(uR.data.data)
      if (sR.data.ok && sR.data.data) setSub(sR.data.data as SubInfo)
      if (tbR.data.ok && tbR.data.data) setTokenBalance(tbR.data.data)
      if (tpR.data.ok && tpR.data.data) setTokenPackages(tpR.data.data)
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Не удалось загрузить данные биллинга.'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCancelSubscription = async () => {
    if (!isOrgOwner) {
      setErrorMessage('Отменить подписку может только владелец организации.')
      return
    }
    setCancelling(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const r = await billingApi.cancelSubscription()
      if (r.data.ok) {
        setCancelConfirm(false)
        await load()
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Не удалось отменить подписку.'))
    }
    setCancelling(false)
  }

  const handleUpgrade = async (planName: string) => {
    setPaying(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const r = await billingApi.createPayment(planName, 'monthly')
      if (r.data.ok && r.data.data) {
        const data = r.data.data as { confirmation_url?: string; payment_id?: string; plan?: string }
        const url = data.confirmation_url
        if (url && data.payment_id) {
          savePendingPayment(data.payment_id, 'plan', data.plan || planName)
        }
        if (url) window.location.href = url
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Не удалось создать оплату тарифа.'))
    }
    setPaying(false)
  }

  const handleBuyTokens = async (packageCode: string) => {
    setBuyingPackage(packageCode)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const r = await billingApi.purchaseTokens(packageCode)
      if (r.data.ok && r.data.data) {
        const data = r.data.data as TokenPurchaseResponse
        if (data.requires_payment && data.confirmation_url) {
          if (data.payment_id) {
            savePendingPayment(data.payment_id, 'token_package', data.package_display_name || data.package_code)
          }
          window.location.href = data.confirmation_url
          return
        }
        if (data.purchase_applied) {
          setSuccessMessage(
            `Пакет ${data.package_display_name || data.package_code} успешно зачислен: +${Number(
              data.tokens_added || 0,
            ).toLocaleString('ru-RU')} токенов.`,
          )
        }
        await load()
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, 'Не удалось купить пакет токенов.'))
    }
    setBuyingPackage(null)
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} КБ`
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} МБ`
    return `${(bytes / 1073741824).toFixed(1)} ГБ`
  }

  const formatPrice = (cents: number) => {
    if (cents === 0) return 'Бесплатно'
    return `${(cents / 100).toLocaleString('ru')} ₽`
  }

  const currentPlan = plans.find((p) => p.name === sub?.plan) ?? null

  if (loading) return <div className="flex items-center justify-center py-32"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="h-6 w-6 text-primary" /> Биллинг</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Управление тарифом и использованием ресурсов</p>
      </div>
      {errorMessage && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
          {successMessage}
        </div>
      )}

      {/* Current subscription */}
      {sub && (
        <div className="rounded-xl border border-border bg-card p-5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Crown className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-lg font-bold capitalize">{sub.plan === 'free' ? 'Бесплатный' : sub.plan === 'team' ? 'Команда' : sub.plan === 'business' ? 'Бизнес' : sub.plan}</p>
              <p className="text-xs text-muted-foreground">
                Статус: <span className={sub.status === 'active' ? 'text-emerald-500' : 'text-amber-500'}>{sub.status === 'active' ? 'Активен' : sub.status}</span>
                {sub.current_period_end && <> · до {new Date(sub.current_period_end).toLocaleDateString('ru')}</>}
                {sub.grace_period_end && <> · льготный период до {new Date(sub.grace_period_end).toLocaleDateString('ru')}</>}
                {sub.data_purge_at && <> · удаление данных после {new Date(sub.data_purge_at).toLocaleDateString('ru')}</>}
              </p>
            </div>
          </div>
        </div>
      )}

      {currentPlan && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">AI лимиты текущего тарифа</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Токенов на период тарифа</div>
              <div className="text-xl font-bold">{Number(currentPlan.ai_tokens_per_day || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Токенов за запрос</div>
              <div className="text-xl font-bold">{Number(currentPlan.ai_max_tokens_per_request || 0).toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Запросов/мин на пользователя</div>
              <div className="text-xl font-bold">{Number(currentPlan.ai_rpm_per_user || 0).toLocaleString('ru-RU')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Usage */}
      {usage && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Участники', value: usage.members, icon: Users, color: 'text-blue-500', bg: 'bg-blue-500/10' },
            { label: 'Таблицы', value: usage.tables, icon: Database, color: 'text-violet-500', bg: 'bg-violet-500/10' },
            { label: 'Записи', value: usage.records, icon: FileText, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
            { label: 'Файлы', value: usage.files, icon: HardDrive, color: 'text-amber-500', bg: 'bg-amber-500/10' },
            { label: 'Хранилище', value: formatBytes(usage.storage_bytes), icon: HardDrive, color: 'text-rose-500', bg: 'bg-rose-500/10' },
          ].map(card => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
              <div className={`h-9 w-9 rounded-lg ${card.bg} flex items-center justify-center shrink-0`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold">{typeof card.value === 'number' ? card.value.toLocaleString('ru') : card.value}</p>
                <p className="text-[11px] text-muted-foreground">{card.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tokenBalance && (
        <div className="rounded-[28px] border border-border bg-card p-6 shadow-sm space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Zap className="h-3.5 w-3.5" />
            AI токены
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)] gap-4">
            <div className="rounded-3xl border border-primary/15 bg-primary/[0.04] p-5 lg:p-6">
              <div className="text-sm text-muted-foreground">Доступно сейчас</div>
              <div className="mt-2 text-5xl font-bold tracking-tight">{formatNumber(tokenBalance.total_tokens_remaining)}</div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Это общий запас токенов, который можно использовать прямо сейчас для запросов к AI.
              </p>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="text-sm text-muted-foreground">Сначала спишется</div>
                  <div className="mt-2 text-3xl font-semibold">{formatNumber(tokenBalance.addon_tokens_remaining)}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    Купленные токены. Они расходуются первыми и не зависят от тарифа.
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="text-sm text-muted-foreground">Лимит этого месяца</div>
                  <div className="mt-2 text-3xl font-semibold">{formatNumber(tokenBalance.plan_tokens_remaining)}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    Остаток по тарифу на период {tokenBalance.cycle_key}.
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">Использовано из месячного лимита</span>
                  <span className="font-medium">
                    {formatNumber(Math.max(tokenBalance.plan_tokens_monthly_quota - tokenBalance.plan_tokens_remaining, 0))}
                    {' '}из {formatNumber(tokenBalance.plan_tokens_monthly_quota)}
                  </span>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary/70">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          tokenBalance.plan_tokens_monthly_quota > 0
                            ? ((tokenBalance.plan_tokens_monthly_quota - tokenBalance.plan_tokens_remaining) / tokenBalance.plan_tokens_monthly_quota) * 100
                            : 0,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-muted/20 p-5 lg:p-6">
              <div className="text-lg font-semibold">Как списываются токены</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Простая логика без ручных настроек.
              </div>
              <div className="mt-5 space-y-3">
                {[
                  {
                    step: '1',
                    title: 'Сначала тратятся купленные пакеты',
                    text: 'Если вы покупали токены отдельно, AI сначала использует именно их.',
                  },
                  {
                    step: '2',
                    title: 'Потом тратится лимит тарифа',
                    text: `Когда купленные токены закончатся, начнут списываться токены из лимита на ${tokenBalance.cycle_key}.`,
                  },
                  {
                    step: '3',
                    title: 'Если лимит закончится, можно докупить',
                    text: 'Ниже можно выбрать пакет и сразу пополнить запас без ожидания следующего месяца.',
                  },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {item.step}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {tokenPackages.length > 0 && (
            <div className="space-y-4 border-t border-border/70 pt-5">
              <div className="space-y-2">
                <div className="text-xl font-semibold">Пакеты для покупки</div>
                <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Если текущего запаса не хватит, выберите пакет под свою нагрузку. После оплаты токены появятся автоматически.
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {tokenPackages.map((p, index) => {
                  const costPer1k = p.tokens > 0 ? Math.round((p.price_rub_cents / 100 / p.tokens) * 1000) : 0
                  const meta = getPackageMeta(index, tokenPackages.length)
                  const badgeText = (p.badge_text || '').trim() || meta.badge
                  const descriptionText = (p.description || '').trim() || meta.note
                  const buttonText = (p.button_text || '').trim() || 'Перейти к оплате'
                  const paymentNote = (p.payment_note || '').trim() || 'После оплаты токены сразу появятся в кабинете и начнут списываться раньше тарифного лимита.'
                  const priceCaption = (p.price_caption || '').trim() || `${costPer1k.toLocaleString('ru-RU')} ₽ за 1 000 токенов`
                  return (
                    <div
                      key={p.code}
                      className={`h-full rounded-[26px] border p-5 transition-colors flex flex-col bg-card ${
                        meta.featured
                          ? 'border-primary/35 shadow-[0_16px_40px_rgba(24,132,242,0.12)]'
                          : 'border-border'
                      }`}
                    >
                      <div className="min-h-[172px]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-h-[76px]">
                            <div className="text-2xl font-semibold tracking-tight">{p.display_name}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {formatNumber(p.tokens)} токенов
                            </div>
                          </div>
                          <div className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            meta.featured
                              ? 'border border-primary/30 bg-primary/10 text-primary'
                              : 'border border-border bg-secondary/40 text-muted-foreground'
                          }`}>
                            {badgeText}
                          </div>
                        </div>

                        <div className="mt-4 min-h-[72px] text-sm leading-6 text-muted-foreground">
                          {descriptionText}
                        </div>
                      </div>

                      <div className="mt-5 rounded-2xl border border-border bg-muted/10 p-4">
                        <div className="text-xs text-muted-foreground">Стоимость</div>
                        <div className="mt-2 text-5xl font-bold tracking-tight">{formatPrice(Number(p.price_rub_cents || 0))}</div>
                        <div className="mt-3 text-sm text-muted-foreground">
                          {priceCaption}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-muted/10 p-3 text-xs leading-5 text-muted-foreground">
                        {paymentNote}
                      </div>

                      <div className="mt-auto pt-5">
                        <button
                          onClick={() => handleBuyTokens(p.code)}
                          disabled={buyingPackage !== null}
                          className={`w-full h-12 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 ${
                            meta.featured
                              ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_14px_36px_rgba(24,132,242,0.28)]'
                              : 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 hover:border-primary/40'
                          }`}
                        >
                          <Zap className="h-4 w-4" />
                          {buyingPackage === p.code ? 'Переходим к оплате...' : buttonText}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Plans */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map(plan => {
          const planKey = plan.name ?? 'free'
          const colors = PLAN_COLORS[planKey] ?? PLAN_COLORS.free ?? DEFAULT_PLAN_COLORS
          const price = plan.price_monthly
          const isCurrent = sub?.plan === plan.name
          const storageGb = plan.max_storage_mb >= 999999 ? null : (plan.max_storage_mb / 1024)
          return (
            <div key={plan.id} className={`rounded-2xl border-2 ${isCurrent ? 'border-primary' : colors.border} ${colors.bg} p-5 flex flex-col relative`}>
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-primary text-white text-xs font-bold">
                  Текущий
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>{plan.display_name}</span>
                {plan.has_ai && <Sparkles className="h-3.5 w-3.5 text-amber-500" />}
              </div>
              <p className="text-3xl font-bold mb-1">{formatPrice(price)}</p>
              <p className="text-xs text-muted-foreground mb-4">в месяц</p>
              <div className="space-y-2 flex-1 mb-4">
                {[
                  plan.max_members >= 999999 ? 'Участников: без ограничений' : `${plan.max_members} участников`,
                  plan.max_tables >= 999999 ? 'Таблиц: без ограничений' : `${plan.max_tables} таблиц`,
                  plan.max_records >= 999999 ? 'Записей: без ограничений' : `${plan.max_records.toLocaleString('ru')} записей`,
                  plan.max_storage_mb >= 999999 ? 'Хранилище: без ограничений' : `${storageGb?.toLocaleString('ru', { maximumFractionDigits: 2 })} ГБ хранилище`,
                  plan.has_ai ? 'AI Агент' : null,
                ].filter(Boolean).map((feat, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>{feat}</span>
                  </div>
                ))}
              </div>
              {!isCurrent && price > 0 ? (
                <button onClick={() => handleUpgrade(plan.name)} disabled={paying}
                  className="w-full h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" /> {paying ? 'Обработка...' : 'Перейти'}
                </button>
              ) : isCurrent ? (
                <div className="w-full h-10 rounded-lg border border-primary/30 text-primary text-sm font-medium flex items-center justify-center">
                  Активен
                </div>
              ) : (
                <div className="w-full h-10 rounded-lg border border-border text-muted-foreground text-sm flex items-center justify-center">
                  Текущий тариф
                </div>
              )}
            </div>
          )
        })}
      </div>

      {plans.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">Тарифы не настроены</p>
          <p className="text-sm mt-1">Добавьте тарифы в базу данных (таблица plans)</p>
        </div>
      )}

      {/* Danger zone */}
      {sub && sub.plan !== 'free' && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <h3 className="font-semibold text-destructive flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-destructive inline-block" />
            Опасная зона
          </h3>
          <p className="text-sm text-muted-foreground">
            Отмена или неоплата переводит организацию на бесплатный тариф после льготного периода.
            Через 30 дней после окончания подписки данные будут автоматически очищены.
          </p>
          {isOrgOwner && !cancelConfirm && (
            <button
              onClick={() => setCancelConfirm(true)}
              className="h-9 px-4 rounded-lg border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
            >
              Отменить подписку
            </button>
          )}
          {isOrgOwner && cancelConfirm && (
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium text-destructive">Вы уверены?</p>
              <button
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="h-9 px-4 rounded-lg bg-destructive text-white text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
              >
                {cancelling ? 'Отмена...' : 'Да, отменить'}
              </button>
              <button
                onClick={() => setCancelConfirm(false)}
                className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors"
              >
                Нет
              </button>
            </div>
          )}
          {!isOrgOwner && (
            <p className="text-sm text-muted-foreground">
              Только владелец организации может отменить подписку.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
