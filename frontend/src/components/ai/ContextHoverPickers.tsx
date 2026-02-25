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
            <TableFolderTreeSelect
              tables={normalizedTables}
              folders={tableFolders}
              selectedIds={selectedTableIds}
              onSelectedIdsChange={(next) => setContextOptions((prev) => ({ ...prev, selected_table_ids: next }))}
              disabled={disableContext}
              emptyText="Нет таблиц"
              heightClassName="max-h-[320px]"
            />
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
