import { useEffect, useMemo, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import type { DashboardFilter, DashboardWidget, DashboardWidgetConfig, TableInfo } from '@/lib/api'
import { WIDGET_TYPES, AGGREGATIONS, FILTER_OPERATORS } from '@/lib/constants'

export function normalizeConfig(config?: Partial<DashboardWidgetConfig> | null): DashboardWidgetConfig {
  return {
    aggregation: config?.aggregation ?? 'count',
    value_column_id: config?.value_column_id ?? null,
    group_by_column_id: config?.group_by_column_id ?? null,
    time_column_id: config?.time_column_id ?? null,
    time_granularity: config?.time_granularity ?? 'day',
    filters: Array.isArray(config?.filters) ? config!.filters : [],
    limit: typeof config?.limit === 'number' ? config.limit : 10,
    selected_column_ids: Array.isArray(config?.selected_column_ids) ? config!.selected_column_ids : [],
  }
}

interface WidgetEditorProps {
  widget: DashboardWidget
  tables: TableInfo[]
  onSave: (next: DashboardWidget) => Promise<void>
  onDelete: () => Promise<void>
}

export default function WidgetEditor({ widget, tables, onSave, onDelete }: WidgetEditorProps) {
  const [draft, setDraft] = useState<DashboardWidget>(widget)
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(widget), [widget])

  const table = useMemo(() => tables.find((t) => t.id === draft.table_id) || null, [tables, draft.table_id])
  const columns = table?.columns || []
  const cfg = normalizeConfig(draft.config)

  const updateConfig = (patch: Partial<DashboardWidgetConfig>) => {
    setDraft((prev) => ({ ...prev, config: { ...normalizeConfig(prev.config), ...patch } }))
  }

  const save = async () => {
    setSaving(true)
    await onSave({ ...draft, config: normalizeConfig(draft.config) })
    setSaving(false)
  }

  const addFilter = () => {
    if (!columns[0]) return
    const next: DashboardFilter = { column_id: columns[0].id, op: 'eq', value: '' }
    updateConfig({ filters: [...cfg.filters, next] })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Основное</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            placeholder="Название виджета"
          />
          <select
            value={draft.widget_type}
            onChange={(e) => setDraft((p) => ({ ...p, widget_type: e.target.value as DashboardWidget['widget_type'] }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
          >
            {WIDGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select
            value={draft.table_id || ''}
            onChange={(e) => setDraft((p) => ({ ...p, table_id: e.target.value || null }))}
            className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
          >
            <option value="">— Таблица —</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary flex items-center gap-1.5 disabled:opacity-50">
              <Save className="h-4 w-4" /> Сохранить
            </button>
            <button onClick={onDelete} className="h-9 px-3 rounded-lg border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" /> Удалить
            </button>
          </div>
        </div>
      </div>

      {draft.widget_type !== 'table' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Расчет</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={cfg.aggregation}
              onChange={(e) => updateConfig({ aggregation: e.target.value as DashboardWidgetConfig['aggregation'] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              title="Тип расчета"
            >
              {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>

            <select
              value={cfg.value_column_id || ''}
              onChange={(e) => updateConfig({ value_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              title="Поле значения"
            >
              <option value="">Значение (поле)</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              value={cfg.group_by_column_id || ''}
              onChange={(e) => updateConfig({ group_by_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              disabled={draft.widget_type === 'metric' || Boolean(cfg.time_column_id)}
              title="Группировка"
            >
              <option value="">Группировка</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <input
              type="number"
              min={1}
              max={200}
              value={cfg.limit}
              onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Лимит"
              title="Лимит"
            />
          </div>
        </div>
      )}

      {draft.widget_type !== 'table' && draft.widget_type !== 'metric' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Время (для выручки по датам)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={cfg.time_column_id || ''}
              onChange={(e) => updateConfig({ time_column_id: e.target.value || null })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Ось времени (опционально)</option>
              {columns
                .filter((c) => c.field_type === 'date' || c.field_type === 'datetime')
                .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={cfg.time_granularity}
              onChange={(e) => updateConfig({ time_granularity: e.target.value as DashboardWidgetConfig['time_granularity'] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              disabled={!cfg.time_column_id}
            >
              <option value="day">По дням</option>
              <option value="week">По неделям</option>
              <option value="month">По месяцам</option>
            </select>
            <div className="sm:col-span-2 text-xs text-muted-foreground self-center px-1">
              Для графика выручки по датам: «Сумма» + поле суммы + поле даты.
            </div>
          </div>
        </div>
      )}

      {draft.widget_type === 'table' && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Табличный вид</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={cfg.selected_column_ids[0] || ''}
              onChange={(e) => updateConfig({ selected_column_ids: e.target.value ? [e.target.value] : [] })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
            >
              <option value="">Главная колонка</option>
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              type="number"
              min={1}
              max={200}
              value={cfg.limit}
              onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
              className="h-9 px-3 rounded-lg border border-input bg-background text-sm"
              placeholder="Лимит строк"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Фильтры</span>
          <button onClick={addFilter} className="text-xs text-primary hover:underline">+ добавить</button>
        </div>
        {cfg.filters.length === 0 && <p className="text-xs text-muted-foreground">Фильтры не заданы.</p>}
        {cfg.filters.map((f, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <select
              value={f.column_id}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, column_id: e.target.value }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
            >
              {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={f.op}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, op: e.target.value as DashboardFilter['op'] }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
            >
              {FILTER_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
            <input
              value={String(f.value ?? '')}
              onChange={(e) => {
                const next = [...cfg.filters]
                next[i] = { ...f, value: e.target.value }
                updateConfig({ filters: next })
              }}
              className="h-8 px-2 rounded-md border border-input bg-background text-xs"
              placeholder="Значение"
            />
            <button
              onClick={() => updateConfig({ filters: cfg.filters.filter((_, idx) => idx !== i) })}
              className="h-8 px-2 rounded-md border border-destructive/40 text-destructive text-xs"
            >Удалить</button>
          </div>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Текущая настройка: {draft.widget_type} • лимит {cfg.limit}{table ? ` • ${table.name}` : ''}
      </div>
    </div>
  )
}
