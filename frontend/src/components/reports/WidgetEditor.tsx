import { type ReactNode, useEffect, useMemo, useState } from 'react'
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

  const field = (label: string, hint: string, control: ReactNode) => (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {control}
    </div>
  )

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border/70 bg-card px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-base font-semibold">Настройки виджета</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Настройте, что именно показывать, из какой таблицы брать данные и как их считать.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-secondary disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? 'Сохраняем...' : 'Сохранить'}
          </button>
          <button
            onClick={onDelete}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" /> Удалить
          </button>
        </div>
      </div>
      <div className="max-h-[min(72vh,820px)] overflow-y-auto px-4 py-4 scrollbar-thin">
        <div className="space-y-5 pr-1">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {field(
              'Название',
              'Как виджет будет называться на дашборде.',
              <input
                value={draft.title}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                placeholder="Название виджета"
              />,
            )}
            {field(
              'Тип виджета',
              'Главное число, график или таблица.',
              <select
                value={draft.widget_type}
                onChange={(e) => setDraft((p) => ({ ...p, widget_type: e.target.value as DashboardWidget['widget_type'] }))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {WIDGET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>,
            )}
            {field(
              'Источник данных',
              'Из какой таблицы брать данные для этого виджета.',
              <select
                value={draft.table_id || ''}
                onChange={(e) => setDraft((p) => ({ ...p, table_id: e.target.value || null }))}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="">Выберите таблицу</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>,
            )}
          </div>

          {draft.widget_type !== 'table' && (
            <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <div>
                <div className="text-sm font-semibold">Как считать данные</div>
                <div className="text-xs text-muted-foreground">
                  Выберите способ расчёта, поле значения и группировку.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                {field(
                  'Расчёт',
                  'Например: количество, сумма или среднее.',
                  <select
                    value={cfg.aggregation}
                    onChange={(e) => updateConfig({ aggregation: e.target.value as DashboardWidgetConfig['aggregation'] })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    title="Тип расчета"
                  >
                    {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>,
                )}
                {field(
                  'Поле значения',
                  'Какое поле брать для суммы, среднего и других расчётов.',
                  <select
                    value={cfg.value_column_id || ''}
                    onChange={(e) => updateConfig({ value_column_id: e.target.value || null })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    title="Поле значения"
                  >
                    <option value="">Не выбрано</option>
                    {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>,
                )}
                {field(
                  'Группировка',
                  'По какому полю разбивать данные на категории.',
                  <select
                    value={cfg.group_by_column_id || ''}
                    onChange={(e) => updateConfig({ group_by_column_id: e.target.value || null })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    disabled={draft.widget_type === 'metric' || Boolean(cfg.time_column_id)}
                    title="Группировка"
                  >
                    <option value="">Не выбрано</option>
                    {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>,
                )}
                {field(
                  'Сколько показать',
                  'Лимит строк или точек на графике.',
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={cfg.limit}
                    onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    placeholder="Лимит"
                    title="Лимит"
                  />,
                )}
              </div>
            </div>
          )}

          {draft.widget_type !== 'table' && draft.widget_type !== 'metric' && (
            <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <div>
                <div className="text-sm font-semibold">Время</div>
                <div className="text-xs text-muted-foreground">
                  Нужен только для графиков, если хотите показать динамику по датам.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {field(
                  'Поле даты',
                  'По какому полю строить ось времени.',
                  <select
                    value={cfg.time_column_id || ''}
                    onChange={(e) => updateConfig({ time_column_id: e.target.value || null })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Не выбрано</option>
                    {columns
                      .filter((c) => c.field_type === 'date' || c.field_type === 'datetime')
                      .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>,
                )}
                {field(
                  'Шаг времени',
                  'Показывать данные по дням, неделям или месяцам.',
                  <select
                    value={cfg.time_granularity}
                    onChange={(e) => updateConfig({ time_granularity: e.target.value as DashboardWidgetConfig['time_granularity'] })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    disabled={!cfg.time_column_id}
                  >
                    <option value="day">По дням</option>
                    <option value="week">По неделям</option>
                    <option value="month">По месяцам</option>
                  </select>,
                )}
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                  Для графика по датам обычно нужны: поле даты, поле значения и расчёт `Сумма` или `Количество`.
                </div>
              </div>
            </div>
          )}

          {draft.widget_type === 'table' && (
            <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <div>
                <div className="text-sm font-semibold">Табличный вид</div>
                <div className="text-xs text-muted-foreground">
                  Настройте, какую колонку и сколько строк показывать.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {field(
                  'Главная колонка',
                  'Основное поле, которое будет видно в таблице.',
                  <select
                    value={cfg.selected_column_ids[0] || ''}
                    onChange={(e) => updateConfig({ selected_column_ids: e.target.value ? [e.target.value] : [] })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Не выбрано</option>
                    {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>,
                )}
                {field(
                  'Сколько строк',
                  'Максимальное число строк в таблице.',
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={cfg.limit}
                    onChange={(e) => updateConfig({ limit: Number(e.target.value || 10) })}
                    className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    placeholder="Лимит строк"
                  />,
                )}
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Фильтры</div>
                <div className="text-xs text-muted-foreground">
                  Ограничьте данные, которые попадут в виджет.
                </div>
              </div>
              <button onClick={addFilter} className="text-sm font-medium text-primary hover:underline">Добавить</button>
            </div>
            {cfg.filters.length === 0 && <p className="text-sm text-muted-foreground">Фильтры не заданы.</p>}
            {cfg.filters.map((f, i) => (
              <div key={i} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background p-3 lg:grid-cols-4">
                <select
                  value={f.column_id}
                  onChange={(e) => {
                    const next = [...cfg.filters]
                    next[i] = { ...f, column_id: e.target.value }
                    updateConfig({ filters: next })
                  }}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
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
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
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
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  placeholder="Значение"
                />
                <button
                  onClick={() => updateConfig({ filters: cfg.filters.filter((_, idx) => idx !== i) })}
                  className="h-10 rounded-lg border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10"
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Итог: {draft.widget_type} • лимит {cfg.limit}{table ? ` • таблица «${table.name}»` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
