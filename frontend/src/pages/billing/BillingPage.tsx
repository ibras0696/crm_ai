import { useState, useEffect, useCallback } from 'react'
import {
  billingApi,
  type PlanInfo,
  type TokenBalanceInfo,
  type TokenPackageInfo,
  type TokenPurchaseResponse,
  type UsageInfo,
} from '@/lib/api'
import { CreditCard, Zap, Users, Database, HardDrive, FileText, Check, Crown, Sparkles } from 'lucide-react'

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

export default function BillingPage() {
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
        const url = (r.data.data as any).confirmation_url
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
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-base font-semibold">AI токены</h3>
              <p className="text-xs text-muted-foreground">Сначала расходуются купленные токены, затем тарифные. Цикл: {tokenBalance.cycle_key}</p>
            </div>
            <div className="text-sm text-muted-foreground">Всего доступно: <span className="text-foreground font-semibold">{tokenBalance.total_tokens_remaining.toLocaleString('ru-RU')}</span></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Купленные</div>
              <div className="text-xl font-bold">{tokenBalance.addon_tokens_remaining.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Тарифные (остаток)</div>
              <div className="text-xl font-bold">{tokenBalance.plan_tokens_remaining.toLocaleString('ru-RU')}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Тарифные (квота месяца)</div>
              <div className="text-xl font-bold">{tokenBalance.plan_tokens_monthly_quota.toLocaleString('ru-RU')}</div>
            </div>
          </div>
          {tokenPackages.length > 0 && (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium">Пакеты токенов</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Оплата проходит через YooKassa. После успешной оплаты токены начисляются автоматически в биллинг-кошелёк.
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {tokenPackages.map((p) => {
                  const costPer1k = p.tokens > 0 ? Math.round((p.price_rub_cents / 100 / p.tokens) * 1000) : 0
                  return (
                    <div key={p.code} className="rounded-lg border border-border p-3 bg-secondary/10 space-y-3">
                      <div>
                        <div className="text-sm font-semibold">{p.display_name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {p.tokens.toLocaleString('ru-RU')} токенов
                        </div>
                      </div>
                      <div>
                        <div className="text-xl font-bold">{formatPrice(Number(p.price_rub_cents || 0))}</div>
                        <div className="text-xs text-muted-foreground">{costPer1k.toLocaleString('ru-RU')} ₽ / 1k токенов</div>
                      </div>
                      <button
                        onClick={() => handleBuyTokens(p.code)}
                        disabled={buyingPackage !== null}
                        className="w-full h-10 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/15 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {buyingPackage === p.code ? 'Переход к оплате...' : 'Купить пакет'}
                      </button>
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
          {!cancelConfirm ? (
            <button
              onClick={() => setCancelConfirm(true)}
              className="h-9 px-4 rounded-lg border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
            >
              Отменить подписку
            </button>
          ) : (
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
        </div>
      )}
    </div>
  )
}
