import { useState, useEffect, useCallback } from 'react'
import { billingApi, type PlanInfo, type UsageInfo } from '@/lib/api'
import { CreditCard, Zap, Users, Database, HardDrive, FileText, Check, Crown, Sparkles } from 'lucide-react'

interface SubInfo {
  plan: string; status: string
  current_period_start: string | null; current_period_end: string | null
}

const PLAN_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  free: { bg: 'bg-secondary/30', border: 'border-border', text: 'text-muted-foreground', badge: 'bg-secondary text-muted-foreground' },
  team: { bg: 'bg-blue-500/5', border: 'border-blue-500/30', text: 'text-blue-500', badge: 'bg-blue-500/10 text-blue-600' },
}

export default function BillingPage() {
  const [plans, setPlans] = useState<PlanInfo[]>([])
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [sub, setSub] = useState<SubInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [paying, setPaying] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pR, uR, sR] = await Promise.all([
        billingApi.plans(),
        billingApi.usage(),
        billingApi.subscription(),
      ])
      if (pR.data.ok && pR.data.data) setPlans(pR.data.data)
      if (uR.data.ok && uR.data.data) setUsage(uR.data.data)
      if (sR.data.ok && sR.data.data) setSub(sR.data.data as SubInfo)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleCancelSubscription = async () => {
    setCancelling(true)
    try {
      const r = await billingApi.cancelSubscription()
      if (r.data.ok) {
        setCancelConfirm(false)
        await load()
      }
    } catch { /* ignore */ }
    setCancelling(false)
  }

  const handleUpgrade = async (planName: string) => {
    setPaying(true)
    try {
      const r = await billingApi.createPayment(planName, period)
      if (r.data.ok && r.data.data) {
        const url = (r.data.data as any).confirmation_url
        if (url) window.location.href = url
      }
    } catch { /* ignore */ }
    setPaying(false)
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

  if (loading) return <div className="flex items-center justify-center py-32"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CreditCard className="h-6 w-6 text-primary" /> Биллинг</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Управление тарифом и использованием ресурсов</p>
      </div>

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
              </p>
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

      {/* Period toggle */}
      <div className="flex items-center gap-2 justify-center">
        <button onClick={() => setPeriod('monthly')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${period === 'monthly' ? 'bg-primary text-white' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}>
          Ежемесячно
        </button>
        <button onClick={() => setPeriod('yearly')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${period === 'yearly' ? 'bg-primary text-white' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}>
          Ежегодно <span className="text-[10px] bg-emerald-500/20 text-emerald-600 px-1.5 py-0.5 rounded-full font-bold">−20%</span>
        </button>
      </div>

      {/* Plans */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map(plan => {
          const colors = PLAN_COLORS[plan.name] || PLAN_COLORS.free
          const price = period === 'yearly' ? plan.price_yearly : plan.price_monthly
          const isCurrent = sub?.plan === plan.name
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
              <p className="text-xs text-muted-foreground mb-4">{period === 'yearly' ? 'в год' : 'в месяц'}</p>
              <div className="space-y-2 flex-1 mb-4">
                {[
                  plan.max_members >= 999999 ? 'Участников: без ограничений' : `${plan.max_members} участников`,
                  plan.max_tables >= 999999 ? 'Таблиц: без ограничений' : `${plan.max_tables} таблиц`,
                  plan.max_records >= 999999 ? 'Записей: без ограничений' : `${plan.max_records.toLocaleString('ru')} записей`,
                  plan.max_storage_mb >= 999999 ? 'Хранилище: без ограничений' : `${plan.max_storage_mb} МБ хранилище`,
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
            Отмена подписки переведёт организацию на бесплатный тариф в конце текущего расчётного периода.
            Все данные сохранятся, но доступ к функциям тарифа «Команда» будет ограничен.
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
