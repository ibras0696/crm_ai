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
  { value: 'select', label: 'Выбор', icon: List },
  { value: 'multi_select', label: 'Мульти-выбор', icon: List },
  { value: 'url', label: 'URL', icon: Link2 },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'phone', label: 'Телефон', icon: Phone },
  { value: 'file', label: 'Файл', icon: FileIcon },
]
const ftMap = Object.fromEntries(FIELD_TYPES.map(f => [f.value, f]))

function getInputType(ft: string) {
  return ft === 'number' ? 'number' : ft === 'date' ? 'date' : ft === 'datetime' ? 'datetime-local' : ft === 'email' ? 'email' : ft === 'url' ? 'url' : ft === 'phone' ? 'tel' : 'text'
}

function fmtVal(v: string, ft: string) {
  if (!v) return ''
  if (ft === 'boolean') return v === 'true' ? '✓ Да' : '✗ Нет'
  if (ft === 'date') { try { return new Date(v).toLocaleDateString('ru') } catch { return v } }
  if (ft === 'datetime') { try { return new Date(v).toLocaleString('ru') } catch { return v } }
  return v
}

function EditableCell({ value, fieldType, onSave }: { value: string; fieldType: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const committed = useRef(false)
  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) { committed.current = false; ref.current?.focus() } }, [editing])
  const commit = () => {
    if (committed.current) return
    committed.current = true
    setEditing(false)
    if (draft !== value) onSave(draft)
  }
  if (fieldType === 'boolean') {
    const on = value === 'true'
    return <button onClick={() => onSave(String(!on))} className={`h-6 w-11 rounded-full flex items-center px-0.5 transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} /></button>
  }
  if (!editing) return <div onClick={() => setEditing(true)} className="min-h-[28px] px-1.5 py-1 rounded cursor-text hover:bg-secondary/40 transition-colors text-sm truncate max-w-[200px]">{value ? fmtVal(value, fieldType) : <span className="text-muted-foreground/30 italic">—</span>}</div>
  return <input ref={ref} type={getInputType(fieldType)} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { setDraft(value); setEditing(false) } }} className="w-full min-w-[120px] h-7 px-1.5 text-sm rounded border border-primary/50 bg-background outline-none ring-1 ring-primary/20" />
}

function AddColHeader({ onAdd }: { onAdd: (name: string, type: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  const submit = async () => { if (!name.trim()) return; setSaving(true); await onAdd(name.trim(), type); setName(''); setType('text'); setOpen(false); setSaving(false) }
  if (!open) return <th className="px-2 py-2.5 w-10"><button onClick={() => setOpen(true)} title="Добавить поле" className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"><Plus className="h-4 w-4" /></button></th>
  return (
    <th className="px-2 py-1.5 min-w-[240px]">
      <div className="flex items-center gap-1">
        <input ref={ref} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }} placeholder="Название поля" className="flex-1 h-7 px-2 text-sm rounded border border-primary/50 bg-background outline-none min-w-0 font-normal" />
        <select value={type} onChange={e => setType(e.target.value)} className="h-7 rounded border border-input bg-background px-1 text-xs font-normal">{FIELD_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
        <button onClick={submit} disabled={saving || !name.trim()} className="h-7 w-7 rounded bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
        <button onClick={() => setOpen(false)} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
      </div>
    </th>
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
  const [newRowData, setNewRowData] = useState<Record<string, string>>({})
  const [showNewRow, setShowNewRow] = useState(false)
  // Search / filter / sort / pagination
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterCol, setFilterCol] = useState<string>('')
  const [filterVal, setFilterVal] = useState<string>('')
  const [showFilter, setShowFilter] = useState(false)
  const [page, setPage] = useState(0)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnName, setEditingColumnName] = useState('')
  const [editingColumnType, setEditingColumnType] = useState('text')
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

  const handleAddColumn = async (name: string, fieldType: string) => {
    if (!tableId) return
    await tablesApi.createColumn(tableId, { name, field_type: fieldType })
    await load()
  }

  const handleDeleteColumn = async (colId: string) => {
    if (!tableId) return
    await tablesApi.deleteColumn(tableId, colId)
    await load()
  }

  const startEditColumn = (col: ColumnInfo) => {
    setEditingColumnId(col.id)
    setEditingColumnName(col.name)
    setEditingColumnType(col.field_type)
  }

  const cancelEditColumn = () => {
    setEditingColumnId(null)
    setEditingColumnName('')
    setEditingColumnType('text')
  }

  const handleSaveColumn = async () => {
    if (!tableId || !editingColumnId || !editingColumnName.trim()) return
    await tablesApi.updateColumn(tableId, editingColumnId, {
      name: editingColumnName.trim(),
      field_type: editingColumnType,
    })
    cancelEditColumn()
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

  const handleCellSave = async (recordId: string, colId: string, value: string) => {
    if (!tableId) return
    const key = `${recordId}-${colId}`
    // Optimistic update — immediately reflect in UI
    setRecords(prev =>
      prev.map(r =>
        r.id === recordId ? { ...r, data: { ...safeRecordData(r.data), [colId]: value } } : r,
      ),
    )
    setSavingCells(prev => new Set(prev).add(key))
    try {
      const resp = await recordsApi.update(tableId, recordId, { [colId]: value })
      if (resp.data.ok && resp.data.data) {
        setRecords(prev => prev.map(r => r.id === recordId ? resp.data.data! : r))
      }
    } catch { /* ignore */ }
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
    ;[optimistic[currentIdx], optimistic[targetIdx]] = [optimistic[targetIdx], optimistic[currentIdx]]
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

      {/* Search + Filter toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
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
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-secondary/20">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Столбец:</span>
          <select
            value={filterCol}
            onChange={e => { setFilterCol(e.target.value); setFilterVal(''); setPage(0) }}
            className="h-8 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
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
            className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary disabled:opacity-50"
          />
        </div>
      )}

      <div className="border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-3 py-2.5 w-8 text-left text-xs text-muted-foreground font-medium">#</th>
              {columns.map((col: ColumnInfo) => {
                const info = ftMap[col.field_type]
                const Icon = info?.icon || Type
                const isSorted = sortCol === col.id
                const SortIcon = isSorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                return (
                  <th key={col.id} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap group">
                    {editingColumnId === col.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={editingColumnName}
                          onChange={e => setEditingColumnName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveColumn(); if (e.key === 'Escape') cancelEditColumn() }}
                          className="h-7 w-[120px] px-2 text-xs rounded border border-primary/50 bg-background outline-none"
                        />
                        <select
                          value={editingColumnType}
                          onChange={e => setEditingColumnType(e.target.value)}
                          className="h-7 rounded border border-input bg-background px-1 text-xs"
                        >
                          {FIELD_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                        <button onClick={handleSaveColumn} className="h-7 w-7 rounded bg-primary text-white flex items-center justify-center"><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={cancelEditColumn} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
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
                            isSorted ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
                          }`} />
                        </button>
                        <button onClick={() => startEditColumn(col)} className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity" title="Изменить название и тип">
                          <Pencil className="h-3 w-3" />
                        </button>
                        {col.is_required && <span className="text-destructive text-xs">*</span>}
                        {!col.is_primary && (
                          <button onClick={() => handleDeleteColumn(col.id)} className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </th>
                )
              })}
              <AddColHeader onAdd={handleAddColumn} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {showNewRow && (
              <tr className="border-b border-primary/20 bg-primary/5">
                <td className="px-3 py-1.5 text-xs text-muted-foreground">new</td>
                {columns.map((col: ColumnInfo) => (
                  <td key={col.id} className="px-2 py-1.5">
                    {col.field_type === 'boolean' ? (
                      <button onClick={() => setNewRowData(prev => ({ ...prev, [col.id]: String(!(prev[col.id] === 'true')) }))} className={`h-6 w-11 rounded-full flex items-center px-0.5 transition-colors ${newRowData[col.id] === 'true' ? 'bg-primary' : 'bg-secondary'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${newRowData[col.id] === 'true' ? 'translate-x-5' : 'translate-x-0'}`} /></button>
                    ) : (
                      <input type={getInputType(col.field_type)} value={newRowData[col.id] || ''} onChange={e => setNewRowData(prev => ({ ...prev, [col.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') handleAddRecord() }} placeholder={col.name} className="w-full h-7 px-1.5 text-sm rounded border border-input bg-background outline-none focus:border-primary/50" />
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
                  <td key={col.id} className="px-2 py-0.5">
                    <EditableCell value={String(safeRecordData(record.data)[col.id] ?? '')} fieldType={col.field_type} onSave={v => handleCellSave(record.id, col.id, v)} />
                  </td>
                ))}
                <td />
                <td className="px-2 py-0.5">
                  <div className="flex items-center">
                    <button
                      onClick={() => handleMoveRecord(record.id, 'up')}
                      disabled={!canManualReorder || !!movingRecordId || (page * PAGE_SIZE + idx) === 0}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
                      title={canManualReorder ? 'Переместить вверх' : 'Отключено при сортировке/фильтре/поиске'}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveRecord(record.id, 'down')}
                      disabled={!canManualReorder || !!movingRecordId || (page * PAGE_SIZE + idx) === (processedRecords.length - 1)}
                      className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-opacity"
                      title={canManualReorder ? 'Переместить вниз' : 'Отключено при сортировке/фильтре/поиске'}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDeleteRecord(record.id)} className="h-7 w-7 flex items-center justify-center opacity-0 group-hover/row:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Страница {page + 1} из {totalPages} · {processedRecords.length} записей
          </span>
          <div className="flex items-center gap-1">
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
              className="flex flex-col gap-2.5 rounded-xl border border-border bg-background p-3 min-w-[160px] flex-1"
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
