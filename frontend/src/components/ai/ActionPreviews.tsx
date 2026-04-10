import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { docsApi, type DocsAIGenerationJobStatus } from '@/lib/api/features/docs'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function docsJobStatusLabel(status: DocsAIGenerationJobStatus | string): string {
  switch (status) {
    case 'queued':
      return 'В очереди'
    case 'running':
      return 'Генерируется'
    case 'scanning':
      return 'Проверяется'
    case 'ready':
      return 'Готово'
    case 'blocked':
      return 'Заблокировано'
    case 'failed':
      return 'Ошибка'
    default:
      return status || 'Неизвестно'
  }
}

function docsJobStatusClass(status: DocsAIGenerationJobStatus | string): string {
  switch (status) {
    case 'ready':
      return 'text-emerald-600'
    case 'failed':
    case 'blocked':
      return 'text-destructive'
    case 'queued':
    case 'running':
    case 'scanning':
      return 'text-amber-600'
    default:
      return 'text-muted-foreground'
  }
}

export function DashboardPreview({ result }: { result: Record<string, unknown> }) {
  if (result.ok !== true) return null
  const dashboard = (result.dashboard || {}) as Record<string, unknown>
  const items = Array.isArray(result.items) ? (result.items as Array<Record<string, unknown>>) : []
  if (asString(result.action) !== 'create_dashboard') return null
  if (!asString(dashboard.id) && !asString(dashboard.name)) return null

  return (
    <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Создан дашборд</p>
          <p className="text-sm font-semibold">{asString(dashboard.name) || 'AI дашборд'}</p>
        </div>
        <Link to="/reports-v2" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
          Открыть в аналитике
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {items.slice(0, 6).map((item, idx) => {
          const title = asString(item.title) || `Виджет ${idx + 1}`
          const data = (item.data || {}) as Record<string, unknown>
          const type = asString((data as any).type || item.widget_type)
          if (type === 'metric') {
            return (
              <div key={idx} className="rounded-lg border border-border p-3 bg-card">
                <p className="text-xs text-muted-foreground">{title}</p>
                <p className="text-2xl font-bold mt-1">{asString((data as any).value ?? '—')}</p>
              </div>
            )
          }
          return (
            <div key={idx} className="rounded-lg border border-border p-3 bg-card">
              <p className="text-xs text-muted-foreground">{title}</p>
              <p className="text-sm font-medium mt-1">Тип: {type || '—'}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TablePreview({ result }: { result: Record<string, unknown> }) {
  if (result.ok !== true) return null
  const action = asString(result.action)
  const table = (result.table || {}) as Record<string, unknown>
  const tableId = asString(table.id)
  const tableName = asString(table.name)

  if (!tableId || !tableName) return null
  if (!['create_table', 'create_columns', 'create_records'].includes(action)) return null

  const createdCols = Array.isArray(result.columns)
    ? (result.columns as Array<Record<string, unknown>>)
    : Array.isArray(result.created)
      ? (result.created as Array<Record<string, unknown>>)
      : []
  const recordsCreated = Number(result.records_created ?? 0) || 0

  const subtitle =
    action === 'create_table'
      ? 'Таблица создана'
      : action === 'create_columns'
        ? `Колонки добавлены: ${createdCols.length}`
        : `Записи добавлены: ${recordsCreated}`

  return (
    <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          <p className="text-sm font-semibold">{tableName}</p>
        </div>
        <Link to={`/tables/${tableId}`} className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
          Открыть таблицу
        </Link>
      </div>

      {createdCols.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {createdCols.slice(0, 8).map((c, idx) => (
            <span key={idx} className="text-xs rounded-md border border-border bg-card px-2 py-1">
              {asString(c.name) || '—'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function KnowledgePreview({ result }: { result: Record<string, unknown> }) {
  if (result.ok !== true) return null
  if (asString(result.action) !== 'create_kb_page') return null
  const page = (result.page || {}) as Record<string, unknown>
  const pageTitle = asString(page.title)
  if (!pageTitle) return null
  return (
    <div className="mt-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 flex items-center justify-between gap-2">
      <div>
        <p className="text-xs text-muted-foreground">Создана страница базы знаний</p>
        <p className="text-sm font-semibold">{pageTitle}</p>
      </div>
      <Link to="/knowledge" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
        Открыть
      </Link>
    </div>
  )
}

export function SchedulePreview({ result }: { result: Record<string, unknown> }) {
  if (result.ok !== true) return null
  if (asString(result.action) !== 'create_schedule_event') return null
  const event = (result.event || {}) as Record<string, unknown>
  const title = asString(event.title)
  if (!title) return null
  return (
    <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-center justify-between gap-2">
      <div>
        <p className="text-xs text-muted-foreground">Создано событие в расписании</p>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <Link to="/schedule" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
        Открыть
      </Link>
    </div>
  )
}

export function DocumentPreview({ result }: { result: Record<string, unknown> }) {
  const file = (result.file || {}) as Record<string, unknown>
  const isRelevant = result.ok === true && asString(result.action) === 'create_document'
  const initialJob = useMemo(
    () => ({ ...(result.job || {}) } as Record<string, unknown>),
    [result.job],
  )
  const [job, setJob] = useState<Record<string, unknown>>(initialJob)
  const jobId = asString(job.id || initialJob.id)
  const status = asString(job.status || initialJob.status)
  const title = asString(file.title || job.title || initialJob.title)

  useEffect(() => {
    setJob(initialJob)
  }, [initialJob])

  useEffect(() => {
    if (!isRelevant) return
    if (!jobId) return
    if (status === 'ready' || status === 'failed' || status === 'blocked') return

    let cancelled = false
    const poll = async () => {
      try {
        const res = await docsApi.getAIGenerationJob(jobId)
        if (cancelled) return
        if (res.data.ok && res.data.data) {
          setJob(res.data.data as unknown as Record<string, unknown>)
        }
      } catch {
        // preview should stay quiet if status polling fails
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 2500)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [isRelevant, jobId, status])

  if (!isRelevant) return null
  if (!title) return null

  const statusText = docsJobStatusLabel(status)
  const subtitle =
    status === 'ready'
      ? 'Документ готов'
      : status === 'failed'
        ? 'Документ не удалось создать'
        : status === 'blocked'
          ? 'Документ заблокирован'
          : 'Документ в работе'

  return (
    <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <p className="text-sm font-semibold truncate">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {asString(file.type || job.file_type || initialJob.file_type).toUpperCase() || 'DOCX'}
          {status ? (
            <>
              {' · '}
              <span className={docsJobStatusClass(status)}>{statusText}</span>
            </>
          ) : null}
        </p>
        {status === 'failed' && asString(job.error_message) ? (
          <p className="text-xs text-destructive mt-1 line-clamp-2">{asString(job.error_message)}</p>
        ) : null}
      </div>
      <Link to="/docs" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
        {status === 'ready' ? 'Открыть документ' : 'Открыть в документах'}
      </Link>
    </div>
  )
}

export function ActionErrorPreview({ result }: { result: Record<string, unknown> }) {
  const ok = Boolean(result.ok)
  if (ok) return null
  const error = asString(result.error)
  if (!error) return null
  const mapped: Record<string, string> = {
    table_limit_reached: 'Достигнут лимит тарифа по таблицам. Освободите лимит или повысьте тариф.',
    record_limit_reached: 'Достигнут лимит тарифа по записям. Освободите лимит или повысьте тариф.',
    knowledge_limit_reached: 'Достигнут лимит тарифа по базе знаний. Освободите лимит или повысьте тариф.',
  }
  const text = asString(result.message) || mapped[error] || 'Не удалось выполнить действие.'
  return (
    <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
      <p className="text-xs text-muted-foreground">Действие не выполнено</p>
      <p className="text-sm text-destructive mt-1">{text}</p>
    </div>
  )
}

export function PendingActionPreview({
  result,
  onConfirm,
  onCancel,
  disabled = false,
}: {
  result: Record<string, unknown>
  onConfirm: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  if (result.needs_confirmation !== true) return null
  const action = asString(result.action)
  const rowsCount = Number(result.rows_count ?? 0) || 0
  const colsCount = Number(result.columns_count ?? 0) || 0
  const tableRef = asString(result.table_ref)
  const titleByAction: Record<string, string> = {
    create_records: 'Заполнение таблицы',
    create_columns: 'Изменение структуры таблицы',
  }
  const title = titleByAction[action] || 'Изменение таблицы'
  return (
    <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-xs text-muted-foreground">Требуется подтверждение</p>
      <p className="text-sm font-semibold mt-1">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {tableRef ? `Таблица: ${tableRef}. ` : ''}
        {rowsCount > 0 ? `Строк: ${rowsCount}. ` : ''}
        {colsCount > 0 ? `Колонок: ${colsCount}.` : ''}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="h-8 rounded-md bg-primary text-white text-xs hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Подтвердить
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="h-8 rounded-md border border-border text-xs hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Отменить
        </button>
      </div>
    </div>
  )
}
