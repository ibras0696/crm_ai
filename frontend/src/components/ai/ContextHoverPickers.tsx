import { useMemo, useRef, useState } from 'react'
import { BookOpen, Database, Layers } from 'lucide-react'
import type { AIContextOptions, AIContextSourcePage, AIContextSourceTable, FolderInfo } from '@/lib/api'
import KbPageTreeSelect from '@/components/common/KbPageTreeSelect'
import TableFolderTreeSelect from '@/components/common/TableFolderTreeSelect'

type Props = {
  includeContext: boolean
  contextOptions: AIContextOptions
  setContextOptions: (updater: (prev: AIContextOptions) => AIContextOptions) => void
  contextSources: { kb_pages: AIContextSourcePage[]; tables: AIContextSourceTable[] }
  tableFolders: FolderInfo[]
  tableFolderById?: Record<string, string | null>
}

type PickerType = 'tables' | 'kb' | null

function clampInt(value: string, fallback: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

export default function ContextHoverPickers({
  includeContext,
  contextOptions,
  setContextOptions,
  contextSources,
  tableFolders,
  tableFolderById,
}: Props) {
  const [openPicker, setOpenPicker] = useState<PickerType>(null)
  const closeTimerRef = useRef<number | null>(null)

  const selectedTableIds = contextOptions.selected_table_ids ?? []
  const selectedKbIds = contextOptions.selected_kb_page_ids ?? []

  const normalizedTables = useMemo(
    () => contextSources.tables.map((t) => ({ id: t.id, name: t.name, folder_id: tableFolderById?.[t.id] ?? null })),
    [contextSources.tables, tableFolderById],
  )

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const open = (type: Exclude<PickerType, null>) => {
    clearCloseTimer()
    setOpenPicker(type)
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => setOpenPicker(null), 120)
  }

  const disableContext = !includeContext

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onMouseEnter={() => open('tables')}
          onMouseLeave={scheduleClose}
          onFocus={() => open('tables')}
          className="h-8 px-2.5 rounded-md border border-border/80 bg-card/70 hover:bg-secondary/50 transition-colors inline-flex items-center gap-1.5 text-xs"
          title="Выбрать таблицы для контекста"
        >
          <Database className="h-3.5 w-3.5 text-blue-400" />
          <span>Таблицы</span>
          <span className="text-muted-foreground">{selectedTableIds.length}</span>
        </button>

        <button
          type="button"
          onMouseEnter={() => open('kb')}
          onMouseLeave={scheduleClose}
          onFocus={() => open('kb')}
          className="h-8 px-2.5 rounded-md border border-border/80 bg-card/70 hover:bg-secondary/50 transition-colors inline-flex items-center gap-1.5 text-xs"
          title="Выбрать страницы базы знаний для контекста"
        >
          <BookOpen className="h-3.5 w-3.5 text-violet-400" />
          <span>База знаний</span>
          <span className="text-muted-foreground">{selectedKbIds.length}</span>
        </button>
      </div>

      {openPicker && (
        <div
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          className="absolute top-10 left-0 z-40 w-[420px] max-w-[86vw] rounded-xl border border-border bg-card shadow-2xl p-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold">
              {openPicker === 'tables' ? 'Таблицы в контексте' : 'База знаний в контексте'}
            </p>
          </div>

          {openPicker === 'tables' ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-background/40 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Данные таблиц:</span>
                  <button
                    type="button"
                    className={`h-7 px-2 rounded-md border text-xs ${contextOptions.table_records_mode !== 'all' ? 'bg-secondary border-primary/40' : 'border-border hover:bg-secondary/50'}`}
                    onClick={() => setContextOptions((prev) => ({ ...prev, table_records_mode: 'sample' }))}
                    disabled={disableContext}
                  >
                    Пример
                  </button>
                  <button
                    type="button"
                    className={`h-7 px-2 rounded-md border text-xs ${contextOptions.table_records_mode === 'all' ? 'bg-secondary border-primary/40' : 'border-border hover:bg-secondary/50'}`}
                    onClick={() => setContextOptions((prev) => ({ ...prev, table_records_mode: 'all' }))}
                    disabled={disableContext}
                  >
                    Все данные
                  </button>
                </div>

                {contextOptions.table_records_mode !== 'all' && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Строк на таблицу:</span>
                    {[1, 3, 5, 10].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`h-7 px-2 rounded-md border text-xs ${Number(contextOptions.records_per_table ?? 5) === n ? 'bg-secondary border-primary/40' : 'border-border hover:bg-secondary/50'}`}
                        onClick={() => setContextOptions((prev) => ({ ...prev, records_per_table: n, table_records_mode: 'sample' }))}
                        disabled={disableContext}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={contextOptions.records_per_table ?? 5}
                      onChange={(e) =>
                        setContextOptions((prev) => ({
                          ...prev,
                          records_per_table: clampInt(e.target.value, prev.records_per_table ?? 5, 1, 20),
                          table_records_mode: 'sample',
                        }))
                      }
                      disabled={disableContext}
                      className="h-7 w-16 px-2 rounded-md border border-input bg-background text-xs"
                    />
                  </div>
                )}
                {contextOptions.table_records_mode === 'all' && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Будут подгружены все строки выбранных таблиц (с серверным ограничением).
                  </p>
                )}
              </div>

              <TableFolderTreeSelect
                tables={normalizedTables}
                folders={tableFolders}
                selectedIds={selectedTableIds}
                onSelectedIdsChange={(next) => setContextOptions((prev) => ({ ...prev, selected_table_ids: next }))}
                disabled={disableContext}
                emptyText="Нет таблиц"
                heightClassName="max-h-[320px]"
              />
            </div>
          ) : (
            <KbPageTreeSelect
              pages={contextSources.kb_pages}
              selectedIds={selectedKbIds}
              onSelectedIdsChange={(next) => setContextOptions((prev) => ({ ...prev, selected_kb_page_ids: next }))}
              disabled={disableContext}
              emptyText="Нет страниц"
              heightClassName="max-h-[320px]"
            />
          )}

          <p className="text-[11px] text-muted-foreground mt-2">
            В контекст попадает только выбранное. Автоподбор отключен.
          </p>
        </div>
      )}
    </div>
  )
}
