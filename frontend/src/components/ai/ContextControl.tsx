import { useMemo, useState } from 'react'
import type { AIContextEstimate, AIContextOptions, AIContextSourcePage, AIContextSourceTable } from '@/lib/api'
import { Database, Search, X } from 'lucide-react'

type Props = {
  includeContext: boolean
  setIncludeContext: (v: boolean) => void
  contextOptions: AIContextOptions
  setContextOptions: (updater: (prev: AIContextOptions) => AIContextOptions) => void
  contextEstimate: AIContextEstimate | null
  contextSources: { kb_pages: AIContextSourcePage[]; tables: AIContextSourceTable[] }
  showSummary?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function TokenSummary({ estimate }: { estimate: AIContextEstimate | null }) {
  const total = estimate?.estimated_total_tokens ?? 0
  const kb = estimate?.sources?.kb?.estimated_tokens ?? 0
  const schema = estimate?.sources?.table_schema?.estimated_tokens ?? 0
  const records = estimate?.sources?.table_records?.estimated_tokens ?? 0
  const schedule = estimate?.sources?.schedule?.estimated_tokens ?? 0
  const overhead = estimate?.model_overhead_tokens ?? 0
  const usedCtx = estimate?.used_context_tokens ?? 0
  const maxCtx = estimate?.max_context_tokens ?? 0
  return (
    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>Запрос: ~{total} токенов (без ответа)</span>
      <span>Контекст: ~{usedCtx}{maxCtx ? `/${maxCtx}` : ''}</span>
      <span>База знаний: {kb}</span>
      <span>Таблицы: {schema}</span>
      <span>Примеры: {records}</span>
      {schedule > 0 && <span>Расписание: {schedule}</span>}
      <span className="text-amber-400">Системные токены: {overhead}</span>
    </div>
  )
}

function SearchWithActions({
  value,
  onChange,
  placeholder,
  onAll,
  onClear,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  onAll: () => void
  onClear: () => void
}) {
  return (
    <div className="h-9 rounded-lg border border-border bg-card flex items-center overflow-hidden">
      <div className="flex-1 min-w-0 flex items-center gap-2 px-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 w-full bg-transparent outline-none text-sm"
          placeholder={placeholder}
        />
      </div>
      <div className="w-px self-stretch bg-border/70" />
      <div className="shrink-0 flex items-center">
        <button onClick={onAll} className="h-9 px-3 text-xs hover:bg-secondary transition-colors">
          Все
        </button>
        <div className="w-px self-stretch bg-border/70" />
        <button onClick={onClear} className="h-9 px-3 text-xs hover:bg-secondary transition-colors">
          Снять
        </button>
      </div>
    </div>
  )
}

export default function ContextControl({
  includeContext,
  setIncludeContext,
  contextOptions,
  setContextOptions,
  contextEstimate,
  contextSources,
  showSummary = true,
  open,
  onOpenChange,
}: Props) {
  const [drawerOpenUncontrolled, setDrawerOpenUncontrolled] = useState(false)
  const drawerOpen = typeof open === 'boolean' ? open : drawerOpenUncontrolled
  const setDrawerOpen = (next: boolean) => {
    onOpenChange?.(next)
    if (typeof open !== 'boolean') setDrawerOpenUncontrolled(next)
  }
  const [kbQuery, setKbQuery] = useState('')
  const [tablesQuery, setTablesQuery] = useState('')

  const kbSelected = contextOptions.selected_kb_page_ids || []
  const tableSelected = contextOptions.selected_table_ids || []

  const filteredKb = useMemo(() => {
    const q = kbQuery.trim().toLowerCase()
    if (!q) return contextSources.kb_pages
    return contextSources.kb_pages.filter((p) => String(p.title || '').toLowerCase().includes(q))
  }, [contextSources.kb_pages, kbQuery])

  const filteredTables = useMemo(() => {
    const q = tablesQuery.trim().toLowerCase()
    if (!q) return contextSources.tables
    return contextSources.tables.filter((t) => String(t.name || '').toLowerCase().includes(q))
  }, [contextSources.tables, tablesQuery])

  const totalObjects = kbSelected.length + tableSelected.length
  const totalTokens = contextEstimate?.estimated_total_tokens ?? 0

  const selectAllKb = () => {
    setContextOptions((prev) => ({ ...prev, selected_kb_page_ids: contextSources.kb_pages.map((p) => p.id) }))
  }
  const clearKb = () => setContextOptions((prev) => ({ ...prev, selected_kb_page_ids: [] }))
  const selectAllTables = () => {
    setContextOptions((prev) => ({ ...prev, selected_table_ids: contextSources.tables.map((t) => t.id) }))
  }
  const clearTables = () => setContextOptions((prev) => ({ ...prev, selected_table_ids: [] }))

  const toggleKb = (id: string) => {
    setContextOptions((prev) => {
      const set = new Set(prev.selected_kb_page_ids || [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, selected_kb_page_ids: Array.from(set) }
    })
  }

  const toggleTable = (id: string) => {
    setContextOptions((prev) => {
      const set = new Set(prev.selected_table_ids || [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...prev, selected_table_ids: Array.from(set) }
    })
  }

  return (
    <>
      {showSummary && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4" />
                <span>Контроль контекста</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>~{totalTokens} токенов (запрос)</span>
                <span>объектов: {totalObjects}</span>
              </div>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className="h-9 px-3 rounded-lg border border-border text-sm hover:bg-secondary transition-colors shrink-0"
            >
              Настроить
            </button>
          </div>

          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/40 col-span-2 md:col-span-1">
                <input type="checkbox" checked={includeContext} onChange={(e) => setIncludeContext(e.target.checked)} className="rounded" />
                Контекст
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/20">
                <input
                  type="checkbox"
                  checked={!!contextOptions.include_kb}
                  onChange={(e) => setContextOptions((p) => ({ ...p, include_kb: e.target.checked }))}
                  className="rounded"
                  disabled={!includeContext}
                />
                База знаний
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/20">
                <input
                  type="checkbox"
                  checked={!!contextOptions.include_table_schema}
                  onChange={(e) => setContextOptions((p) => ({ ...p, include_table_schema: e.target.checked }))}
                  className="rounded"
                  disabled={!includeContext}
                />
                Таблицы
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/20">
                <input
                  type="checkbox"
                  checked={!!contextOptions.include_table_records}
                  onChange={(e) => setContextOptions((p) => ({ ...p, include_table_records: e.target.checked }))}
                  className="rounded"
                  disabled={!includeContext}
                />
                Примеры
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg bg-secondary/20">
                <input
                  type="checkbox"
                  checked={!!contextOptions.include_schedule}
                  onChange={(e) => setContextOptions((p) => ({ ...p, include_schedule: e.target.checked }))}
                  className="rounded"
                  disabled={!includeContext}
                />
                Расписание
              </label>
            </div>
          </div>
        </div>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} aria-label="Закрыть настройки контекста" />
          <div className="absolute right-0 top-0 bottom-0 w-[640px] max-w-[96vw] bg-card border-l border-border p-4 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">Настройка контекста</p>
                <TokenSummary estimate={contextEstimate} />
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors"
                title="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs font-semibold mb-1">Страниц из базы знаний</p>
                <p className="text-[11px] text-muted-foreground mb-2">Сколько страниц максимум добавить в контекст</p>
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={contextOptions.kb_limit ?? 30}
                  onChange={(e) => setContextOptions((p) => ({ ...p, kb_limit: clampInt(e.target.value, p.kb_limit ?? 30, 1, 300) }))}
                  className="h-9 w-full px-3 rounded-lg border border-input bg-background text-sm"
                />
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs font-semibold mb-1">Таблиц</p>
                <p className="text-[11px] text-muted-foreground mb-2">Сколько таблиц максимум учитывать</p>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={contextOptions.tables_limit ?? 20}
                  onChange={(e) => setContextOptions((p) => ({ ...p, tables_limit: clampInt(e.target.value, p.tables_limit ?? 20, 1, 200) }))}
                  className="h-9 w-full px-3 rounded-lg border border-input bg-background text-sm"
                />
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs font-semibold mb-1">Примеров строк на таблицу</p>
                <p className="text-[11px] text-muted-foreground mb-2">Сколько примеров записей добавить</p>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={contextOptions.records_per_table ?? 5}
                  onChange={(e) => setContextOptions((p) => ({ ...p, records_per_table: clampInt(e.target.value, p.records_per_table ?? 5, 1, 20) }))}
                  className="h-9 w-full px-3 rounded-lg border border-input bg-background text-sm"
                />
              </div>
              <div className="rounded-lg border border-border bg-background/40 p-3">
                <p className="text-xs font-semibold mb-1">Лимит токенов контекста</p>
                <p className="text-[11px] text-muted-foreground mb-2">Ограничивает размер контекста, чтобы не раздувать запрос</p>
                <input
                  type="number"
                  min={200}
                  max={20000}
                  value={contextOptions.max_context_tokens ?? 2500}
                  onChange={(e) => setContextOptions((p) => ({ ...p, max_context_tokens: clampInt(e.target.value, p.max_context_tokens ?? 2500, 200, 20000) }))}
                  className="h-9 w-full px-3 rounded-lg border border-input bg-background text-sm"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
              <div className="rounded-xl border border-border bg-background/30 overflow-hidden flex flex-col min-h-0">
                <div className="px-3 py-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">База знаний</p>
                  <span className="text-xs text-muted-foreground">{kbSelected.length}</span>
                </div>
                <div className="px-3 pb-3">
                  <SearchWithActions
                    value={kbQuery}
                    onChange={setKbQuery}
                    placeholder="Поиск страниц"
                    onAll={selectAllKb}
                    onClear={clearKb}
                  />
                </div>
                <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
                  {filteredKb.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Нет страниц</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredKb.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                          <input type="checkbox" checked={kbSelected.includes(p.id)} onChange={() => toggleKb(p.id)} disabled={!includeContext || !contextOptions.include_kb} />
                          <span className="truncate">{p.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/30 overflow-hidden flex flex-col min-h-0">
                <div className="px-3 py-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">Таблицы</p>
                  <span className="text-xs text-muted-foreground">{tableSelected.length}</span>
                </div>
                <div className="px-3 pb-3">
                  <SearchWithActions
                    value={tablesQuery}
                    onChange={setTablesQuery}
                    placeholder="Поиск таблиц"
                    onAll={selectAllTables}
                    onClear={clearTables}
                  />
                </div>
                <div className="px-3 pb-3 overflow-y-auto flex-1 min-h-0">
                  {filteredTables.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Нет таблиц</p>
                  ) : (
                    <div className="space-y-1">
                      {filteredTables.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer py-1">
                          <input type="checkbox" checked={tableSelected.includes(t.id)} onChange={() => toggleTable(t.id)} disabled={!includeContext || (!contextOptions.include_table_schema && !contextOptions.include_table_records)} />
                          <span className="truncate">{t.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border text-[11px] text-muted-foreground">
              Оценка токенов приблизительная и обычно слегка завышена, чтобы не было сюрпризов по расходу.
            </div>
          </div>
        </div>
      )}
    </>
  )
}
