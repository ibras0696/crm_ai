import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Search, Table2 } from 'lucide-react'

import type { SATableDetail, SATableListPage, SARecordListPage } from '@/lib/api'
import { superadminTablesApi } from '@/lib/api'
import { SuperadminEmptyState } from '../shared/EmptyState'

type Props = {
  selectedOrgId: string
}

export function SuperadminTablesView({ selectedOrgId }: Props) {
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(25)
  const [offset, setOffset] = useState(0)
  const [tablesPage, setTablesPage] = useState<SATableListPage | null>(null)
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tablesError, setTablesError] = useState('')

  const [selectedTableId, setSelectedTableId] = useState<string>('')
  const [tableDetail, setTableDetail] = useState<SATableDetail | null>(null)
  const [recordsPage, setRecordsPage] = useState<SARecordListPage | null>(null)
  const [recordsQ, setRecordsQ] = useState('')
  const [sortColId, setSortColId] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [rLimit, setRLimit] = useState(100)
  const [rOffset, setROffset] = useState(0)
  const [recordsLoading, setRecordsLoading] = useState(false)
  const [recordsError, setRecordsError] = useState('')

  const debouncedTablesQ = useDebounced(q.trim(), 300)
  const debouncedRecordsQ = useDebounced(recordsQ.trim(), 250)

  const loadTables = async (nextOffset = offset) => {
    if (!selectedOrgId) return
    setTablesLoading(true)
    setTablesError('')
    try {
      const r = await superadminTablesApi.listOrgTables(selectedOrgId, {
        q: debouncedTablesQ || undefined,
        include_archived: true,
        limit,
        offset: nextOffset,
      })
      if (r.data.ok && r.data.data) {
        setTablesPage(r.data.data)
        setOffset(r.data.data.offset)
      } else {
        setTablesError(r.data.error?.message || 'Не удалось загрузить таблицы')
      }
    } catch (e: any) {
      setTablesError(e?.response?.data?.error?.message || 'Не удалось загрузить таблицы')
    } finally {
      setTablesLoading(false)
    }
  }

  const loadTableDetail = async (tableId: string) => {
    if (!selectedOrgId || !tableId) return
    setRecordsError('')
    setRecordsPage(null)
    setTableDetail(null)
    try {
      const d = await superadminTablesApi.getTable(selectedOrgId, tableId)
      if (d.data.ok && d.data.data) setTableDetail(d.data.data)
      else setRecordsError(d.data.error?.message || 'Не удалось загрузить таблицу')
    } catch (e: any) {
      setRecordsError(e?.response?.data?.error?.message || 'Не удалось загрузить таблицу')
    }
  }

  const loadRecords = async (nextOffset = rOffset) => {
    if (!selectedOrgId || !selectedTableId) return
    setRecordsLoading(true)
    setRecordsError('')
    try {
      const r = await superadminTablesApi.listRecords(selectedOrgId, selectedTableId, {
        q: debouncedRecordsQ || undefined,
        sort_col_id: sortColId || undefined,
        sort_dir: sortDir,
        limit: rLimit,
        offset: nextOffset,
      })
      if (r.data.ok && r.data.data) {
        setRecordsPage(r.data.data)
        setROffset(r.data.data.offset)
      } else {
        setRecordsError(r.data.error?.message || 'Не удалось загрузить записи')
      }
    } catch (e: any) {
      setRecordsError(e?.response?.data?.error?.message || 'Не удалось загрузить записи')
    } finally {
      setRecordsLoading(false)
    }
  }

  useEffect(() => {
    setSelectedTableId('')
    setTableDetail(null)
    setRecordsPage(null)
    setOffset(0)
    setROffset(0)
    if (selectedOrgId) void loadTables(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, debouncedTablesQ, limit])

  useEffect(() => {
    setROffset(0)
    if (selectedOrgId && selectedTableId) void loadRecords(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, selectedTableId, debouncedRecordsQ, sortColId, sortDir, rLimit])

  const tables = useMemo(() => tablesPage?.items ?? [], [tablesPage?.items])
  const tTotal = tablesPage?.total || 0
  const tCanPrev = offset > 0
  const tCanNext = offset + limit < tTotal

  const rTotal = recordsPage?.total || 0
  const rCanPrev = rOffset > 0
  const rCanNext = rOffset + rLimit < rTotal

  const cols = tableDetail?.columns || []
  const selectedTableListItem = useMemo(() => tables.find((t) => t.id === selectedTableId) || null, [tables, selectedTableId])

  const selectedTableStats = useMemo(() => {
    return {
      columns: tableDetail?.columns?.length || 0,
      records: selectedTableListItem?.records || recordsPage?.total || 0,
      archived: !!selectedTableListItem?.is_archived,
    }
  }, [tableDetail, recordsPage?.total, selectedTableListItem])

  const exportCsv = async () => {
    if (!selectedOrgId || !selectedTableId) return
    const r = await superadminTablesApi.exportCsv(selectedOrgId, selectedTableId)
    downloadBlob(r.data, `${tableDetail?.name || 'table'}.csv`)
  }

  const exportXlsx = async () => {
    if (!selectedOrgId || !selectedTableId) return
    const r = await superadminTablesApi.exportXlsx(selectedOrgId, selectedTableId)
    downloadBlob(r.data, `${tableDetail?.name || 'table'}.xlsx`)
  }

  if (!selectedOrgId) {
    return (
      <SuperadminEmptyState
        icon={Table2}
        title="Контекст не выбран"
        description="Выберите организацию в модуле Профиль, чтобы работать с таблицами и записями."
      />
    )
  }

  return (
    <section className="rounded-2xl border border-sidebar-border bg-card/90 p-5 lg:p-6 space-y-4">
      <div className="rounded-xl border border-sidebar-border bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-sm">
              <Table2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-none">Таблицы</h2>
              <p className="mt-1 text-sm text-muted-foreground">Просмотр таблиц организации, колонок и записей с экспортом</p>
            </div>
          </div>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-background px-3 py-2 text-sm">
            Всего таблиц: <span className="font-semibold">{tTotal.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-1 rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск таблиц"
              className="flex-1 h-9 px-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm outline-none focus:border-primary"
            />
            <select
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-9 px-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={String(n)}>
                  {n}/стр
                </option>
              ))}
            </select>
          </div>

          {tablesLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка...
            </div>
          )}

          {!tablesLoading && tablesError && <div className="px-4 py-6 text-sm text-destructive">{tablesError}</div>}

          {!tablesLoading && !tablesError && tables.length === 0 && (
            <div className="p-4">
              <SuperadminEmptyState icon={Table2} title="Таблиц пока нет" description="Для выбранной организации пока не создано таблиц." />
            </div>
          )}

          {!tablesLoading && !tablesError && tables.length > 0 && (
            <>
              <div className="max-h-[560px] overflow-auto">
                {tables.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedTableId(t.id)
                      void loadTableDetail(t.id)
                    }}
                    className={`w-full text-left px-4 py-3 border-b border-sidebar-border/40 hover:bg-secondary/10 transition-colors ${
                      selectedTableId === t.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div className="font-medium flex items-center justify-between gap-2">
                      <span className="truncate">{t.name}</span>
                      {t.is_archived && <span className="text-xs text-muted-foreground">архив</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{t.columns} колонок • {t.records} записей</div>
                  </button>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-sidebar-border flex items-center justify-between text-sm">
                <div className="text-muted-foreground">
                  {tTotal > 0 ? (
                    <>
                      {Math.min(tTotal, offset + 1)}–{Math.min(tTotal, offset + limit)} из {tTotal.toLocaleString('ru-RU')}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={!tCanPrev || tablesLoading}
                    onClick={() => void loadTables(Math.max(0, offset - limit))}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
                  >
                    Назад
                  </button>
                  <button
                    disabled={!tCanNext || tablesLoading}
                    onClick={() => void loadTables(offset + limit)}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="xl:col-span-2 space-y-4">
          {!selectedTableId && (
            <SuperadminEmptyState
              icon={Table2}
              title="Выберите таблицу"
              description="Откройте таблицу слева, чтобы увидеть колонки, записи и экспорт данных."
            />
          )}

          {selectedTableId && (
            <div className="rounded-xl border border-sidebar-border bg-sidebar-background/40 overflow-hidden">
              <div className="px-4 py-3 border-b border-sidebar-border flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{tableDetail?.name || 'Таблица'}</div>
                  <div className="text-xs text-muted-foreground truncate">{tableDetail?.description || 'Без описания'}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void exportCsv()}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm flex items-center gap-1.5"
                  >
                    <Download className="h-4 w-4" /> CSV
                  </button>
                  <button
                    onClick={() => void exportXlsx()}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent text-sm flex items-center gap-1.5"
                  >
                    <Download className="h-4 w-4" /> XLSX
                  </button>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-sidebar-border flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
                  Колонок: <span className="font-semibold">{selectedTableStats.columns}</span>
                </span>
                <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
                  Записей: <span className="font-semibold">{selectedTableStats.records}</span>
                </span>
                <span className="rounded-lg border border-sidebar-border bg-sidebar-background px-2.5 py-1 text-xs">
                  Статус: <span className="font-semibold">{selectedTableStats.archived ? 'архив' : 'активна'}</span>
                </span>
              </div>

              <div className="px-4 py-3 border-b border-sidebar-border grid grid-cols-1 lg:grid-cols-4 gap-2">
                <div className="relative lg:col-span-2">
                  <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={recordsQ}
                    onChange={(e) => setRecordsQ(e.target.value)}
                    placeholder="Поиск в записях"
                    className="h-9 w-full pl-9 pr-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm outline-none focus:border-primary"
                  />
                </div>
                <select value={sortColId} onChange={(e) => setSortColId(e.target.value)} className="h-9 px-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm">
                  <option value="">Сортировка: позиция</option>
                  {cols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)} className="h-9 px-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm">
                    <option value="asc">asc</option>
                    <option value="desc">desc</option>
                  </select>
                  <select value={String(rLimit)} onChange={(e) => setRLimit(Number(e.target.value))} className="h-9 px-2 rounded-xl border border-sidebar-border bg-sidebar-background text-sm">
                    {[50, 100, 200].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}/стр
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {recordsLoading && (
                <div className="flex items-center justify-center py-14 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка записей...
                </div>
              )}

              {!recordsLoading && recordsError && <div className="px-4 py-6 text-sm text-destructive">{recordsError}</div>}

              {!recordsLoading && !recordsError && (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-sidebar-border bg-secondary/20">
                        {cols.slice(0, 12).map((c) => (
                          <th key={c.id} className="px-3 py-2 text-left whitespace-nowrap">
                            {c.name}
                          </th>
                        ))}
                        {cols.length > 12 && <th className="px-3 py-2 text-left text-muted-foreground">+{cols.length - 12}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(recordsPage?.items || []).map((r, i) => (
                        <tr key={r.id} className={`border-b border-sidebar-border/40 ${i % 2 === 1 ? 'bg-secondary/5' : ''}`}>
                          {cols.slice(0, 12).map((c) => (
                            <td key={c.id} className="px-3 py-2 align-top">
                              <div className="max-w-[260px] whitespace-pre-wrap break-words">
                                {String((r.data as any)?.[c.id] ?? '') || <span className="text-muted-foreground/40">—</span>}
                              </div>
                            </td>
                          ))}
                          {cols.length > 12 && <td className="px-3 py-2 text-muted-foreground">…</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="px-4 py-3 border-t border-sidebar-border flex items-center justify-between text-sm">
                <div className="text-muted-foreground">
                  {rTotal > 0 ? (
                    <>
                      {Math.min(rTotal, rOffset + 1)}–{Math.min(rTotal, rOffset + rLimit)} из {rTotal.toLocaleString('ru-RU')}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={!rCanPrev || recordsLoading}
                    onClick={() => void loadRecords(Math.max(0, rOffset - rLimit))}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
                  >
                    Назад
                  </button>
                  <button
                    disabled={!rCanNext || recordsLoading}
                    onClick={() => void loadRecords(rOffset + rLimit)}
                    className="h-9 px-3 rounded-xl border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent disabled:opacity-50"
                  >
                    Вперед
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function useDebounced(value: string, delayMs: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])
  return v
}
