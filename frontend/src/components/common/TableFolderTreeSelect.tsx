import { useMemo, useState } from 'react'
import type { FolderInfo } from '@/lib/api'
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search } from 'lucide-react'

type SelectableTable = {
  id: string
  name: string
  folder_id: string | null
}

type Props = {
  tables: SelectableTable[]
  folders: FolderInfo[]
  selectedIds: string[]
  onSelectedIdsChange: (next: string[]) => void
  disabled?: boolean
  emptyText?: string
  heightClassName?: string
}

function buildChildrenMap(folders: FolderInfo[]) {
  const map: Record<string, FolderInfo[]> = {}
  for (const f of folders) {
    const key = f.parent_id ?? 'root'
    map[key] = map[key] ?? []
    map[key].push(f)
  }
  for (const key of Object.keys(map)) {
    map[key]?.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position
      return a.name.localeCompare(b.name, 'ru')
    })
  }
  return map
}

export default function TableFolderTreeSelect({
  tables,
  folders,
  selectedIds,
  onSelectedIdsChange,
  disabled = false,
  emptyText = 'Нет таблиц',
  heightClassName = 'max-h-64',
}: Props) {
  const [query, setQuery] = useState('')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const childrenMap = useMemo(() => buildChildrenMap(folders), [folders])
  const tablesByFolder = useMemo(() => {
    const map: Record<string, SelectableTable[]> = {}
    for (const t of tables) {
      const key = t.folder_id ?? 'root'
      map[key] = map[key] ?? []
      map[key].push(t)
    }
    for (const key of Object.keys(map)) {
      map[key]?.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    }
    return map
  }, [tables])

  const q = query.trim().toLowerCase()
  const tableMatches = useMemo(() => {
    if (!q) return new Set(tables.map(t => t.id))
    return new Set(
      tables
        .filter(t => t.name.toLowerCase().includes(q))
        .map(t => t.id),
    )
  }, [tables, q])

  const folderVisible = useMemo(() => {
    const visible = new Set<string>()

    const dfs = (folderId: string): boolean => {
      const folder = folders.find(f => f.id === folderId)
      if (!folder) return false
      const nameMatch = folder.name.toLowerCase().includes(q)
      const ownTableMatch = (tablesByFolder[folderId] ?? []).some(t => tableMatches.has(t.id))
      const childMatch = (childrenMap[folderId] ?? []).some(ch => dfs(ch.id))
      const ok = !q || nameMatch || ownTableMatch || childMatch
      if (ok) visible.add(folderId)
      return ok
    }

    for (const root of childrenMap.root ?? []) dfs(root.id)
    return visible
  }, [folders, childrenMap, tablesByFolder, tableMatches, q])

  const toggleTable = (id: string) => {
    const set = new Set(selectedIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onSelectedIdsChange(Array.from(set))
  }

  const renderFolder = (folder: FolderInfo, depth = 0): JSX.Element | null => {
    if (!folderVisible.has(folder.id)) return null
    const forcedOpen = q.length > 0
    const isOpen = forcedOpen || openFolders[folder.id] !== false
    const folderTables = (tablesByFolder[folder.id] ?? []).filter(t => tableMatches.has(t.id))
    const childFolders = (childrenMap[folder.id] ?? []).filter(f => folderVisible.has(f.id))
    const hasChildren = folderTables.length > 0 || childFolders.length > 0
    return (
      <div key={folder.id} className="space-y-1">
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/40"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            type="button"
            onClick={() => setOpenFolders(prev => ({ ...prev, [folder.id]: !isOpen }))}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground"
            disabled={!hasChildren || forcedOpen}
          >
            {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
          </button>
          {isOpen ? <FolderOpen className="h-4 w-4 text-amber-400" /> : <Folder className="h-4 w-4 text-amber-400" />}
          <span className="text-sm truncate">{folder.name}</span>
        </div>

        {isOpen && (
          <>
            {folderTables.map(table => (
              <label
                key={table.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/30 cursor-pointer"
                style={{ paddingLeft: `${32 + depth * 16}px` }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(table.id)}
                  onChange={() => toggleTable(table.id)}
                  disabled={disabled}
                  className="h-4 w-4"
                />
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm truncate">{table.name}</span>
              </label>
            ))}
            {childFolders.map(child => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const rootTables = (tablesByFolder.root ?? []).filter(t => tableMatches.has(t.id))
  const rootFolders = (childrenMap.root ?? []).filter(f => folderVisible.has(f.id))
  const visibleTableCount = rootTables.length + tables.filter(t => t.folder_id && tableMatches.has(t.id)).length

  if (tables.length === 0) {
    return <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">{emptyText}</div>
  }

  return (
    <div className="space-y-2">
      <div className="h-9 rounded-lg border border-border bg-card/70 flex items-center gap-2 px-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск таблиц и папок"
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <button
          type="button"
          onClick={() => onSelectedIdsChange(tables.map(t => t.id))}
          className="text-xs h-7 px-2 rounded-md border border-border hover:bg-secondary"
          disabled={disabled}
        >
          Все
        </button>
        <button
          type="button"
          onClick={() => onSelectedIdsChange([])}
          className="text-xs h-7 px-2 rounded-md border border-border hover:bg-secondary"
          disabled={disabled}
        >
          Снять
        </button>
      </div>

      <div className={`${heightClassName} overflow-auto rounded-lg border border-border bg-background/30 p-2 space-y-1`}>
        {visibleTableCount === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-1">{emptyText}</p>
        ) : (
          <>
            {rootTables.map(table => (
              <label key={table.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(table.id)}
                  onChange={() => toggleTable(table.id)}
                  disabled={disabled}
                  className="h-4 w-4"
                />
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm truncate">{table.name}</span>
              </label>
            ))}
            {rootFolders.map(folder => renderFolder(folder))}
          </>
        )}
      </div>
    </div>
  )
}

