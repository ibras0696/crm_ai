import { Link } from 'react-router-dom'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
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
        <Link to="/reports" className="text-xs rounded-md border border-border px-2 py-1 hover:bg-secondary">
          Открыть в отчетах
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
