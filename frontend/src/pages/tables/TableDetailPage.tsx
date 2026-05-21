import { isAxiosError } from 'axios'
import { useState, useEffect, useCallback, useRef, useMemo, Component, type ErrorInfo, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { tablesApi, recordsApi, TableInfo, RecordInfo, ColumnInfo, TableViewInfo, RecordFilterItem, CsvImportPreview, CsvImportCommit, RecordHistoryItem, RelationOptionInfo, FormulaPreviewInfo } from '@/lib/api'
import { ArrowLeft, Plus, Loader2, Trash2, X, Check, Type, Hash, Calendar, ToggleLeft, List, Link2, Mail, Phone, FileIcon, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, ChevronLeft, ChevronRight, Pencil, Save, Upload, History, RotateCcw } from 'lucide-react'

const FIELD_TYPES = [
  { value: 'text', label: 'Текст', icon: Type },
  { value: 'number', label: 'Число', icon: Hash },
  { value: 'date', label: 'Дата', icon: Calendar },
  { value: 'datetime', label: 'Дата и время', icon: Calendar },
  { value: 'boolean', label: 'Да/Нет', icon: ToggleLeft },
  { value: 'select', label: 'Список', icon: List },
  { value: 'multi_select', label: 'Несколько из списка', icon: List },
  { value: 'url', label: 'URL', icon: Link2 },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'phone', label: 'Телефон', icon: Phone },
  { value: 'file', label: 'Файл', icon: FileIcon },
  { value: 'relation', label: 'Связь', icon: Link2 },
  { value: 'lookup', label: 'Lookup', icon: Search },
  { value: 'rollup', label: 'Rollup', icon: Hash },
  { value: 'formula', label: 'Формула', icon: Hash },
]
const ftMap = Object.fromEntries(FIELD_TYPES.map(f => [f.value, f]))
type CellValue = string | string[]
const DATA_COLUMN_WIDTH = 240
type FilterOp = 'contains' | 'eq' | 'neq' | 'gt' | 'lt' | 'between' | 'is_empty' | 'in'

function isOptionFieldType(fieldType: string) {
  return fieldType === 'select' || fieldType === 'multi_select'
}

function getColumnOptions(column: ColumnInfo | null | undefined): string[] {
  const raw = column?.config && typeof column.config === 'object'
    ? (column.config as { options?: unknown }).options
    : undefined
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function optionsToMultiline(options: string[]) {
  return options.join('\n')
}

function parseOptionsText(value: string) {
  return Array.from(new Set(
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  ))
}

function relationConfigFromColumn(column: ColumnInfo | null | undefined): { related_table_id: string; multiple: boolean; related_column_id?: string } | null {
  const cfg = column?.config
  if (!cfg || typeof cfg !== 'object') return null
  const relatedTableId = String((cfg as Record<string, unknown>).related_table_id || '').trim()
  if (!relatedTableId) return null
  const relatedColumnId = String((cfg as Record<string, unknown>).related_column_id || '').trim()
  return {
    related_table_id: relatedTableId,
    multiple: Boolean((cfg as Record<string, unknown>).multiple),
    related_column_id: relatedColumnId || undefined,
  }
}

function lookupOrRollupConfigFromColumn(column: ColumnInfo | null | undefined): { relation_column_id?: string; lookup_column_id?: string; aggregation?: string } {
  const cfg = column?.config
  if (!cfg || typeof cfg !== 'object') return {}
  const relationColumnId = String((cfg as Record<string, unknown>).relation_column_id || '').trim()
  const lookupColumnId = String((cfg as Record<string, unknown>).lookup_column_id || '').trim()
  const aggregation = String((cfg as Record<string, unknown>).aggregation || '').trim()
  return {
    relation_column_id: relationColumnId || undefined,
    lookup_column_id: lookupColumnId || undefined,
    aggregation: aggregation || undefined,
  }
}

function formulaConfigFromColumn(column: ColumnInfo | null | undefined): { expression?: string; result_type?: string } {
  const cfg = column?.config
  if (!cfg || typeof cfg !== 'object') return {}
  const expression = String((cfg as Record<string, unknown>).expression || '').trim()
  const resultType = String((cfg as Record<string, unknown>).result_type || '').trim()
  return {
    expression: expression || undefined,
    result_type: resultType || undefined,
  }
}

function buildColumnConfig(draft: ColumnSettingsDraft) {
  if (isOptionFieldType(draft.type)) {
    const options = parseOptionsText(draft.optionsText)
    return options.length > 0 ? { options } : null
  }
  if (draft.type === 'relation') {
    if (!draft.relatedTableId) return null
    return {
      related_table_id: draft.relatedTableId,
      related_column_id: draft.relatedColumnId || undefined,
      multiple: draft.relationMultiple,
    }
  }
  if (draft.type === 'lookup') {
    if (!draft.relationColumnId || !draft.lookupColumnId) return null
    return {
      relation_column_id: draft.relationColumnId,
      lookup_column_id: draft.lookupColumnId,
    }
  }
  if (draft.type === 'rollup') {
    if (!draft.relationColumnId || !draft.lookupColumnId) return null
    return {
      relation_column_id: draft.relationColumnId,
      lookup_column_id: draft.lookupColumnId,
      aggregation: draft.rollupAggregation,
    }
  }
  if (draft.type === 'formula') {
    const expression = draft.formulaExpression.trim()
    if (!expression) return null
    return { expression }
  }
  return null
}

function valueAsString(value: unknown) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined) return ''
  return String(value)
}

function valueAsList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function getInputType(ft: string) {
  return ft === 'number' ? 'number' : ft === 'date' ? 'date' : ft === 'datetime' ? 'datetime-local' : ft === 'email' ? 'email' : ft === 'url' ? 'url' : ft === 'phone' ? 'tel' : 'text'
}

function fmtVal(v: unknown, ft: string) {
  if (v === null || v === undefined || v === '') return ''
  if (ft === 'multi_select') {
    const items = valueAsList(v)
    return items.join(', ')
  }
  if (ft === 'boolean') return String(v) === 'true' ? '✓ Да' : '✗ Нет'
  const value = valueAsString(v)
  if (ft === 'date') { try { return new Date(value).toLocaleDateString('ru') } catch { return value } }
  if (ft === 'datetime') { try { return new Date(value).toLocaleString('ru') } catch { return value } }
  return value
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    return error.response?.data?.error?.message || fallback
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

type CsvWizardStep = 'upload' | 'mapping' | 'validate' | 'commit'

function buildInitialCsvMapping(preview: CsvImportPreview, columns: ColumnInfo[]): Record<string, string> {
  const byName = new Map(columns.map((col) => [col.name.trim().toLowerCase(), col.id]))
  const fromPreview = new Map(
    preview.matched_columns
      .filter((item) => item.table_column_id && item.csv_column)
      .map((item) => [String(item.csv_column), String(item.table_column_id)]),
  )
  const mapping: Record<string, string> = {}
  for (const csvColumn of preview.header) {
    const exact = fromPreview.get(csvColumn)
    if (exact) {
      mapping[csvColumn] = exact
      continue
    }
    const byHeader = byName.get(csvColumn.trim().toLowerCase())
    if (byHeader) {
      mapping[csvColumn] = byHeader
    }
  }
  return mapping
}

function actorLabel(actorId: string | null): string {
  if (!actorId) return 'System'
  if (actorId.length <= 12) return actorId
  return `${actorId.slice(0, 8)}…${actorId.slice(-4)}`
}

function OptionConfigEditor({
  value,
  onChange,
  optional = false,
}: {
  value: string
  onChange: (value: string) => void
  optional?: boolean
}) {
  const options = parseOptionsText(value)
  const [draftOption, setDraftOption] = useState('')
  const [bulkMode, setBulkMode] = useState(false)

  const updateOptions = (nextOptions: string[]) => {
    onChange(optionsToMultiline(nextOptions))
  }

  const addOption = () => {
    const next = draftOption.trim()
    if (!next) return
    if (options.includes(next)) {
      setDraftOption('')
      return
    }
    updateOptions([...options, next])
    setDraftOption('')
  }

  const removeOption = (optionToRemove: string) => {
    updateOptions(options.filter((option) => option !== optionToRemove))
  }

  const updateOptionAt = (index: number, nextValue: string) => {
    const normalized = nextValue.trim()
    const nextOptions = [...options]
    if (!normalized) {
      nextOptions.splice(index, 1)
      updateOptions(nextOptions)
      return
    }
    nextOptions[index] = normalized
    updateOptions(Array.from(new Set(nextOptions)))
  }

  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-secondary/20 p-2">
      <div className="text-sm font-medium text-foreground">Какие варианты можно выбрать</div>
      <div className="mt-1 text-xs text-muted-foreground">
        Добавляйте варианты по одному. Например: Новый, В работе, Готово.{optional ? ' Можно заполнить позже.' : ''}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={draftOption}
          onChange={(e) => setDraftOption(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addOption()
            }
          }}
          placeholder="Введите вариант"
          className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={addOption}
          type="button"
          className="h-9 px-3 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 transition-colors"
        >
          Добавить
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {options.length > 0 ? (
          options.map((option, index) => (
            <div key={`${option}-${index}`} className="flex items-center gap-2">
              <input
                value={option}
                onChange={(e) => updateOptionAt(index, e.target.value)}
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => removeOption(option)}
                type="button"
                className="h-9 w-9 rounded-lg border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 hover:bg-destructive/5 transition-colors flex items-center justify-center"
                title="Удалить вариант"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            Пока нет ни одного варианта.
          </div>
        )}
      </div>

      <div className="mt-3 flex justify-start">
        <button
          type="button"
          onClick={() => setBulkMode((prev) => !prev)}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          {bulkMode ? 'Скрыть массовый ввод' : 'Вставить сразу несколько'}
        </button>
      </div>

      {bulkMode && (
        <div className="mt-2 rounded-lg border border-border/70 bg-background/50 p-2">
          <div className="text-[11px] font-medium text-foreground">Массовый ввод</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Вставьте список, по одному варианту на строку.</div>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder={'Новый\nВ работе\nГотово'}
            className="mt-2 w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  )
}

function EditableCell({
  value,
  column,
  relationOptions,
  onSave,
}: {
  value: unknown
  column: ColumnInfo
  relationOptions?: RelationOptionInfo[]
  onSave: (v: CellValue) => void
}) {
  const fieldType = column.field_type
  const options = getColumnOptions(column)
  const relationCfg = relationConfigFromColumn(column)
  const relationMultiple = Boolean(relationCfg?.multiple)
  const relationChoices = relationOptions || []
  const relationLabelById = useMemo(() => Object.fromEntries(relationChoices.map((o) => [o.id, o.label])), [relationChoices])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(valueAsString(value))
  const [multiDraft, setMultiDraft] = useState<string[]>(valueAsList(value))
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(false)
  useEffect(() => {
    setDraft(valueAsString(value))
    setMultiDraft(valueAsList(value))
  }, [value])
  useEffect(() => { if (editing) { committed.current = false; ref.current?.focus() } }, [editing])
  const commit = () => {
    if (committed.current) return
    committed.current = true
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  const toggleMultiDraft = (option: string) => {
    setMultiDraft((prev) => prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option])
  }

  const submitMulti = () => {
    committed.current = true
    setEditing(false)
    const current = valueAsList(value)
    if (JSON.stringify(current) !== JSON.stringify(multiDraft)) {
      onSave(multiDraft)
    }
  }

  if (fieldType === 'boolean') {
    const on = String(value) === 'true'
    return <button onClick={() => onSave(String(!on))} className={`h-6 w-11 rounded-full flex items-center px-0.5 transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} /></button>
  }
  if (fieldType === 'lookup' || fieldType === 'rollup' || fieldType === 'formula') {
    return <div className="min-h-[28px] w-full overflow-hidden px-1.5 py-1 rounded text-sm text-ellipsis whitespace-nowrap">{value ? fmtVal(value, fieldType) : <span className="text-muted-foreground/30 italic">—</span>}</div>
  }
  if (fieldType === 'relation') {
    const selectedIds = relationMultiple ? valueAsList(value) : (valueAsString(value) ? [valueAsString(value)] : [])
    const selectedLabels = selectedIds.map((id) => relationLabelById[id] || id).filter(Boolean)
    if (!editing) {
      return (
        <div
          onClick={() => setEditing(true)}
          className="min-h-[28px] w-full overflow-hidden px-1.5 py-1 rounded cursor-pointer hover:bg-secondary/40 transition-colors text-sm text-ellipsis whitespace-nowrap"
        >
          {selectedLabels.length > 0 ? selectedLabels.join(', ') : <span className="text-muted-foreground/30 italic">Выбрать связь</span>}
        </div>
      )
    }
    if (relationMultiple) {
      return (
        <div className="relative min-h-[28px]">
          <div className="absolute left-0 top-0 z-20 w-[260px] rounded-lg border border-primary/50 bg-background p-2 ring-1 ring-primary/20 shadow-xl">
            <div className="max-h-40 overflow-y-auto space-y-1">
              {relationChoices.map((option) => {
                const checked = multiDraft.includes(option.id)
                return (
                  <label key={option.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/40 cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => toggleMultiDraft(option.id)} />
                    <span className="truncate">{option.label}</span>
                  </label>
                )
              })}
            </div>
            <div className="mt-2 flex justify-end gap-1">
              <button
                onClick={() => {
                  committed.current = true
                  setEditing(false)
                  onSave(multiDraft)
                }}
                className="h-7 px-2 rounded bg-primary text-white text-xs hover:bg-primary/90"
              >
                Готово
              </button>
              <button onClick={() => { setMultiDraft(valueAsList(value)); setEditing(false) }} className="h-7 px-2 rounded text-xs text-muted-foreground hover:bg-secondary">Отмена</button>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="relative min-h-[28px]">
        <div className="absolute left-0 top-0 z-20 w-[240px] rounded-lg border border-primary/50 bg-background p-2 shadow-xl ring-1 ring-primary/20">
          <select
            autoFocus
            value={draft}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              committed.current = true
              setDraft(e.target.value)
              setEditing(false)
              onSave(e.target.value)
            }}
            className="w-full h-8 rounded border border-input bg-background px-2 text-sm outline-none"
          >
            <option value="">— без связи —</option>
            {relationChoices.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>
      </div>
    )
  }
  if (fieldType === 'select' && options.length > 0) {
    if (!editing) return <div onClick={() => setEditing(true)} className="min-h-[28px] w-full overflow-hidden px-1.5 py-1 rounded cursor-pointer hover:bg-secondary/40 transition-colors text-sm text-ellipsis whitespace-nowrap">{draft ? fmtVal(value, fieldType) : <span className="text-muted-foreground/30 italic">Выбрать</span>}</div>
    return (
      <div className="relative min-h-[28px]">
        <div className="absolute left-0 top-0 z-20 w-[220px] rounded-lg border border-primary/50 bg-background p-2 shadow-xl ring-1 ring-primary/20">
          <select
            autoFocus
            value={draft}
            onBlur={() => setEditing(false)}
            onChange={(e) => {
              committed.current = true
              setDraft(e.target.value)
              setEditing(false)
              if (e.target.value !== valueAsString(value)) {
                onSave(e.target.value)
              }
            }}
            className="w-full h-8 rounded border border-input bg-background px-2 text-sm outline-none"
          >
            <option value="">Выберите значение</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
      </div>
    )
  }
  if (fieldType === 'multi_select' && options.length > 0) {
    if (!editing) return <div onClick={() => setEditing(true)} className="min-h-[28px] w-full overflow-hidden px-1.5 py-1 rounded cursor-pointer hover:bg-secondary/40 transition-colors text-sm text-ellipsis whitespace-nowrap">{multiDraft.length > 0 ? multiDraft.join(', ') : <span className="text-muted-foreground/30 italic">Выбрать</span>}</div>
    return (
      <div className="relative min-h-[28px]">
        <div className="absolute left-0 top-0 z-20 w-[260px] rounded-lg border border-primary/50 bg-background p-2 ring-1 ring-primary/20 shadow-xl">
          <div className="max-h-40 overflow-y-auto space-y-1">
            {options.map((option) => {
              const checked = multiDraft.includes(option)
              return (
                <label key={option} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-secondary/40 cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggleMultiDraft(option)} />
                  <span>{option}</span>
                </label>
              )
            })}
          </div>
          <div className="mt-2 flex justify-end gap-1">
            <button onClick={submitMulti} className="h-7 px-2 rounded bg-primary text-white text-xs hover:bg-primary/90">Готово</button>
            <button onClick={() => { setMultiDraft(valueAsList(value)); setEditing(false) }} className="h-7 px-2 rounded text-xs text-muted-foreground hover:bg-secondary">Отмена</button>
          </div>
        </div>
      </div>
    )
  }
  if (!editing) return <div onClick={() => setEditing(true)} className="min-h-[28px] w-full overflow-hidden px-1.5 py-1 rounded cursor-text hover:bg-secondary/40 transition-colors text-sm text-ellipsis whitespace-nowrap">{value ? fmtVal(value, fieldType) : <span className="text-muted-foreground/30 italic">—</span>}</div>
  return <input ref={ref} type={getInputType(fieldType)} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { setDraft(valueAsString(value)); setEditing(false) } }} className="w-full min-w-0 h-7 px-1.5 text-sm rounded border border-primary/50 bg-background outline-none ring-1 ring-primary/20" />
}

function AddColHeader({ onOpen }: { onOpen: () => void }) {
  return (
    <th className="px-2 py-2.5 w-10">
      <button onClick={onOpen} title="Добавить поле" className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
        <Plus className="h-4 w-4" />
      </button>
    </th>
  )
}

type ColumnSettingsDraft = {
  name: string
  type: string
  optionsText: string
  relatedTableId: string
  relationMultiple: boolean
  relatedColumnId: string
  relationColumnId: string
  lookupColumnId: string
  rollupAggregation: 'count' | 'sum' | 'avg' | 'min' | 'max'
  formulaExpression: string
}

function emptyColumnDraft(): ColumnSettingsDraft {
  return {
    name: '',
    type: 'text',
    optionsText: '',
    relatedTableId: '',
    relationMultiple: false,
    relatedColumnId: '',
    relationColumnId: '',
    lookupColumnId: '',
    rollupAggregation: 'count',
    formulaExpression: '',
  }
}

function ColumnSettingsModal({
  open,
  title,
  submitLabel,
  draft,
  optionsOpen,
  saving,
  allTables,
  currentTableId,
  currentColumns,
  onDraftChange,
  onToggleOptions,
  formulaPreview,
  formulaPreviewLoading,
  onPreviewFormula,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  submitLabel: string
  draft: ColumnSettingsDraft
  optionsOpen: boolean
  saving: boolean
  allTables: TableInfo[]
  currentTableId: string
  currentColumns: ColumnInfo[]
  onDraftChange: (patch: Partial<ColumnSettingsDraft>) => void
  onToggleOptions: () => void
  formulaPreview: FormulaPreviewInfo | null
  formulaPreviewLoading: boolean
  onPreviewFormula: () => void
  onClose: () => void
  onSubmit: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const optionsEnabled = isOptionFieldType(draft.type)
  const optionsCount = parseOptionsText(draft.optionsText).length
  const relationColumns = currentColumns.filter((col) => col.field_type === 'relation')
  const relationTableOptions = allTables.filter((tbl) => tbl.id !== currentTableId)
  const selectedRelationColumn = relationColumns.find((col) => col.id === draft.relationColumnId) || null
  const selectedRelationConfig = relationConfigFromColumn(selectedRelationColumn)
  const lookupTargetTableId = draft.type === 'relation'
    ? draft.relatedTableId
    : (selectedRelationConfig?.related_table_id || '')
  const lookupTargetTable = allTables.find((tbl) => tbl.id === lookupTargetTableId) || null
  const lookupTargetColumns = lookupTargetTable?.columns || []
  const canSubmit = Boolean(draft.name.trim() && (draft.type !== 'formula' || draft.formulaExpression.trim()))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="Закрыть окно настроек поля" />
      <div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-background p-5 shadow-2xl">
        <div className="text-xl font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">Изменения применятся сразу после сохранения.</div>
        <div className="mt-5 space-y-4">
          <label className="block">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Название поля</div>
            <input
              ref={inputRef}
              value={draft.name}
              onChange={(e) => onDraftChange({ name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draft.name.trim()) onSubmit()
                if (e.key === 'Escape') onClose()
              }}
              placeholder="Например: Статус"
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Тип поля</div>
            <select
              value={draft.type}
              onChange={(e) => onDraftChange({ type: e.target.value })}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {FIELD_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          {optionsEnabled && (
            <div className="rounded-xl border border-border bg-secondary/15 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Значения списка</div>
                  <div className="text-xs text-muted-foreground">
                    {optionsCount > 0 ? `${optionsCount} значений` : 'Можно добавить сейчас или позже'}
                  </div>
                </div>
                <button onClick={onToggleOptions} className="h-8 px-3 rounded-lg text-sm text-primary hover:bg-primary/10 transition-colors">
                  {optionsOpen ? 'Скрыть' : 'Изменить'}
                </button>
              </div>
              {optionsOpen && (
                <OptionConfigEditor value={draft.optionsText} onChange={(value) => onDraftChange({ optionsText: value })} optional />
              )}
            </div>
          )}
          {draft.type === 'relation' && (
            <div className="rounded-xl border border-border bg-secondary/15 p-3 space-y-3">
              <div className="text-sm font-medium text-foreground">Настройки связи</div>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Связанная таблица</div>
                <select
                  value={draft.relatedTableId}
                  onChange={(e) => onDraftChange({ relatedTableId: e.target.value, relatedColumnId: '' })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">— выберите таблицу —</option>
                  {relationTableOptions.map((tbl) => (
                    <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Колонка отображения (опционально)</div>
                <select
                  value={draft.relatedColumnId}
                  onChange={(e) => onDraftChange({ relatedColumnId: e.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">Primary колонка</option>
                  {lookupTargetColumns.map((col) => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.relationMultiple}
                  onChange={(e) => onDraftChange({ relationMultiple: e.target.checked })}
                />
                <span>Разрешить несколько связанных записей</span>
              </label>
            </div>
          )}
          {draft.type === 'lookup' && (
            <div className="rounded-xl border border-border bg-secondary/15 p-3 space-y-3">
              <div className="text-sm font-medium text-foreground">Настройки Lookup</div>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Relation-колонка</div>
                <select
                  value={draft.relationColumnId}
                  onChange={(e) => onDraftChange({ relationColumnId: e.target.value, lookupColumnId: '' })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">— выберите relation-колонку —</option>
                  {relationColumns.map((col) => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Lookup-колонка</div>
                <select
                  value={draft.lookupColumnId}
                  onChange={(e) => onDraftChange({ lookupColumnId: e.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">— выберите колонку —</option>
                  {lookupTargetColumns.map((col) => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {draft.type === 'rollup' && (
            <div className="rounded-xl border border-border bg-secondary/15 p-3 space-y-3">
              <div className="text-sm font-medium text-foreground">Настройки Rollup</div>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Relation-колонка</div>
                <select
                  value={draft.relationColumnId}
                  onChange={(e) => onDraftChange({ relationColumnId: e.target.value, lookupColumnId: '' })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">— выберите relation-колонку —</option>
                  {relationColumns.map((col) => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Колонка для агрегирования</div>
                <select
                  value={draft.lookupColumnId}
                  onChange={(e) => onDraftChange({ lookupColumnId: e.target.value })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">— выберите колонку —</option>
                  {lookupTargetColumns.map((col) => (
                    <option key={col.id} value={col.id}>{col.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Агрегация</div>
                <select
                  value={draft.rollupAggregation}
                  onChange={(e) => onDraftChange({ rollupAggregation: (e.target.value as ColumnSettingsDraft['rollupAggregation']) })}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="count">count</option>
                  <option value="sum">sum</option>
                  <option value="avg">avg</option>
                  <option value="min">min</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>
          )}
          {draft.type === 'formula' && (
            <div className="rounded-xl border border-border bg-secondary/15 p-3 space-y-3">
              <div className="text-sm font-medium text-foreground">Настройки Formula</div>
              <label className="block">
                <div className="mb-2 text-xs font-medium text-muted-foreground">Выражение</div>
                <textarea
                  value={draft.formulaExpression}
                  onChange={(e) => onDraftChange({ formulaExpression: e.target.value })}
                  rows={4}
                  placeholder={'IF(GT({column_id}, 100), "High", "Low")'}
                  className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPreviewFormula}
                  disabled={formulaPreviewLoading || !draft.formulaExpression.trim()}
                  className="h-9 px-3 rounded-lg border border-border text-sm text-foreground hover:bg-secondary disabled:opacity-50 transition-colors"
                >
                  {formulaPreviewLoading ? 'Проверка...' : 'Live preview'}
                </button>
                <div className="text-xs text-muted-foreground">Поддержка: IF, CONCAT, DATE_DIFF, ROUND</div>
              </div>
              {formulaPreview && (
                <div className={`rounded-lg border p-3 text-xs ${formulaPreview.is_valid ? 'border-emerald-300/50 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
                  <div className="font-medium">
                    {formulaPreview.is_valid ? 'Формула валидна' : 'Ошибка формулы'}
                  </div>
                  {formulaPreview.error ? (
                    <div className="mt-1 text-destructive">{formulaPreview.error}</div>
                  ) : (
                    <div className="mt-1 text-foreground">Preview: {valueAsString(formulaPreview.value_preview)}</div>
                  )}
                  {formulaPreview.warnings.length > 0 && (
                    <div className="mt-1 text-amber-500">{formulaPreview.warnings.join(' • ')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors">
            Отмена
          </button>
          <button onClick={onSubmit} disabled={saving || !canSubmit} className="h-10 px-5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? 'Сохранение...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 50
type PageErrorBoundaryState = {
  hasError: boolean
  message: string
}

class PageErrorBoundary extends Component<{ children: ReactNode }, PageErrorBoundaryState> {
  state: PageErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unknown render error' }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Keep full stack/details in browser console for debugging.
    console.error('TableDetailPage render error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Ошибка рендера таблицы: {this.state.message}
        </div>
      )
    }
    return this.props.children
  }
}

function safeRecordData(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
}

function isColumnInfo(value: unknown): value is ColumnInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ColumnInfo>
  return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.field_type === 'string' && typeof v.position === 'number'
}

function isRecordInfo(value: unknown): value is RecordInfo {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<RecordInfo>
  return typeof v.id === 'string' && typeof v.table_id === 'string'
}

function TableDetailPageContent() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()
  const [table, setTable] = useState<TableInfo | null>(null)
  const [records, setRecords] = useState<RecordInfo[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  const [addingRecord, setAddingRecord] = useState(false)
  const [newRowData, setNewRowData] = useState<Record<string, unknown>>({})
  const [showNewRow, setShowNewRow] = useState(false)
  // Search / filter / sort / pagination
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterCol, setFilterCol] = useState<string>('')
  const [filterOp, setFilterOp] = useState<FilterOp>('contains')
  const [filterVal, setFilterVal] = useState<string>('')
  const [filterValTo, setFilterValTo] = useState<string>('')
  const [showFilter, setShowFilter] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [page, setPage] = useState(0)
  const [columnDialog, setColumnDialog] = useState<{ mode: 'create' } | { mode: 'edit'; columnId: string } | null>(null)
  const [columnDraft, setColumnDraft] = useState<ColumnSettingsDraft>(emptyColumnDraft())
  const [columnOptionsOpen, setColumnOptionsOpen] = useState(false)
  const [formulaPreview, setFormulaPreview] = useState<FormulaPreviewInfo | null>(null)
  const [formulaPreviewLoading, setFormulaPreviewLoading] = useState(false)
  const [savingColumn, setSavingColumn] = useState(false)
  const [movingRecordId, setMovingRecordId] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const [views, setViews] = useState<TableViewInfo[]>([])
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set())
  const [bulkColumnId, setBulkColumnId] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const [importing, setImporting] = useState(false)
  const [csvWizardOpen, setCsvWizardOpen] = useState(false)
  const [csvWizardStep, setCsvWizardStep] = useState<CsvWizardStep>('upload')
  const [csvWizardMode, setCsvWizardMode] = useState<'append' | 'replace'>('append')
  const [csvWizardFile, setCsvWizardFile] = useState<File | null>(null)
  const [csvWizardPreview, setCsvWizardPreview] = useState<CsvImportPreview | null>(null)
  const [csvWizardMapping, setCsvWizardMapping] = useState<Record<string, string>>({})
  const [csvWizardStrict, setCsvWizardStrict] = useState(false)
  const [csvWizardCommit, setCsvWizardCommit] = useState<CsvImportCommit | null>(null)
  const [csvWizardError, setCsvWizardError] = useState('')
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null)
  const [historyItems, setHistoryItems] = useState<RecordHistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [rollingBackRecordId, setRollingBackRecordId] = useState<string | null>(null)
  const [tablesCatalog, setTablesCatalog] = useState<TableInfo[]>([])
  const [relationOptionsByColumn, setRelationOptionsByColumn] = useState<Record<string, RelationOptionInfo[]>>({})
  const csvWizardFileInputRef = useRef<HTMLInputElement>(null)
  const moveLockRef = useRef(false)

  const allColumns = useMemo(
    () => (Array.isArray(table?.columns) ? table.columns : []).filter(isColumnInfo).sort((a, b) => a.position - b.position),
    [table],
  )

  const buildFilterPayload = useCallback((): RecordFilterItem[] => {
    if (!filterCol) return []
    if (filterOp === 'is_empty') {
      return [{ col_id: filterCol, op: 'is_empty' }]
    }
    if (filterOp === 'between') {
      if (!filterVal.trim() || !filterValTo.trim()) return []
      return [{ col_id: filterCol, op: 'between', value: { from: filterVal.trim(), to: filterValTo.trim() } }]
    }
    if (filterOp === 'in') {
      const items = filterVal
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      if (items.length === 0) return []
      return [{ col_id: filterCol, op: 'in', value: items }]
    }
    if (!filterVal.trim()) return []
    return [{ col_id: filterCol, op: filterOp, value: filterVal.trim() }]
  }, [filterCol, filterOp, filterVal, filterValTo])

  const loadTablesCatalog = useCallback(async () => {
    try {
      const resp = await tablesApi.list()
      if (resp.data.ok && Array.isArray(resp.data.data)) {
        setTablesCatalog(resp.data.data)
      } else {
        setTablesCatalog([])
      }
    } catch {
      setTablesCatalog([])
    }
  }, [])

  const loadRelationOptionsForTable = useCallback(async (tableValue: TableInfo) => {
    if (!tableId) {
      setRelationOptionsByColumn({})
      return
    }
    const relationCols = (tableValue.columns || []).filter((col) => col.field_type === 'relation')
    if (relationCols.length === 0) {
      setRelationOptionsByColumn({})
      return
    }
    const entries = await Promise.all(relationCols.map(async (col) => {
      try {
        const resp = await tablesApi.relationOptions(tableId, col.id, { limit: 200 })
        const options = resp.data.ok && Array.isArray(resp.data.data) ? resp.data.data : []
        return [col.id, options] as const
      } catch {
        return [col.id, []] as const
      }
    }))
    setRelationOptionsByColumn(Object.fromEntries(entries))
  }, [tableId])

  const loadViews = useCallback(async () => {
    if (!tableId) return
    try {
      const resp = await tablesApi.listViews(tableId)
      if (resp.data.ok && Array.isArray(resp.data.data)) {
        setViews(resp.data.data)
      }
    } catch {
      setViews([])
    }
  }, [tableId])

  const loadMeta = useCallback(async () => {
    if (!tableId) return
    setLoading(true)
    setLoadError(false)
    setTable(null)
    setRecords([])
    setTotal(0)
    setSearch('')
    setSortCol(null)
    setSortDir('asc')
    setFilterCol('')
    setFilterOp('contains')
    setFilterVal('')
    setFilterValTo('')
    setPage(0)
    setShowNewRow(false)
    setSelectedRecordIds(new Set())
    setCsvWizardOpen(false)
    setCsvWizardStep('upload')
    setCsvWizardFile(null)
    setCsvWizardPreview(null)
    setCsvWizardMapping({})
    setCsvWizardCommit(null)
    setCsvWizardError('')
    setHistoryRecordId(null)
    setHistoryItems([])
    setHistoryTotal(0)
    setRelationOptionsByColumn({})
    try {
      await loadTablesCatalog()
      const tR = await tablesApi.get(tableId)
      if (!tR.data.ok || !tR.data.data) {
        setLoadError(true)
        return
      }
      setTable(tR.data.data)
      await loadRelationOptionsForTable(tR.data.data)
      await loadViews()
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [tableId, loadRelationOptionsForTable, loadTablesCatalog, loadViews])

  const loadRecords = useCallback(async () => {
    if (!tableId) return
    const payload = {
      search: search.trim() || undefined,
      filters: buildFilterPayload(),
      sorts: sortCol ? [{ col_id: sortCol, dir: sortDir }] : [],
    }
    try {
      const resp = await recordsApi.filter(tableId, payload, PAGE_SIZE, page * PAGE_SIZE)
      if (resp.data.ok && resp.data.data) {
        const normalized = (resp.data.data.records ?? [])
          .filter(isRecordInfo)
          .map((r) => ({ ...r, data: safeRecordData(r.data) }))
        setRecords(normalized)
        setTotal(typeof resp.data.data.total === 'number' ? resp.data.data.total : normalized.length)
      } else {
        setRecords([])
        setTotal(0)
      }
    } catch {
      setRecords([])
      setTotal(0)
    }
  }, [tableId, search, buildFilterPayload, sortCol, sortDir, page])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => {
    if (!tableId || loadError) return
    void loadRecords()
  }, [tableId, loadError, loadRecords])

  const closeColumnDialog = () => {
    setColumnDialog(null)
    setColumnDraft(emptyColumnDraft())
    setColumnOptionsOpen(false)
    setFormulaPreview(null)
    setFormulaPreviewLoading(false)
    setSavingColumn(false)
  }

  const openCreateColumnDialog = () => {
    setColumnDialog({ mode: 'create' })
    setColumnDraft(emptyColumnDraft())
    setColumnOptionsOpen(false)
    setFormulaPreview(null)
    setFormulaPreviewLoading(false)
  }

  const openEditColumnDialog = (col: ColumnInfo) => {
    const relationCfg = relationConfigFromColumn(col)
    const lookupCfg = lookupOrRollupConfigFromColumn(col)
    const formulaCfg = formulaConfigFromColumn(col)
    setColumnDialog({ mode: 'edit', columnId: col.id })
    setColumnDraft({
      name: col.name,
      type: col.field_type,
      optionsText: optionsToMultiline(getColumnOptions(col)),
      relatedTableId: relationCfg?.related_table_id || '',
      relationMultiple: relationCfg?.multiple || false,
      relatedColumnId: relationCfg?.related_column_id || '',
      relationColumnId: lookupCfg.relation_column_id || '',
      lookupColumnId: lookupCfg.lookup_column_id || '',
      rollupAggregation: (lookupCfg.aggregation as ColumnSettingsDraft['rollupAggregation']) || 'count',
      formulaExpression: formulaCfg.expression || '',
    })
    setColumnOptionsOpen(false)
    setFormulaPreview(null)
    setFormulaPreviewLoading(false)
  }

  const updateColumnDraft = (patch: Partial<ColumnSettingsDraft>) => {
    const nextType = patch.type ?? columnDraft.type
    if ('type' in patch && !isOptionFieldType(nextType)) {
      setColumnOptionsOpen(false)
    }
    if ('type' in patch || 'formulaExpression' in patch) {
      setFormulaPreview(null)
    }
    setColumnDraft((prev) => {
      const next = { ...prev, ...patch }
      if (patch.type && patch.type !== prev.type) {
        if (patch.type !== 'relation') {
          next.relatedTableId = ''
          next.relationMultiple = false
          next.relatedColumnId = ''
        }
        if (patch.type !== 'lookup' && patch.type !== 'rollup') {
          next.relationColumnId = ''
          next.lookupColumnId = ''
          next.rollupAggregation = 'count'
        }
        if (patch.type !== 'formula') {
          next.formulaExpression = ''
        }
      }
      return next
    })
  }

  const handlePreviewFormula = async () => {
    if (!tableId || columnDraft.type !== 'formula') return
    const expression = columnDraft.formulaExpression.trim()
    if (!expression) return
    setFormulaPreviewLoading(true)
    try {
      const sampleRow = records[0] ? safeRecordData(records[0].data) : undefined
      const resp = await tablesApi.previewFormula(tableId, { expression, sample_row: sampleRow })
      if (resp.data.ok && resp.data.data) {
        setFormulaPreview(resp.data.data)
      } else {
        setFormulaPreview({
          expression,
          referenced_column_ids: [],
          value_preview: null,
          warnings: [],
          is_valid: false,
          error: resp.data.error?.message || 'Не удалось провалидировать формулу',
        })
      }
    } catch (error) {
      setFormulaPreview({
        expression,
        referenced_column_ids: [],
        value_preview: null,
        warnings: [],
        is_valid: false,
        error: getRequestErrorMessage(error, 'Не удалось провалидировать формулу'),
      })
    } finally {
      setFormulaPreviewLoading(false)
    }
  }

  const submitColumnDialog = async () => {
    if (!tableId || !columnDialog || !columnDraft.name.trim()) return
    if (columnDraft.type === 'formula' && !columnDraft.formulaExpression.trim()) return
    setSavingColumn(true)
    try {
      const payload = {
        name: columnDraft.name.trim(),
        field_type: columnDraft.type,
        config: buildColumnConfig(columnDraft),
      }
      if (columnDialog.mode === 'create') {
        await tablesApi.createColumn(tableId, payload)
      } else {
        await tablesApi.updateColumn(tableId, columnDialog.columnId, payload)
      }
      closeColumnDialog()
      await loadMeta()
    } finally {
      setSavingColumn(false)
    }
  }

  const handleDeleteColumn = async (colId: string) => {
    if (!tableId) return
    await tablesApi.deleteColumn(tableId, colId)
    await loadMeta()
  }

  const handleAddRecord = async () => {
    if (!tableId) return
    setAddingRecord(true)
    try {
      const resp = await recordsApi.create(tableId, newRowData)
      if (resp.data.ok && resp.data.data) {
        setNewRowData({})
        setShowNewRow(false)
        await loadRecords()
      }
    } catch { /* ignore */ }
    setAddingRecord(false)
  }

  const handleQuickAddRecord = async () => {
    if (!tableId || addingRecord) return
    setAddingRecord(true)
    try {
      const resp = await recordsApi.create(tableId, {})
      if (resp.data.ok && resp.data.data) {
        await loadRecords()
      }
    } catch { /* ignore */ }
    setAddingRecord(false)
  }

  const handleCellSave = async (recordId: string, colId: string, value: CellValue) => {
    if (!tableId) return
    const key = `${recordId}-${colId}`
    const previousRecord = records.find((r) => r.id === recordId) || null
    if (!previousRecord) return
    setSaveError('')
    // Optimistic update — immediately reflect in UI
    setRecords(prev =>
      prev.map(r =>
        r.id === recordId ? { ...r, data: { ...safeRecordData(r.data), [colId]: value } } : r,
      ),
    )
    setSavingCells(prev => new Set(prev).add(key))
    try {
      const resp = await recordsApi.update(tableId, recordId, { [colId]: value }, previousRecord.updated_at)
      if (resp.data.ok && resp.data.data) {
        setRecords(prev => prev.map(r => r.id === recordId ? resp.data.data! : r))
      }
    } catch (error) {
      setRecords(prev => prev.map(r => r.id === recordId ? previousRecord : r))
      setSaveError(getRequestErrorMessage(error, 'Не удалось сохранить ячейку'))
      try {
        await loadRecords()
      } catch {
        // leave local rollback state if refresh fails
      }
    }
    setSavingCells(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  const handleDeleteRecord = async (recordId: string) => {
    if (!tableId) return
    await recordsApi.delete(tableId, recordId)
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      next.delete(recordId)
      return next
    })
    await loadRecords()
  }

  const handleMoveRecord = async (recordId: string, direction: 'up' | 'down') => {
    if (!tableId) return
    if (moveLockRef.current) return
    moveLockRef.current = true
    const before = records
    const currentIdx = before.findIndex(r => r.id === recordId)
    if (currentIdx === -1) return
    const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1
    if (targetIdx < 0 || targetIdx >= before.length) return

    // Optimistic UI: reorder instantly, so user sees movement without refresh.
    const optimistic = [...before]
    const a = optimistic[currentIdx]
    const b = optimistic[targetIdx]
    if (!a || !b) return
    ;[optimistic[currentIdx], optimistic[targetIdx]] = [b, a]
    setRecords(optimistic)

    setMovingRecordId(recordId)
    try {
      const resp = await recordsApi.move(tableId, recordId, direction)
      if (!resp.data.ok) {
        // Rollback if backend rejected move.
        setRecords(before)
        return
      }

      // Final sync to guarantee strict order from server without manual refresh.
      await loadRecords()
    } catch {
      setRecords(before)
    } finally {
      setMovingRecordId(null)
      moveLockRef.current = false
    }
  }

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!tableId) return
    setExporting(format)
    try {
      const resp = format === 'csv'
        ? await recordsApi.exportCsv(tableId)
        : await recordsApi.exportXlsx(tableId)
      const ext = format === 'csv' ? 'csv' : 'xlsx'
      const safeName = (table?.name || 'table').replace(/[\\/:*?"<>|]+/g, '_')
      triggerBlobDownload(resp.data, `${safeName}.${ext}`)
    } catch {
      // ignore
    } finally {
      setExporting(null)
    }
  }

  const columns = allColumns
  const columnNameById = useMemo(
    () => Object.fromEntries(columns.map((col) => [col.id, col.name])),
    [columns],
  )
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pagedRecords = records
  const canManualReorder = !search.trim() && !filterCol && !sortCol && page === 0 && total <= PAGE_SIZE

  const handleSort = (colId: string) => {
    if (sortCol === colId) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') }
    } else {
      setSortCol(colId); setSortDir('asc')
    }
    setPage(0)
  }

  const saveCurrentView = async () => {
    if (!tableId) return
    const name = window.prompt('Название представления')
    if (!name || !name.trim()) return
    const payload = {
      name: name.trim(),
      view_type: 'grid',
      filters: buildFilterPayload(),
      sorts: sortCol ? [{ col_id: sortCol, dir: sortDir }] : [],
      config: { search: search.trim() || '' },
    }
    await tablesApi.createView(tableId, payload)
    await loadViews()
  }

  const applyView = useCallback((view: TableViewInfo) => {
    const config = (view.config || {}) as Record<string, unknown>
    const savedSearch = typeof config.search === 'string' ? config.search : ''
    setSearch(savedSearch)

    const sortItems = Array.isArray(view.sorts) ? view.sorts : []
    const firstSort = sortItems.find((item) => item && typeof item === 'object') as { col_id?: string; dir?: 'asc' | 'desc' } | undefined
    if (firstSort?.col_id) {
      setSortCol(firstSort.col_id)
      setSortDir(firstSort.dir === 'desc' ? 'desc' : 'asc')
    } else {
      setSortCol(null)
      setSortDir('asc')
    }

    const filterItems = Array.isArray(view.filters) ? view.filters : []
    const firstFilter = filterItems.find((item) => item && typeof item === 'object') as { col_id?: string; op?: FilterOp; value?: unknown } | undefined
    if (firstFilter?.col_id) {
      setFilterCol(firstFilter.col_id)
      setFilterOp(firstFilter.op || 'contains')
      if (firstFilter.op === 'between' && firstFilter.value && typeof firstFilter.value === 'object') {
        const betweenVal = firstFilter.value as { from?: unknown; to?: unknown }
        setFilterVal(String(betweenVal.from ?? ''))
        setFilterValTo(String(betweenVal.to ?? ''))
      } else if (firstFilter.op === 'in' && Array.isArray(firstFilter.value)) {
        setFilterVal(firstFilter.value.map((v) => String(v ?? '')).join(', '))
        setFilterValTo('')
      } else {
        setFilterVal(String(firstFilter.value ?? ''))
        setFilterValTo('')
      }
    } else {
      setFilterCol('')
      setFilterOp('contains')
      setFilterVal('')
      setFilterValTo('')
    }
    setPage(0)
  }, [])

  useEffect(() => {
    const defaultView = views.find((view) => view.is_default)
    if (!defaultView) return
    applyView(defaultView)
  }, [views, applyView])

  const setDefaultView = async (viewId: string) => {
    if (!tableId) return
    await tablesApi.updateView(tableId, viewId, { is_default: true })
    await loadViews()
  }

  const deleteView = async (viewId: string) => {
    if (!tableId) return
    await tablesApi.deleteView(tableId, viewId)
    await loadViews()
  }

  const toggleSelectRecord = (recordId: string, checked: boolean) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(recordId)
      else next.delete(recordId)
      return next
    })
  }

  const toggleSelectAllPageRecords = (checked: boolean) => {
    setSelectedRecordIds((prev) => {
      const next = new Set(prev)
      for (const rec of pagedRecords) {
        if (checked) next.add(rec.id)
        else next.delete(rec.id)
      }
      return next
    })
  }

  const handleBulkDelete = async () => {
    if (!tableId || selectedRecordIds.size === 0) return
    await recordsApi.bulkDelete(tableId, Array.from(selectedRecordIds))
    setSelectedRecordIds(new Set())
    await loadRecords()
  }

  const handleBulkUpdate = async () => {
    if (!tableId || selectedRecordIds.size === 0 || !bulkColumnId) return
    await recordsApi.bulkUpdate(tableId, Array.from(selectedRecordIds), { [bulkColumnId]: bulkValue })
    setSelectedRecordIds(new Set())
    await loadRecords()
  }

  const openCsvWizard = () => {
    setCsvWizardOpen(true)
    setCsvWizardStep('upload')
    setCsvWizardFile(null)
    setCsvWizardPreview(null)
    setCsvWizardCommit(null)
    setCsvWizardMapping({})
    setCsvWizardStrict(false)
    setCsvWizardError('')
  }

  const closeCsvWizard = () => {
    setCsvWizardOpen(false)
    setCsvWizardStep('upload')
    setCsvWizardFile(null)
    setCsvWizardPreview(null)
    setCsvWizardCommit(null)
    setCsvWizardMapping({})
    setCsvWizardStrict(false)
    setCsvWizardError('')
    setImporting(false)
  }

  const handleCsvWizardFileSelected = async (file: File | null) => {
    if (!file || !tableId) return
    setImporting(true)
    setCsvWizardError('')
    try {
      const resp = await recordsApi.previewImportCsv(tableId, file, csvWizardMode)
      if (resp.data.ok && resp.data.data) {
        setCsvWizardFile(file)
        setCsvWizardPreview(resp.data.data)
        setCsvWizardMapping(buildInitialCsvMapping(resp.data.data, columns))
        setCsvWizardCommit(null)
        setCsvWizardStep('mapping')
      } else {
        setCsvWizardError(resp.data.error?.message || 'Не удалось прочитать CSV')
      }
    } catch (error) {
      setCsvWizardError(getRequestErrorMessage(error, 'Не удалось прочитать CSV'))
    } finally {
      setImporting(false)
      if (csvWizardFileInputRef.current) csvWizardFileInputRef.current.value = ''
    }
  }

  const handleCsvWizardValidate = async () => {
    if (!tableId || !csvWizardFile) return
    setImporting(true)
    setCsvWizardError('')
    try {
      const resp = await recordsApi.previewImportCsv(tableId, csvWizardFile, csvWizardMode, csvWizardMapping)
      if (resp.data.ok && resp.data.data) {
        setCsvWizardPreview(resp.data.data)
        setCsvWizardStep('validate')
      } else {
        setCsvWizardError(resp.data.error?.message || 'Ошибка валидации CSV')
      }
    } catch (error) {
      setCsvWizardError(getRequestErrorMessage(error, 'Ошибка валидации CSV'))
    } finally {
      setImporting(false)
    }
  }

  const handleCsvWizardCommit = async () => {
    if (!tableId || !csvWizardFile) return
    setImporting(true)
    setCsvWizardError('')
    try {
      const resp = await recordsApi.commitImportCsv(
        tableId,
        csvWizardFile,
        csvWizardMode,
        csvWizardStrict,
        csvWizardMapping,
      )
      if (resp.data.ok && resp.data.data) {
        setCsvWizardCommit(resp.data.data)
        setCsvWizardStep('commit')
        setPage(0)
        await loadRecords()
      } else {
        setCsvWizardError(resp.data.error?.message || 'Не удалось выполнить импорт')
      }
    } catch (error) {
      setCsvWizardError(getRequestErrorMessage(error, 'Не удалось выполнить импорт'))
    } finally {
      setImporting(false)
    }
  }

  const handleOpenHistory = async (recordId: string) => {
    if (!tableId) return
    setHistoryRecordId(recordId)
    setHistoryLoading(true)
    try {
      const resp = await recordsApi.listHistory(tableId, recordId, 30, 0)
      if (resp.data.ok && resp.data.data) {
        setHistoryItems(resp.data.data.items || [])
        setHistoryTotal(resp.data.data.total || 0)
      } else {
        setHistoryItems([])
        setHistoryTotal(0)
      }
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleRollbackLast = async (recordId: string) => {
    if (!tableId) return
    setRollingBackRecordId(recordId)
    try {
      const resp = await recordsApi.rollbackLast(tableId, recordId)
      if (resp.data.ok && resp.data.data) {
        setRecords((prev) => prev.map((r) => (r.id === recordId ? resp.data.data!.record : r)))
        await handleOpenHistory(recordId)
      }
    } finally {
      setRollingBackRecordId(null)
    }
  }

  const getHistoryCellChanges = (item: RecordHistoryItem) => {
    const before = item.before_data || {}
    const after = item.after_data || {}
    const keys = item.changed_columns.length > 0
      ? item.changed_columns
      : Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    return keys.map((colId) => ({
      columnId: colId,
      columnName: columnNameById[colId] || colId,
      beforeValue: before[colId],
      afterValue: after[colId],
    }))
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (loadError || !table) return <div className="text-center py-20 text-muted-foreground"><p>Таблица не найдена</p><Button variant="ghost" className="mt-4" onClick={() => navigate('/tables')}><ArrowLeft className="h-4 w-4 mr-2" /> Назад</Button></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate('/tables')}><ArrowLeft className="h-5 w-5" /></Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{table.name}</h1>
          {table.description && <p className="text-sm text-muted-foreground truncate">{table.description}</p>}
        </div>
        {savingCells.size > 0 && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Сохранение...</span>}
        <Badge variant="secondary">{total} записей</Badge>
        <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('csv')} disabled={exporting !== null}>
          {exporting === 'csv' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
          CSV
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={() => handleExport('xlsx')} disabled={exporting !== null}>
          {exporting === 'xlsx' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
          Excel
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={openCsvWizard} disabled={importing}>
          {importing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
          CSV Wizard
        </Button>
        <Button size="sm" onClick={() => setShowNewRow(v => !v)} className="gradient-primary border-0 text-white h-8">
          {showNewRow ? <><X className="h-4 w-4 mr-1" />Отмена</> : <><Plus className="h-4 w-4 mr-1" />Добавить запись</>}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" className="h-8" onClick={saveCurrentView}>
          <Save className="h-3.5 w-3.5 mr-1" />
          Сохранить вид
        </Button>
        <select
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            const view = views.find((v) => v.id === id)
            if (view) applyView(view)
            e.currentTarget.value = ''
          }}
          defaultValue=""
        >
          <option value="" disabled>Применить вид...</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.is_default ? '★ ' : ''}{view.name}
            </option>
          ))}
        </select>
        {views.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {views.map((view) => (
              <span key={view.id} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1">
                {view.name}
                {!view.is_default && (
                  <button className="hover:text-foreground" onClick={() => setDefaultView(view.id)} title="Сделать по умолчанию">★</button>
                )}
                <button className="hover:text-destructive" onClick={() => deleteView(view.id)} title="Удалить">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* Search + Filter toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs max-md:w-full max-md:min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Поиск по всем полям..."
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={() => { setShowFilter(v => !v); if (showFilter) { setFilterCol(''); setFilterVal(''); setFilterValTo(''); setFilterOp('contains') } }}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-sm transition-colors ${
            filterCol ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Фильтр{filterCol ? ` (${columns.find(c => c.id === filterCol)?.name})` : ''}
        </button>
        {sortCol && (
          <button onClick={() => { setSortCol(null); setSortDir('asc') }} className="flex items-center gap-1 h-8 px-3 rounded-lg border border-primary bg-primary/10 text-primary text-sm">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {columns.find(c => c.id === sortCol)?.name} {sortDir === 'asc' ? '↑' : '↓'}
            <X className="h-3 w-3 ml-0.5" />
          </button>
        )}
        {(search || filterCol) && (
          <button onClick={() => { setSearch(''); setFilterCol(''); setFilterOp('contains'); setFilterVal(''); setFilterValTo(''); setPage(0) }} className="h-8 px-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary">
            Сбросить
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} записей
        </span>
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary/20 max-sm:flex-col max-sm:items-stretch">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Столбец:</span>
          <select
            value={filterCol}
            onChange={e => { setFilterCol(e.target.value); setFilterVal(''); setFilterValTo(''); setPage(0) }}
            className="h-8 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary max-sm:w-full"
          >
            <option value="">— выберите —</option>
            {columns.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}
          </select>
          <span className="text-xs text-muted-foreground whitespace-nowrap">Оператор:</span>
          <select
            value={filterOp}
            onChange={(e) => { setFilterOp(e.target.value as FilterOp); setFilterVal(''); setFilterValTo(''); setPage(0) }}
            className="h-8 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary max-sm:w-full"
          >
            <option value="contains">contains</option>
            <option value="eq">=</option>
            <option value="neq">!=</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="between">between</option>
            <option value="is_empty">is empty</option>
            <option value="in">in</option>
          </select>
          <input
            value={filterVal}
            onChange={e => { setFilterVal(e.target.value); setPage(0) }}
            placeholder="Значение..."
            disabled={!filterCol || filterOp === 'is_empty'}
            className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary disabled:opacity-50 max-sm:w-full"
          />
          {filterOp === 'between' && (
            <input
              value={filterValTo}
              onChange={(e) => { setFilterValTo(e.target.value); setPage(0) }}
              placeholder="И до..."
              disabled={!filterCol}
              className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary disabled:opacity-50 max-sm:w-full"
            />
          )}
        </div>
      )}

      {selectedRecordIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5 max-sm:flex-col max-sm:items-stretch">
          <span className="text-xs text-muted-foreground">{selectedRecordIds.size} выбрано</span>
          <select
            value={bulkColumnId}
            onChange={(e) => setBulkColumnId(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Поле для массового обновления</option>
            {columns.map((col) => <option key={col.id} value={col.id}>{col.name}</option>)}
          </select>
          <input
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="Значение"
            className="h-8 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <Button variant="outline" size="sm" className="h-8" onClick={handleBulkUpdate} disabled={!bulkColumnId}>
            Применить к выбранным
          </Button>
          <Button variant="destructive" size="sm" className="h-8" onClick={handleBulkDelete}>
            Удалить выбранные
          </Button>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="min-w-full max-md:min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-9" />
            <col className="w-10" />
            {columns.map((col: ColumnInfo) => (
              <col key={col.id} style={{ width: `${DATA_COLUMN_WIDTH}px` }} />
            ))}
            <col className="w-10" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-2 py-2.5 w-9">
                <input
                  type="checkbox"
                  checked={pagedRecords.length > 0 && pagedRecords.every((r) => selectedRecordIds.has(r.id))}
                  onChange={(e) => toggleSelectAllPageRecords(e.target.checked)}
                />
              </th>
              <th className="px-3 py-2.5 w-8 text-left text-xs text-muted-foreground font-medium">#</th>
              {columns.map((col: ColumnInfo) => {
                const info = ftMap[col.field_type]
                const Icon = info?.icon || Type
                const isSorted = sortCol === col.id
                const SortIcon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                const isEditing = columnDialog?.mode === 'edit' && columnDialog.columnId === col.id
                return (
                  <th key={col.id} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap group overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 opacity-50" />
                      <button
                        onClick={() => handleSort(col.id)}
                        className={`flex items-center gap-1 hover:text-foreground transition-colors ${
                          isSorted ? 'text-primary' : ''
                        }`}
                      >
                        <span>{col.name}</span>
                        <SortIcon className={`h-3 w-3 ${
                          isSorted ? 'opacity-100' : 'opacity-0 group-hover:opacity-40 max-md:opacity-40'
                        }`} />
                      </button>
                      <button onClick={() => openEditColumnDialog(col)} className={`hover:text-foreground transition-opacity ${isEditing ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 max-md:opacity-100'}`} title="Изменить поле">
                        <Pencil className="h-3 w-3" />
                      </button>
                      {col.is_required && <span className="text-destructive text-xs">*</span>}
                      {!col.is_primary && (
                        <button onClick={() => handleDeleteColumn(col.id)} className="ml-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 hover:text-destructive transition-opacity">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                )
              })}
              <AddColHeader onOpen={openCreateColumnDialog} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {showNewRow && (
              <tr className="border-b border-primary/20 bg-primary/5">
                <td />
                <td className="px-3 py-1.5 text-xs text-muted-foreground">new</td>
                {columns.map((col: ColumnInfo) => (
                  <td key={col.id} className="px-2 py-1.5 overflow-hidden">
                    {col.field_type === 'boolean' ? (
                      <button onClick={() => setNewRowData(prev => ({ ...prev, [col.id]: String(!(prev[col.id] === 'true')) }))} className={`h-6 w-11 rounded-full flex items-center px-0.5 transition-colors ${newRowData[col.id] === 'true' ? 'bg-primary' : 'bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${newRowData[col.id] === 'true' ? 'translate-x-5' : 'translate-x-0'}`} /></button>
                    ) : col.field_type === 'relation' ? (
                      relationConfigFromColumn(col)?.multiple ? (
                        <div className="min-w-[190px] rounded-md border border-input bg-background px-2 py-1.5">
                          <div className="space-y-1 max-h-24 overflow-y-auto">
                            {(relationOptionsByColumn[col.id] || []).map((option) => {
                              const selected = valueAsList(newRowData[col.id]).includes(option.id)
                              return (
                                <label key={option.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => {
                                      const next = selected
                                        ? valueAsList(newRowData[col.id]).filter((item) => item !== option.id)
                                        : [...valueAsList(newRowData[col.id]), option.id]
                                      setNewRowData(prev => ({ ...prev, [col.id]: next }))
                                    }}
                                  />
                                  <span className="truncate">{option.label}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        <select
                          value={valueAsString(newRowData[col.id])}
                          onChange={e => setNewRowData(prev => ({ ...prev, [col.id]: e.target.value }))}
                          className="w-full h-7 px-1.5 text-sm rounded border border-input bg-background outline-none focus:border-primary/50"
                        >
                          <option value="">— без связи —</option>
                          {(relationOptionsByColumn[col.id] || []).map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      )
                    ) : col.field_type === 'select' && getColumnOptions(col).length > 0 ? (
                      <select
                        value={valueAsString(newRowData[col.id])}
                        onChange={e => setNewRowData(prev => ({ ...prev, [col.id]: e.target.value }))}
                        className="w-full h-7 px-1.5 text-sm rounded border border-input bg-background outline-none focus:border-primary/50"
                      >
                        <option value="">Выберите значение</option>
                        {getColumnOptions(col).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : col.field_type === 'multi_select' && getColumnOptions(col).length > 0 ? (
                      <div className="min-w-[190px] rounded-md border border-input bg-background px-2 py-1.5">
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                          {getColumnOptions(col).map((option) => {
                            const selected = valueAsList(newRowData[col.id]).includes(option)
                            return (
                              <label key={option} className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => {
                                    const next = selected
                                      ? valueAsList(newRowData[col.id]).filter((item) => item !== option)
                                      : [...valueAsList(newRowData[col.id]), option]
                                    setNewRowData(prev => ({ ...prev, [col.id]: next }))
                                  }}
                                />
                                <span>{option}</span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ) : col.field_type === 'lookup' || col.field_type === 'rollup' || col.field_type === 'formula' ? (
                      <div className="h-7 px-2 rounded border border-dashed border-border text-xs text-muted-foreground/60 flex items-center">
                        вычисляется автоматически
                      </div>
                    ) : (
                      <input type={getInputType(col.field_type)} value={valueAsString(newRowData[col.id])} onChange={e => setNewRowData(prev => ({ ...prev, [col.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') handleAddRecord() }} placeholder={col.name} className="w-full h-7 px-1.5 text-sm rounded border border-input bg-background outline-none focus:border-primary/50" />
                    )}
                  </td>
                ))}
                <td />
                <td className="px-2 py-1.5">
                  <div className="flex gap-1">
                    <button onClick={handleAddRecord} disabled={addingRecord} className="h-7 w-7 rounded bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-50">{addingRecord ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
                    <button onClick={() => { setNewRowData({}); setShowNewRow(false) }} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            )}
            {pagedRecords.map((record: RecordInfo, idx: number) => (
              <tr key={record.id} className="border-b border-border/40 hover:bg-secondary/10 transition-colors group/row">
                <td className="px-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedRecordIds.has(record.id)}
                    onChange={(e) => toggleSelectRecord(record.id, e.target.checked)}
                  />
                </td>
                <td className="px-3 py-0.5 text-xs text-muted-foreground/50 select-none">{page * PAGE_SIZE + idx + 1}</td>
                {columns.map((col: ColumnInfo) => (
                  <td key={col.id} className="px-2 py-0.5 overflow-hidden">
                    <EditableCell
                      value={safeRecordData(record.data)[col.id]}
                      column={col}
                      relationOptions={relationOptionsByColumn[col.id]}
                      onSave={v => handleCellSave(record.id, col.id, v)}
                    />
                  </td>
                ))}
                <td />
                <td className="px-2 py-0.5">
                  <div className="flex items-center">
                    <button
                      onClick={() => handleMoveRecord(record.id, 'up')}
                      disabled={!canManualReorder || !!movingRecordId || (page * PAGE_SIZE + idx) === 0}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
                      title={canManualReorder ? 'Переместить вверх' : 'Отключено при сортировке/фильтре/поиске'}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveRecord(record.id, 'down')}
                      disabled={!canManualReorder || !!movingRecordId || idx === (pagedRecords.length - 1)}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
                      title={canManualReorder ? 'Переместить вниз' : 'Отключено при сортировке/фильтре/поиске'}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleOpenHistory(record.id)}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                      title="История изменений"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDeleteRecord(record.id)} className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pagedRecords.length === 0 && !showNewRow && (
              <tr>
                <td colSpan={columns.length + 4} className="text-center py-10 text-muted-foreground">
                  <button onClick={() => setShowNewRow(true)} className="flex flex-col items-center gap-2 mx-auto hover:text-foreground transition-colors group">
                    <div className="h-12 w-12 rounded-full border-2 border-dashed border-border group-hover:border-primary/50 flex items-center justify-center transition-colors">
                      <Plus className="h-5 w-5" />
                    </div>
                    <span className="text-sm">Нет записей — нажмите чтобы добавить первую</span>
                  </button>
                </td>
              </tr>
            )}
            {/* Inline add row at bottom — only on last page */}
            {!showNewRow && columns.length > 0 && (page === totalPages - 1 || totalPages === 0) && (
              <tr
                onClick={handleQuickAddRecord}
                className="border-t border-dashed border-border/50 hover:bg-secondary/20 cursor-pointer transition-colors group/addrow"
              >
                <td />
                <td className="px-3 py-1.5">
                  {addingRecord
                    ? <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                    : <Plus className="h-3.5 w-3.5 text-muted-foreground/40 group-hover/addrow:text-primary transition-colors" />}
                </td>
                <td colSpan={columns.length + 2} className="px-2 py-1.5 text-xs text-muted-foreground/40 group-hover/addrow:text-muted-foreground transition-colors">
                  Добавить запись
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between max-sm:flex-col max-sm:items-start gap-2">
          <span className="text-xs text-muted-foreground">
            Страница {page + 1} из {totalPages} · всего {total} записей
          </span>
          <div className="flex items-center gap-1 max-sm:overflow-x-auto max-sm:pb-1 max-sm:w-full">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-sm disabled:opacity-40 hover:bg-secondary transition-colors"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center disabled:opacity-40 hover:bg-secondary transition-colors"
            ><ChevronLeft className="h-4 w-4" /></button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 2, totalPages - 5))
              const p = start + i
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-8 w-8 rounded-lg border text-sm transition-colors ${
                    p === page ? 'border-primary bg-primary text-white' : 'border-border hover:bg-secondary'
                  }`}
                >{p + 1}</button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center disabled:opacity-40 hover:bg-secondary transition-colors"
            ><ChevronRight className="h-4 w-4" /></button>
            <button
              onClick={() => setPage(totalPages - 1)}
              disabled={page === totalPages - 1}
              className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-sm disabled:opacity-40 hover:bg-secondary transition-colors"
            >»</button>
          </div>
        </div>
      )}

      {/* Column calculators */}
      {columns.length > 0 && records.length > 0 && (
        <ColumnCalculators columns={columns} records={records} />
      )}

      {csvWizardOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-5xl rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold">CSV Wizard</div>
                <div className="text-xs text-muted-foreground">
                  Upload -&gt; Mapping -&gt; Validate -&gt; Commit
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-8" onClick={closeCsvWizard}>
                Закрыть
              </Button>
            </div>

            <div className="px-4 py-3 border-b border-border flex items-center gap-2 text-xs">
              {(['upload', 'mapping', 'validate', 'commit'] as CsvWizardStep[]).map((step, idx) => {
                const active = step === csvWizardStep
                const done = ['upload', 'mapping', 'validate', 'commit'].indexOf(step) < ['upload', 'mapping', 'validate', 'commit'].indexOf(csvWizardStep)
                return (
                  <span
                    key={step}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${
                      active ? 'border-primary bg-primary/10 text-primary' : done ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-500' : 'border-border text-muted-foreground'
                    }`}
                  >
                    <span>{idx + 1}.</span>
                    <span className="capitalize">{step}</span>
                  </span>
                )
              })}
              <span className="ml-auto text-muted-foreground">
                {csvWizardFile ? csvWizardFile.name : 'Файл не выбран'}
              </span>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-4 space-y-4">
              {csvWizardError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {csvWizardError}
                </div>
              )}

              <input
                ref={csvWizardFileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleCsvWizardFileSelected(e.target.files?.[0] || null)}
              />

              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs text-muted-foreground">Режим:</label>
                <select
                  value={csvWizardMode}
                  onChange={(e) => setCsvWizardMode(e.target.value === 'replace' ? 'replace' : 'append')}
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                >
                  <option value="append">append</option>
                  <option value="replace">replace</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => csvWizardFileInputRef.current?.click()}
                  disabled={importing}
                >
                  {importing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                  Выбрать CSV
                </Button>
                {csvWizardPreview && (
                  <span className="text-xs text-muted-foreground">
                    Строк: {csvWizardPreview.total_rows}, валидных: {csvWizardPreview.valid_rows}, ошибок: {csvWizardPreview.invalid_rows}
                  </span>
                )}
              </div>

              {csvWizardPreview && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="px-3 py-2 border-b border-border text-sm font-medium">Mapping колонок</div>
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/30">
                      <tr>
                        <th className="px-3 py-2 text-left">CSV колонка</th>
                        <th className="px-3 py-2 text-left">Колонка таблицы</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvWizardPreview.header.map((csvColumn) => (
                        <tr key={csvColumn} className="border-t border-border/60">
                          <td className="px-3 py-2">{csvColumn}</td>
                          <td className="px-3 py-2">
                            <select
                              value={csvWizardMapping[csvColumn] || ''}
                              onChange={(e) => {
                                const value = e.target.value
                                setCsvWizardMapping((prev) => {
                                  const next = { ...prev }
                                  if (!value) {
                                    delete next[csvColumn]
                                  } else {
                                    next[csvColumn] = value
                                  }
                                  return next
                                })
                              }}
                              className="h-8 rounded-lg border border-input bg-background px-2 text-sm min-w-[220px]"
                            >
                              <option value="">-- пропустить --</option>
                              {columns.map((col) => (
                                <option key={col.id} value={col.id}>{col.name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {csvWizardPreview && csvWizardStep !== 'commit' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={csvWizardStrict}
                      onChange={(e) => setCsvWizardStrict(e.target.checked)}
                    />
                    <span>Strict mode (блокировать commit при ошибках в строках)</span>
                  </label>
                  <Button variant="outline" size="sm" className="h-8" onClick={handleCsvWizardValidate} disabled={importing || !csvWizardFile}>
                    {importing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    Validate
                  </Button>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={handleCsvWizardCommit}
                    disabled={importing || !csvWizardFile}
                  >
                    {importing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
                    Commit
                  </Button>
                </div>
              )}

              {csvWizardPreview && csvWizardStep === 'validate' && (
                <div className="space-y-3">
                  <div className="text-sm font-medium">Результат validate</div>
                  {csvWizardPreview.errors.length === 0 ? (
                    <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
                      Ошибок не найдено.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border overflow-auto">
                      <table className="w-full text-xs min-w-[720px]">
                        <thead className="bg-secondary/30">
                          <tr>
                            <th className="px-2 py-2 text-left">Строка</th>
                            <th className="px-2 py-2 text-left">Колонка</th>
                            <th className="px-2 py-2 text-left">Код</th>
                            <th className="px-2 py-2 text-left">Причина</th>
                            <th className="px-2 py-2 text-left">Значение</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvWizardPreview.errors.map((err, idx) => (
                            <tr key={`${err.row_number}-${idx}`} className="border-t border-border/60">
                              <td className="px-2 py-2">{err.row_number}</td>
                              <td className="px-2 py-2">{err.column}</td>
                              <td className="px-2 py-2">{err.code}</td>
                              <td className="px-2 py-2">{err.message}</td>
                              <td className="px-2 py-2">{valueAsString(err.raw_value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {csvWizardCommit && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">
                    Импорт завершен: создано {csvWizardCommit.records_created}, пропущено {csvWizardCommit.records_skipped}
                    {csvWizardCommit.deleted_before > 0 ? `, удалено до импорта ${csvWizardCommit.deleted_before}` : ''}
                  </div>
                  {csvWizardCommit.errors.length > 0 && (
                    <div className="rounded-lg border border-border overflow-auto">
                      <table className="w-full text-xs min-w-[720px]">
                        <thead className="bg-secondary/30">
                          <tr>
                            <th className="px-2 py-2 text-left">Строка</th>
                            <th className="px-2 py-2 text-left">Колонка</th>
                            <th className="px-2 py-2 text-left">Код</th>
                            <th className="px-2 py-2 text-left">Причина</th>
                            <th className="px-2 py-2 text-left">Значение</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvWizardCommit.errors.map((err, idx) => (
                            <tr key={`${err.row_number}-${idx}`} className="border-t border-border/60">
                              <td className="px-2 py-2">{err.row_number}</td>
                              <td className="px-2 py-2">{err.column}</td>
                              <td className="px-2 py-2">{err.code}</td>
                              <td className="px-2 py-2">{err.message}</td>
                              <td className="px-2 py-2">{valueAsString(err.raw_value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {historyRecordId && (
        <div className="fixed inset-0 z-40 bg-black/40 p-4 flex items-center justify-center">
          <div className="w-full max-w-3xl rounded-xl border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <div className="text-sm font-semibold">История записи</div>
                <div className="text-xs text-muted-foreground">{historyTotal} событий</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => handleRollbackLast(historyRecordId)}
                  disabled={historyLoading || rollingBackRecordId === historyRecordId}
                >
                  {rollingBackRecordId === historyRecordId ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Откатить последнее
                </Button>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setHistoryRecordId(null)}>
                  Закрыть
                </Button>
              </div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-4 space-y-2">
              {historyLoading ? (
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Загрузка истории...
                </div>
              ) : historyItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">Изменений пока нет.</div>
              ) : (
                historyItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/70 bg-secondary/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span>{new Date(item.created_at).toLocaleString('ru-RU')}</span>
                      <span>•</span>
                      <span>{item.source || item.action}</span>
                      <span>•</span>
                      <span>Кто: {actorLabel(item.actor_id)}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {getHistoryCellChanges(item).length === 0 ? (
                        <div className="text-xs text-muted-foreground">Нет данных по измененным ячейкам.</div>
                      ) : (
                        getHistoryCellChanges(item).map((change) => (
                          <div key={`${item.id}-${change.columnId}`} className="text-xs grid grid-cols-[170px_1fr_20px_1fr] gap-2 items-start">
                            <span className="text-muted-foreground truncate">{change.columnName}</span>
                            <span className="rounded px-1.5 py-0.5 bg-background/70 break-words">{valueAsString(change.beforeValue) || '—'}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="rounded px-1.5 py-0.5 bg-background/70 break-words">{valueAsString(change.afterValue) || '—'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <ColumnSettingsModal
        open={columnDialog !== null}
        title={columnDialog?.mode === 'edit' ? 'Настройки поля' : 'Новое поле'}
        submitLabel={columnDialog?.mode === 'edit' ? 'Сохранить' : 'Добавить поле'}
        draft={columnDraft}
        optionsOpen={columnOptionsOpen}
        saving={savingColumn}
        allTables={tablesCatalog}
        currentTableId={table.id}
        currentColumns={columns}
        onDraftChange={updateColumnDraft}
        onToggleOptions={() => setColumnOptionsOpen((prev) => !prev)}
        formulaPreview={formulaPreview}
        formulaPreviewLoading={formulaPreviewLoading}
        onPreviewFormula={handlePreviewFormula}
        onClose={closeColumnDialog}
        onSubmit={submitColumnDialog}
      />
    </div>
  )
}

const CALC_OPS = ['none','count','filled','empty','sum','avg','median','min','max','unique'] as const
type CalcOp = typeof CALC_OPS[number]

const CALC_META: Record<CalcOp, { label: string; desc: string; numOnly?: boolean; color: string }> = {
  none:   { label: 'Выбрать',    desc: 'Нажмите чтобы выбрать агрегацию',              color: 'text-muted-foreground' },
  count:  { label: 'Кол-во',     desc: 'Всего строк в таблице (включая пустые)',        color: 'text-blue-400' },
  filled: { label: 'Заполнено',  desc: 'Строк с непустым значением в этом столбце',     color: 'text-emerald-400' },
  empty:  { label: 'Пусто',      desc: 'Строк с пустым значением в этом столбце',       color: 'text-amber-400' },
  unique: { label: 'Уникальных', desc: 'Количество различных (уникальных) значений',    color: 'text-purple-400' },
  sum:    { label: 'Сумма',      desc: 'Сумма всех числовых значений столбца',          color: 'text-cyan-400',    numOnly: true },
  avg:    { label: 'Среднее',    desc: 'Среднее арифметическое числовых значений',      color: 'text-indigo-400',  numOnly: true },
  median: { label: 'Медиана',    desc: 'Серединное значение (50-й перцентиль)',          color: 'text-pink-400',    numOnly: true },
  min:    { label: 'Минимум',    desc: 'Наименьшее значение в столбце',                 color: 'text-red-400',     numOnly: true },
  max:    { label: 'Максимум',   desc: 'Наибольшее значение в столбце',                 color: 'text-orange-400',  numOnly: true },
}

function CalcTooltip({ text, children, align = 'left', direction = 'up' }: {
  text: string
  children: ReactNode
  align?: 'left' | 'right'
  direction?: 'up' | 'down'
}) {
  const posY = direction === 'down' ? 'top-full mt-2' : 'bottom-full mb-2'
  const posX = align === 'right' ? 'right-0' : 'left-0'
  const arrowX = align === 'right' ? 'right-3' : 'left-3'
  const arrowDir = direction === 'down'
    ? 'border-b-4 border-l-transparent border-r-transparent border-t-0 border-b-border bottom-full mb-[-1px]'
    : 'border-t-4 border-l-transparent border-r-transparent border-b-0 border-t-border top-full'
  return (
    <div className="relative group/tip inline-block">
      {children}
      <div className={`pointer-events-none absolute ${posY} ${posX} z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150`}>
        <div className="bg-popover border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground shadow-lg max-w-[220px] break-words">
          {text}
        </div>
        <div className={`absolute w-0 h-0 border-l-4 border-r-4 ${arrowX} ${arrowDir}`} />
      </div>
    </div>
  )
}

function ColumnCalculators({ columns, records }: { columns: ColumnInfo[]; records: RecordInfo[] }) {
  const [ops, setOps] = useState<Record<string, CalcOp>>({})

  const calc = (colId: string, op: CalcOp): string => {
    const allVals = records.map(r => safeRecordData(r.data)[colId])
    const filled = allVals.filter(v => v !== undefined && v !== null && v !== '')
    if (op === 'count')  return String(records.length)
    if (op === 'filled') return String(filled.length)
    if (op === 'empty')  return String(records.length - filled.length)
    if (op === 'unique') return String(new Set(filled.map(v => String(v))).size)
    const nums = filled.map(v => parseFloat(String(v))).filter(n => !isNaN(n))
    if (nums.length === 0) return '—'
    const fmt = (n: number) => n.toLocaleString('ru', { maximumFractionDigits: 2 })
    if (op === 'sum')    return fmt(nums.reduce((a, b) => a + b, 0))
    if (op === 'avg')    return fmt(nums.reduce((a, b) => a + b, 0) / nums.length)
    if (op === 'min')    return fmt(Math.min(...nums))
    if (op === 'max')    return fmt(Math.max(...nums))
    if (op === 'median') {
      const sorted = [...nums].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const medVal = sorted.length % 2 !== 0
        ? (sorted[mid] ?? 0)
        : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      return fmt(medVal)
    }
    return '—'
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Hash className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold">Калькулятор столбцов</span>
        <CalcTooltip text="Выберите агрегацию для каждого столбца — нажмите на название операции" align="right" direction="down">
          <span className="text-xs text-muted-foreground cursor-help border-b border-dashed border-muted-foreground/40">
            Как использовать?
          </span>
        </CalcTooltip>
        <span className="ml-auto text-xs text-muted-foreground/50 tabular-nums">{records.length} строк</span>
      </div>

      {/* Cards */}
      <div className="p-3 flex flex-wrap gap-3">
        {columns.map(col => {
          const op = ops[col.id] || 'none'
          const meta = CALC_META[op]
          const isNum = col.field_type === 'number'
          const result = op !== 'none' ? calc(col.id, op) : null
          const availableOps = CALC_OPS.filter(o => !CALC_META[o].numOnly || isNum)

          const colInfo = ftMap[col.field_type]
          const ColIcon = colInfo?.icon || Type

          return (
            <div
              key={col.id}
              className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-3 min-w-0 sm:min-w-[160px] flex-1"
            >
              {/* Column name */}
              <div className="flex items-center gap-1.5 min-w-0">
                <ColIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <span className="text-xs font-medium text-muted-foreground truncate">{col.name}</span>
              </div>

              {/* Operation pills */}
              <div className="flex flex-wrap gap-1">
                {availableOps.filter(o => o !== 'none').map(o => {
                  const m = CALC_META[o]
                  const isActive = op === o
                  return (
                    <CalcTooltip key={o} text={m.desc}>
                      <button
                        onClick={() => setOps(prev => ({ ...prev, [col.id]: isActive ? 'none' : o }))}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                          isActive
                            ? `border-primary/40 bg-primary/10 ${m.color} font-medium`
                            : 'border-border text-muted-foreground/50 hover:border-border hover:text-muted-foreground hover:bg-secondary/50'
                        }`}
                      >
                        {m.label}
                      </button>
                    </CalcTooltip>
                  )
                })}
              </div>

              {/* Result */}
              <div className="mt-auto pt-1 border-t border-border/50">
                {result !== null ? (
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xl font-bold tabular-nums ${meta.color}`}>{result}</span>
                    <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">{meta.label}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/30 italic">не выбрано</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}



export default function TableDetailPage() {
  return (
    <PageErrorBoundary>
      <TableDetailPageContent />
    </PageErrorBoundary>
  )
}
