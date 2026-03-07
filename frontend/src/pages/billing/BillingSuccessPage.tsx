import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { billingApi, type BillingPaymentStatusInfo, type TokenBalanceInfo } from '@/lib/api'
import { CheckCircle2, Clock3, CreditCard, RefreshCw, Wallet, XCircle } from 'lucide-react'

type PendingPayment = {
  paymentId: string
  kind: 'plan' | 'token_package'
  title: string
  createdAt: string
}

type SubInfo = {
  plan: string
  status: string
  current_period_end: string | null
}

const STORAGE_KEY = 'billing_pending_payment'

function readPendingPayment(): PendingPayment | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingPayment>
    if (!parsed.paymentId || !parsed.kind || !parsed.title || !parsed.createdAt) return null
    if (parsed.kind !== 'plan' && parsed.kind !== 'token_package') return null
    return parsed as PendingPayment
  } catch {
    return null
  }
}

function clearPendingPayment() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(STORAGE_KEY)
}

export default function BillingSuccessPage() {
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(() => readPendingPayment())
  const [paymentStatus, setPaymentStatus] = useState<BillingPaymentStatusInfo | null>(null)
  const [subscription, setSubscription] = useState<SubInfo | null>(null)
  const [tokenBalance, setTokenBalance] = useState<TokenBalanceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const calls: Promise<unknown>[] = [billingApi.subscription(), billingApi.tokenBalance()]
      if (pendingPayment?.paymentId) calls.unshift(billingApi.paymentStatus(pendingPayment.paymentId))
      const results = await Promise.all(calls)

      if (pendingPayment?.paymentId) {
        const paymentResp = results[0] as Awaited<ReturnType<typeof billingApi.paymentStatus>>
        if (paymentResp.data.ok && paymentResp.data.data) {
          setPaymentStatus(paymentResp.data.data)
          if (paymentResp.data.data.status === 'succeeded' || paymentResp.data.data.status === 'canceled') {
            clearPendingPayment()
          }
        }
      }

      const subResp = results[pendingPayment?.paymentId ? 1 : 0] as Awaited<ReturnType<typeof billingApi.subscription>>
      const balanceResp = results[pendingPayment?.paymentId ? 2 : 1] as Awaited<ReturnType<typeof billingApi.tokenBalance>>

      if (subResp.data.ok && subResp.data.data) setSubscription(subResp.data.data as SubInfo)
      if (balanceResp.data.ok && balanceResp.data.data) setTokenBalance(balanceResp.data.data)
    } catch (error) {
      const err = error as { response?: { data?: { error?: { message?: string } } } }
      setErrorMessage(err?.response?.data?.error?.message || 'Не удалось проверить статус оплаты.')
    }
    setLoading(false)
  }, [pendingPayment?.paymentId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!pendingPayment?.paymentId) return
    if (paymentStatus?.status === 'succeeded' || paymentStatus?.status === 'canceled') return
    const timer = window.setInterval(() => {
      void load()
    }, 4000)
    return () => window.clearInterval(timer)
  }, [load, paymentStatus?.status, pendingPayment?.paymentId])

  const state = useMemo(() => {
    if (!pendingPayment?.paymentId) {
      return {
        icon: CheckCircle2,
        iconClass: 'text-emerald-500',
        title: 'Возврат после оплаты',
        text: 'Если вы вернулись из YooKassa, откройте биллинг и проверьте, обновились ли тариф или пакет токенов.',
      }
    }
    if (paymentStatus?.status === 'succeeded') {
      return {
        icon: CheckCircle2,
        iconClass: 'text-emerald-500',
        title: 'Оплата принята',
        text: 'Платёж подтверждён. Обновление тарифа или токенов обычно появляется в кабинете автоматически в течение нескольких секунд.',
      }
    }
    if (paymentStatus?.status === 'canceled') {
      return {
        icon: XCircle,
        iconClass: 'text-rose-500',
        title: 'Оплата не завершена',
        text: 'Платёж был отменён или не был подтверждён. Вы можете вернуться в биллинг и попробовать снова.',
      }
    }
    return {
      icon: Clock3,
      iconClass: 'text-amber-500',
      title: 'Проверяем оплату',
      text: 'Мы ждём подтверждение от YooKassa. Не закрывайте страницу: как только статус обновится, здесь появится результат.',
    }
  }, [paymentStatus?.status, pendingPayment?.paymentId])

  const StatusIcon = state.icon

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CreditCard className="h-6 w-6 text-primary" />
          Возврат после оплаты
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Здесь можно проверить, как прошёл платёж и обновились ли данные в биллинге.</p>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-secondary/60">
              <StatusIcon className={`h-6 w-6 ${state.iconClass}`} />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">{state.title}</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{state.text}</p>
            </div>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Проверить снова
          </button>
        </div>

        {pendingPayment ? (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="text-xs text-muted-foreground">Что оплачивали</div>
              <div className="mt-1 text-base font-semibold">{pendingPayment.title}</div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="text-xs text-muted-foreground">Тип покупки</div>
              <div className="mt-1 text-base font-semibold">{pendingPayment.kind === 'plan' ? 'Тариф' : 'Пакет токенов'}</div>
            </div>
            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <div className="text-xs text-muted-foreground">Платёж</div>
              <div className="mt-1 text-base font-semibold">{paymentStatus?.payment_id || pendingPayment.paymentId}</div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4 text-primary" />
            Текущее состояние кабинета
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Тариф</span>
              <span className="font-medium">{subscription?.plan === 'free' ? 'Бесплатный' : subscription?.plan === 'team' ? 'Команда' : subscription?.plan === 'business' ? 'Бизнес' : (subscription?.plan || 'Неизвестно')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Статус</span>
              <span className="font-medium">{subscription?.status || 'Неизвестно'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Всего AI токенов</span>
              <span className="font-medium">{tokenBalance ? tokenBalance.total_tokens_remaining.toLocaleString('ru-RU') : '—'}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="text-sm font-semibold">Что делать дальше</div>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li>Если статус уже изменился, откройте биллинг и проверьте обновлённые лимиты или пакет токенов.</li>
            <li>Если платёж ещё обрабатывается, подождите несколько секунд и нажмите «Проверить снова».</li>
            <li>Если платёж отменён, можно вернуться и повторить покупку.</li>
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/billing"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Открыть биллинг
            </Link>
            <button
              onClick={() => {
                clearPendingPayment()
                setPendingPayment(null)
              }}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-5 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Очистить статус
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
