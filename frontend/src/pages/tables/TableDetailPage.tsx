import { isAxiosError } from 'axios'
import { useState, useEffect, useCallback, useRef, useMemo, Component, type ErrorInfo, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { tablesApi, recordsApi, TableInfo, RecordInfo, ColumnInfo } from '@/lib/api'
import { ArrowLeft, Plus, Loader2, Trash2, X, Check, Type, Hash, Calendar, ToggleLeft, List, Link2, Mail, Phone, FileIcon, Download, Search, ArrowUpDown, ArrowUp, ArrowDown, Filter, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'

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
]
const ftMap = Object.fromEntries(FIELD_TYPES.map(f => [f.value, f]))
type CellValue = string | string[]
const DATA_COLUMN_WIDTH = 240

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

function buildColumnConfig(fieldType: string, optionsText: string) {
  if (!isOptionFieldType(fieldType)) return null
  const options = parseOptionsText(optionsText)
  return options.length > 0 ? { options } : null
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
  onSave,
}: {
  value: unknown
  column: ColumnInfo
  onSave: (v: CellValue) => void
}) {
  const fieldType = column.field_type
  const options = getColumnOptions(column)
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
}

function ColumnSettingsModal({
  open,
  title,
  submitLabel,
  draft,
  optionsOpen,
  saving,
  onDraftChange,
  onToggleOptions,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  submitLabel: string
  draft: ColumnSettingsDraft
  optionsOpen: boolean
  saving: boolean
  onDraftChange: (patch: Partial<ColumnSettingsDraft>) => void
  onToggleOptions: () => void
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
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors">
            Отмена
          </button>
          <button onClick={onSubmit} disabled={saving || !draft.name.trim()} className="h-10 px-5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
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
  const [filterVal, setFilterVal] = useState<string>('')
  const [showFilter, setShowFilter] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [page, setPage] = useState(0)
  const [columnDialog, setColumnDialog] = useState<{ mode: 'create' } | { mode: 'edit'; columnId: string } | null>(null)
  const [columnDraft, setColumnDraft] = useState<ColumnSettingsDraft>({ name: '', type: 'text', optionsText: '' })
  const [columnOptionsOpen, setColumnOptionsOpen] = useState(false)
  const [savingColumn, setSavingColumn] = useState(false)
  const [movingRecordId, setMovingRecordId] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null)
  const moveLockRef = useRef(false)

  const load = useCallback(async () => {
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
    setFilterVal('')
    setPage(0)
    setShowNewRow(false)
    try {
      const tR = await tablesApi.get(tableId)
      if (!tR.data.ok || !tR.data.data) {
        setLoadError(true)
        return
      }
      setTable(tR.data.data)

      const rR = await recordsApi.list(tableId, 500)
      if (rR.data.ok && rR.data.data) {
        const normalized = (rR.data.data.records ?? [])
          .filter(isRecordInfo)
          .map((r) => ({ ...r, data: safeRecordData(r.data) }))
        setRecords(normalized)
        setTotal(typeof rR.data.data.total === 'number' ? rR.data.data.total : normalized.length)
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [tableId])

  useEffect(() => { load() }, [load])

  const closeColumnDialog = () => {
    setColumnDialog(null)
    setColumnDraft({ name: '', type: 'text', optionsText: '' })
    setColumnOptionsOpen(false)
    setSavingColumn(false)
  }

  const openCreateColumnDialog = () => {
    setColumnDialog({ mode: 'create' })
    setColumnDraft({ name: '', type: 'text', optionsText: '' })
    setColumnOptionsOpen(false)
  }

  const openEditColumnDialog = (col: ColumnInfo) => {
    setColumnDialog({ mode: 'edit', columnId: col.id })
    setColumnDraft({
      name: col.name,
      type: col.field_type,
      optionsText: optionsToMultiline(getColumnOptions(col)),
    })
    setColumnOptionsOpen(false)
  }

  const updateColumnDraft = (patch: Partial<ColumnSettingsDraft>) => {
    const nextType = patch.type ?? columnDraft.type
    if ('type' in patch && !isOptionFieldType(nextType)) {
      setColumnOptionsOpen(false)
    }
    setColumnDraft((prev) => ({ ...prev, ...patch }))
  }

  const submitColumnDialog = async () => {
    if (!tableId || !columnDialog || !columnDraft.name.trim()) return
    setSavingColumn(true)
    try {
      const payload = {
        name: columnDraft.name.trim(),
        field_type: columnDraft.type,
        config: buildColumnConfig(columnDraft.type, columnDraft.optionsText),
      }
      if (columnDialog.mode === 'create') {
        await tablesApi.createColumn(tableId, payload)
      } else {
        await tablesApi.updateColumn(tableId, columnDialog.columnId, payload)
      }
      closeColumnDialog()
      await load()
    } finally {
      setSavingColumn(false)
    }
  }

  const handleDeleteColumn = async (colId: string) => {
    if (!tableId) return
    await tablesApi.deleteColumn(tableId, colId)
    await load()
  }

  const handleAddRecord = async () => {
    if (!tableId) return
    setAddingRecord(true)
    try {
      const resp = await recordsApi.create(tableId, newRowData)
      if (resp.data.ok && resp.data.data) {
        setRecords(prev => [...prev, resp.data.data!])
        setTotal(prev => prev + 1)
        setNewRowData({})
        setShowNewRow(false)
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
        setRecords(prev => [...prev, resp.data.data!])
        setTotal(prev => prev + 1)
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
        const sync = await recordsApi.list(tableId, 500)
        if (sync.data.ok && sync.data.data) {
          setRecords(sync.data.data.records)
          setTotal(sync.data.data.total)
        }
      } catch {
        // leave local rollback state if refresh fails
      }
    }
    setSavingCells(prev => { const n = new Set(prev); n.delete(key); return n })
  }

  const handleDeleteRecord = async (recordId: string) => {
    if (!tableId) return
    await recordsApi.delete(tableId, recordId)
    setRecords(prev => prev.filter(r => r.id !== recordId))
    setTotal(prev => prev - 1)
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
      const sync = await recordsApi.list(tableId, 500)
      if (sync.data.ok && sync.data.data) {
        const normalized = (sync.data.data.records ?? [])
          .filter(isRecordInfo)
          .map((r) => ({ ...r, data: safeRecordData(r.data) }))
        setRecords(normalized)
        setTotal(typeof sync.data.data.total === 'number' ? sync.data.data.total : normalized.length)
      }
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

  const columns = (Array.isArray(table?.columns) ? table.columns : [])
    .filter(isColumnInfo)
    .sort((a: ColumnInfo, b: ColumnInfo) => a.position - b.position)

  // --- Client-side search / filter / sort ---
  const processedRecords = useMemo(() => {
    let result = [...records]
    // Search across all fields
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(r =>
        columns.some(col => String(safeRecordData(r.data)[col.id] ?? '').toLowerCase().includes(q))
      )
    }
    // Column filter
    if (filterCol && filterVal.trim()) {
      const fv = filterVal.trim().toLowerCase()
      result = result.filter(r => String(safeRecordData(r.data)[filterCol] ?? '').toLowerCase().includes(fv))
    }
    // Sort
    if (sortCol) {
      result.sort((a, b) => {
        const av = String(safeRecordData(a.data)[sortCol] ?? '')
        const bv = String(safeRecordData(b.data)[sortCol] ?? '')
        const na = parseFloat(av), nb = parseFloat(bv)
        const cmp = !isNaN(na) && !isNaN(nb) ? na - nb : av.localeCompare(bv, 'ru')
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [records, search, filterCol, filterVal, sortCol, sortDir, columns])

  const totalPages = Math.ceil(processedRecords.length / PAGE_SIZE)
  const pagedRecords = processedRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const canManualReorder = !search.trim() && !filterCol && !sortCol

  const handleSort = (colId: string) => {
    if (sortCol === colId) {
      if (sortDir === 'asc') setSortDir('desc')
      else { setSortCol(null); setSortDir('asc') }
    } else {
      setSortCol(colId); setSortDir('asc')
    }
    setPage(0)
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
        <Button size="sm" onClick={() => setShowNewRow(v => !v)} className="gradient-primary border-0 text-white h-8">
          {showNewRow ? <><X className="h-4 w-4 mr-1" />Отмена</> : <><Plus className="h-4 w-4 mr-1" />Добавить запись</>}
        </Button>
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
          onClick={() => { setShowFilter(v => !v); if (showFilter) { setFilterCol(''); setFilterVal('') } }}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-lg border text-sm transition-colors ${
            filterCol && filterVal ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          Фильтр{filterCol && filterVal ? ` (${columns.find(c => c.id === filterCol)?.name})` : ''}
        </button>
        {sortCol && (
          <button onClick={() => { setSortCol(null); setSortDir('asc') }} className="flex items-center gap-1 h-8 px-3 rounded-lg border border-primary bg-primary/10 text-primary text-sm">
            <ArrowUpDown className="h-3.5 w-3.5" />
            {columns.find(c => c.id === sortCol)?.name} {sortDir === 'asc' ? '↑' : '↓'}
            <X className="h-3 w-3 ml-0.5" />
          </button>
        )}
        {(search || filterCol) && (
          <button onClick={() => { setSearch(''); setFilterCol(''); setFilterVal(''); setPage(0) }} className="h-8 px-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-secondary">
            Сбросить
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {processedRecords.length !== total ? `${processedRecords.length} из ${total}` : total} записей
        </span>
      </div>

      {/* Filter panel */}
      {showFilter && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary/20 max-sm:flex-col max-sm:items-stretch">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Столбец:</span>
          <select
            value={filterCol}
            onChange={e => { setFilterCol(e.target.value); setFilterVal(''); setPage(0) }}
            className="h-8 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary max-sm:w-full"
          >
            <option value="">— выберите —</option>
            {columns.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}
          </select>
          <span className="text-xs text-muted-foreground whitespace-nowrap">Содержит:</span>
          <input
            value={filterVal}
            onChange={e => { setFilterVal(e.target.value); setPage(0) }}
            placeholder="Значение..."
            disabled={!filterCol}
            className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary disabled:opacity-50 max-sm:w-full"
          />
        </div>
      )}

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="min-w-full max-md:min-w-[760px] table-fixed text-sm">
          <colgroup>
            <col className="w-10" />
            {columns.map((col: ColumnInfo) => (
              <col key={col.id} style={{ width: `${DATA_COLUMN_WIDTH}px` }} />
            ))}
            <col className="w-10" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-secondary/30">
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
                <td className="px-3 py-1.5 text-xs text-muted-foreground">new</td>
                {columns.map((col: ColumnInfo) => (
                  <td key={col.id} className="px-2 py-1.5 overflow-hidden">
                    {col.field_type === 'boolean' ? (
                      <button onClick={() => setNewRowData(prev => ({ ...prev, [col.id]: String(!(prev[col.id] === 'true')) }))} className={`h-6 w-11 rounded-full flex items-center px-0.5 transition-colors ${newRowData[col.id] === 'true' ? 'bg-primary' : 'bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${newRowData[col.id] === 'true' ? 'translate-x-5' : 'translate-x-0'}`} /></button>
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
                <td className="px-3 py-0.5 text-xs text-muted-foreground/50 select-none">{page * PAGE_SIZE + idx + 1}</td>
                {columns.map((col: ColumnInfo) => (
                  <td key={col.id} className="px-2 py-0.5 overflow-hidden">
                    <EditableCell value={safeRecordData(record.data)[col.id]} column={col} onSave={v => handleCellSave(record.id, col.id, v)} />
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
                      disabled={!canManualReorder || !!movingRecordId || (page * PAGE_SIZE + idx) === (processedRecords.length - 1)}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
                      title={canManualReorder ? 'Переместить вниз' : 'Отключено при сортировке/фильтре/поиске'}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDeleteRecord(record.id)} className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 max-md:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {processedRecords.length === 0 && !showNewRow && (
              <tr>
                <td colSpan={columns.length + 3} className="text-center py-10 text-muted-foreground">
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
            Страница {page + 1} из {totalPages} · {processedRecords.length} записей
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
        <ColumnCalculators columns={columns} records={processedRecords} />
      )}

      <ColumnSettingsModal
        open={columnDialog !== null}
        title={columnDialog?.mode === 'edit' ? 'Настройки поля' : 'Новое поле'}
        submitLabel={columnDialog?.mode === 'edit' ? 'Сохранить' : 'Добавить поле'}
        draft={columnDraft}
        optionsOpen={columnOptionsOpen}
        saving={savingColumn}
        onDraftChange={updateColumnDraft}
        onToggleOptions={() => setColumnOptionsOpen((prev) => !prev)}
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
