import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FolderInfo, TableInfo, tablesApi } from '@/lib/api'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Table2,
  Trash2,
  X,
} from 'lucide-react'

const MAX_FOLDER_DEPTH = 2
const MAX_NAME_LENGTH = 120
const colorOptions = ['blue', 'purple', 'emerald', 'amber', 'pink', 'cyan', 'red']
const colorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400',
  purple: 'bg-purple-500/10 text-purple-400',
  emerald: 'bg-emerald-500/10 text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-400',
  pink: 'bg-pink-500/10 text-pink-400',
  cyan: 'bg-cyan-500/10 text-cyan-400',
  red: 'bg-red-500/10 text-red-400',
}

type ChildrenMap = Record<string, FolderInfo[]>

function buildChildrenMap(folders: FolderInfo[]): ChildrenMap {
  const map: ChildrenMap = {}
  for (const f of folders) {
    const key = f.parent_id ?? 'root'
    map[key] = map[key] ?? []
    map[key].push(f)
  }
  for (const key of Object.keys(map)) {
    const bucket = map[key]
    if (!bucket) continue
    bucket.sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position
      return a.created_at.localeCompare(b.created_at)
    })
  }
  return map
}

function getFolderDepth(folderId: string, byId: Map<string, FolderInfo>): number {
  let depth = 0
  let cursor = byId.get(folderId)
  while (cursor?.parent_id) {
    depth += 1
    const next = byId.get(cursor.parent_id)
    if (!next) break
    cursor = next
  }
  return depth
}

function collectDescendants(folderId: string, childrenMap: ChildrenMap): Set<string> {
  const result = new Set<string>()
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = childrenMap[current] ?? []
    for (const child of children) {
      if (!result.has(child.id)) {
        result.add(child.id)
        stack.push(child.id)
      }
    }
  }
  return result
}

function extractApiError(e: unknown, fallback: string): string {
  if (!isAxiosError(e)) return fallback
  const msg = (e.response?.data as { error?: { message?: string } } | undefined)?.error?.message
  return msg || fallback
}

interface TableCardProps {
  table: TableInfo
  folders: FolderInfo[]
  dragging: boolean
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onMoveToFolder: (tableId: string, folderId: string | null) => void
  onDragStart: (tableId: string) => void
  onDragEnd: () => void
}

function TableCard({
  table,
  folders,
  dragging,
  onDelete,
  onRename,
  onMoveToFolder,
  onDragStart,
  onDragEnd,
}: TableCardProps) {
  const navigate = useNavigate()
  const cls = colorMap[table.color || 'blue'] ?? 'bg-blue-500/10 text-blue-400'
  const [bgCls, iconCls] = cls.split(' ')
  const [showMove, setShowMove] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(table.name)
  const [renameError, setRenameError] = useState('')

  const handleRename = () => {
    const name = editName.trim()
    if (!name) {
      setRenameError('Название не может быть пустым')
      setEditName(table.name)
      return
    }
    if (name.length > MAX_NAME_LENGTH) {
      setRenameError(`Максимум ${MAX_NAME_LENGTH} символов`)
      return
    }
    if (name !== table.name) onRename(table.id, name)
    setRenameError('')
    setEditing(false)
  }

  return (
    <Card
      draggable
      onDragStart={() => onDragStart(table.id)}
      onDragEnd={onDragEnd}
      className={`border-border/50 hover:border-border transition-colors cursor-pointer group relative ${dragging ? 'opacity-50' : ''}`}
      onClick={() => navigate(`/tables/${table.id}`)}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`rounded-lg p-2.5 ${bgCls}`}>
            <FileText className={`h-5 w-5 ${iconCls ?? 'text-blue-400'}`} />
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity">
            {folders.length > 0 && (
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setShowMove(v => !v) }}
                  className="text-muted-foreground hover:text-foreground p-1"
                  title="Переместить в папку"
                >
                  <Folder className="h-4 w-4" />
                </button>
                {showMove && (
                  <div
                    className="absolute right-0 top-7 z-50 min-w-[190px] rounded-lg border border-border bg-popover shadow-lg py-1"
                    onClick={e => e.stopPropagation()}
                  >
                    {table.folder_id && (
                      <button
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                        onClick={() => { onMoveToFolder(table.id, null); setShowMove(false) }}
                      >
                        В корень
                      </button>
                    )}
                    {folders.filter(f => f.id !== table.folder_id).map(f => (
                      <button
                        key={f.id}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                        onClick={() => { onMoveToFolder(table.id, f.id); setShowMove(false) }}
                      >
                        {f.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); setEditName(table.name) }}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Переименовать"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(table.id) }}
              className="text-muted-foreground hover:text-destructive p-1"
              title="Удалить"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') {
                setEditName(table.name)
                setEditing(false)
              }
            }}
            onClick={e => e.stopPropagation()}
            className="mt-3 w-full bg-transparent border-b border-primary outline-none text-base font-semibold"
          />
        ) : (
          <h3 className="font-semibold mt-3 break-all line-clamp-2" title={table.name}>{table.name}</h3>
        )}
        {editing && renameError && <p className="mt-1 text-xs text-destructive">{renameError}</p>}
        {table.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{table.description}</p>}
        <div className="flex items-center gap-2 mt-3">
          <Badge variant="secondary" className="text-xs">
            <Columns3 className="h-3 w-3 mr-1" />
            {table.columns.length} полей
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

interface FolderNodeProps {
  folder: FolderInfo
  depth: number
  childrenMap: ChildrenMap
  tables: TableInfo[]
  allFolders: FolderInfo[]
  openState: Record<string, boolean>
  dropTarget: string | null
  draggedTableId: string | null
  draggedFolderId: string | null
  onToggle: (id: string) => void
  onDeleteFolder: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
  onCreateSubFolder: (parentId: string) => void
  onCreateTableInFolder: (folderId: string) => void
  onDeleteTable: (id: string) => void
  onRenameTable: (id: string, name: string) => void
  onMoveToFolder: (tableId: string, folderId: string | null) => void
  onMoveFolder: (folderId: string, parentId: string | null) => Promise<void>
  getMoveCandidates: (folderId: string) => FolderInfo[]
  onDragStart: (tableId: string) => void
  onDragStartFolder: (folderId: string) => void
  onDragEnd: () => void
  onDropTargetChange: (target: string | null) => void
}

function FolderNode({
  folder,
  depth,
  childrenMap,
  tables,
  allFolders,
  openState,
  dropTarget,
  draggedTableId,
  draggedFolderId,
  onToggle,
  onDeleteFolder,
  onRenameFolder,
  onCreateSubFolder,
  onCreateTableInFolder,
  onDeleteTable,
  onRenameTable,
  onMoveToFolder,
  onMoveFolder,
  getMoveCandidates,
  onDragStart,
  onDragStartFolder,
  onDragEnd,
  onDropTargetChange,
}: FolderNodeProps) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(folder.name)
  const [renameError, setRenameError] = useState('')

  const isOpen = openState[folder.id] ?? true
  const subFolders = childrenMap[folder.id] ?? []
  const folderTables = tables.filter(t => t.folder_id === folder.id)
  const moveCandidates = getMoveCandidates(folder.id)
  const canCreateSubFolder = depth < MAX_FOLDER_DEPTH
  const isDropActive = dropTarget === folder.id
  const isDraggingFolder = draggedFolderId === folder.id

  const handleRename = () => {
    const name = editName.trim()
    if (!name) {
      setRenameError('Название не может быть пустым')
      return
    }
    if (name.length > MAX_NAME_LENGTH) {
      setRenameError(`Максимум ${MAX_NAME_LENGTH} символов`)
      return
    }
    if (name && name !== folder.name) onRenameFolder(folder.id, name)
    setRenameError('')
    setEditing(false)
  }

  const handleDrop = async () => {
    if (draggedTableId) {
      await onMoveToFolder(draggedTableId, folder.id)
      onDropTargetChange(null)
      return
    }
    if (draggedFolderId) {
      await onMoveFolder(draggedFolderId, folder.id)
    }
    onDropTargetChange(null)
  }

  return (
    <div className="space-y-3">
      <div
        draggable
        onDragStart={() => onDragStartFolder(folder.id)}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-2 group/folder rounded-lg px-2 py-1 transition-colors ${isDropActive ? 'bg-primary/10 border border-primary/40' : 'border border-transparent'} ${isDraggingFolder ? 'opacity-50' : ''}`}
        onDragOver={e => {
          if (!draggedTableId && !draggedFolderId) return
          e.preventDefault()
          onDropTargetChange(folder.id)
        }}
        onDragLeave={() => {
          if (dropTarget === folder.id) onDropTargetChange(null)
        }}
        onDrop={e => {
          e.preventDefault()
          void handleDrop()
        }}
      >
        <button
          onClick={() => onToggle(folder.id)}
          className="flex items-center gap-2 flex-1 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
        >
          {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {isOpen ? <FolderOpen className="h-4 w-4 text-amber-400" /> : <Folder className="h-4 w-4 text-amber-400" />}
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              onBlur={handleRename}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              onClick={e => e.stopPropagation()}
              className="bg-transparent border-b border-primary outline-none text-sm font-medium"
            />
          ) : (
            <span className="truncate max-w-[36ch]" title={folder.name}>{folder.name}</span>
          )}
          <Badge variant="outline" className="text-xs ml-1">{folderTables.length}</Badge>
          {isDropActive && <span className="text-xs text-primary">Отпустите для перемещения</span>}
        </button>

        <div className="flex items-center gap-1 opacity-0 group-hover/folder:opacity-100 max-md:opacity-100 transition-opacity">
          {canCreateSubFolder && (
            <button
              onClick={() => onCreateSubFolder(folder.id)}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Создать подпапку"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => onCreateTableInFolder(folder.id)}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Создать таблицу в папке"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setEditing(true); setEditName(folder.name) }}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Переименовать"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDeleteFolder(folder.id)}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Удалить"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {editing && renameError && <p className="ml-8 -mt-1 text-xs text-destructive">{renameError}</p>}

      {isOpen && (
        <div className="space-y-4 ml-6">
          {folderTables.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folderTables.map(t => (
                <TableCard
                  key={t.id}
                  table={t}
                  folders={moveCandidates}
                  dragging={draggedTableId === t.id}
                  onDelete={onDeleteTable}
                  onRename={onRenameTable}
                  onMoveToFolder={onMoveToFolder}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ))}
            </div>
          )}

          {subFolders.map(child => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              tables={tables}
              allFolders={allFolders}
              openState={openState}
              dropTarget={dropTarget}
              draggedTableId={draggedTableId}
              draggedFolderId={draggedFolderId}
              onToggle={onToggle}
              onDeleteFolder={onDeleteFolder}
              onRenameFolder={onRenameFolder}
              onCreateSubFolder={onCreateSubFolder}
              onCreateTableInFolder={onCreateTableInFolder}
              onDeleteTable={onDeleteTable}
              onRenameTable={onRenameTable}
              onMoveToFolder={onMoveToFolder}
              onMoveFolder={onMoveFolder}
              getMoveCandidates={getMoveCandidates}
              onDragStart={onDragStart}
              onDragStartFolder={onDragStartFolder}
              onDragEnd={onDragEnd}
              onDropTargetChange={onDropTargetChange}
            />
          ))}

          {folderTables.length === 0 && subFolders.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
              Папка пуста
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TablesPage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createColor, setCreateColor] = useState('blue')
  const [createFolderId, setCreateFolderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [createParentId, setCreateParentId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const [draggedTableId, setDraggedTableId] = useState<string | null>(null)
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const foldersById = useMemo(() => new Map(folders.map(f => [f.id, f])), [folders])
  const childrenMap = useMemo(() => buildChildrenMap(folders), [folders])
  const rootFolders = childrenMap.root ?? []
  const rootTables = tables.filter(t => !t.folder_id)

  const folderDepthById = useMemo(() => {
    const map: Record<string, number> = {}
    for (const folder of folders) {
      map[folder.id] = getFolderDepth(folder.id, foldersById)
    }
    return map
  }, [folders, foldersById])

  const load = async () => {
    try {
      const [tablesResp, foldersResp] = await Promise.all([tablesApi.list(), tablesApi.listFolders()])
      if (tablesResp.data.ok && tablesResp.data.data) setTables(tablesResp.data.data)
      if (foldersResp.data.ok && foldersResp.data.data) {
        const list = foldersResp.data.data
        setFolders(list)
        setOpenFolders(prev => {
          const next = { ...prev }
          for (const f of list) if (next[f.id] === undefined) next[f.id] = true
          return next
        })
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const allowedParentFolders = useMemo(() => {
    return folders.filter(f => (folderDepthById[f.id] ?? 0) < MAX_FOLDER_DEPTH)
  }, [folders, folderDepthById])

  const handleCreate = async (folderId?: string | null) => {
    if (!createName.trim()) return
    if (createName.trim().length > MAX_NAME_LENGTH) {
      setActionError(`Название таблицы: максимум ${MAX_NAME_LENGTH} символов`)
      return
    }
    setCreating(true)
    try {
      const resp = await tablesApi.create({
        name: createName.trim(),
        description: createDesc || undefined,
        color: createColor,
        folder_id: folderId ?? createFolderId ?? undefined,
      })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => [resp.data.data!, ...prev])
        setActionError('')
        setShowCreate(false)
        setCreateName('')
        setCreateDesc('')
        setCreateFolderId(null)
      }
    } catch (e) {
      setActionError(extractApiError(e, 'Не удалось создать таблицу'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await tablesApi.delete(id)
      setTables(prev => prev.filter(t => t.id !== id))
    } catch {
      // ignore
    }
  }

  const handleRenameTable = async (id: string, name: string) => {
    if (!name.trim() || name.trim().length > MAX_NAME_LENGTH) {
      setActionError(`Название таблицы должно быть от 1 до ${MAX_NAME_LENGTH} символов`)
      return
    }
    try {
      const resp = await tablesApi.update(id, { name })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => prev.map(t => (t.id === id ? resp.data.data! : t)))
        setActionError('')
      }
    } catch (e) {
      setActionError(extractApiError(e, 'Не удалось переименовать таблицу'))
    }
  }

  const handleMoveToFolder = async (tableId: string, folderId: string | null) => {
    try {
      const resp = await tablesApi.update(tableId, { folder_id: folderId })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => prev.map(t => (t.id === tableId ? resp.data.data! : t)))
      }
    } catch {
      // ignore
    }
  }

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    if (folderId === parentId) return
    if (parentId) {
      const descendants = collectDescendants(folderId, childrenMap)
      if (descendants.has(parentId)) return
    }
    try {
      const resp = await tablesApi.updateFolder(folderId, { parent_id: parentId })
      if (resp.data.ok && resp.data.data) {
        setFolders(prev => prev.map(f => (f.id === folderId ? resp.data.data! : f)))
      }
    } catch {
      // ignore
    }
  }

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return
    if (folderName.trim().length > MAX_NAME_LENGTH) {
      setActionError(`Название папки: максимум ${MAX_NAME_LENGTH} символов`)
      return
    }
    setCreatingFolder(true)
    try {
      const resp = await tablesApi.createFolder({
        name: folderName.trim(),
        parent_id: createParentId,
      })
      if (resp.data.ok && resp.data.data) {
        setFolders(prev => [...prev, resp.data.data!])
        setActionError('')
        setOpenFolders(prev => ({ ...prev, [resp.data.data!.id]: true }))
        setFolderName('')
        setCreateParentId(null)
        setShowCreateFolder(false)
      }
    } catch (e) {
      setActionError(extractApiError(e, 'Не удалось создать папку'))
    } finally {
      setCreatingFolder(false)
    }
  }

  const handleCreateSubFolder = (parentId: string) => {
    setCreateParentId(parentId)
    setShowCreateFolder(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeleteFolder = async (id: string) => {
    try {
      await tablesApi.deleteFolder(id)
      setFolders(prev => prev.filter(f => f.id !== id))
      setTables(prev => prev.map(t => (t.folder_id === id ? { ...t, folder_id: null } : t)))
      setOpenFolders(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    } catch {
      // ignore
    }
  }

  const handleRenameFolder = async (id: string, name: string) => {
    if (!name.trim() || name.trim().length > MAX_NAME_LENGTH) {
      setActionError(`Название папки должно быть от 1 до ${MAX_NAME_LENGTH} символов`)
      return
    }
    try {
      const resp = await tablesApi.updateFolder(id, { name })
      if (resp.data.ok && resp.data.data) {
        setFolders(prev => prev.map(f => (f.id === id ? resp.data.data! : f)))
        setActionError('')
      }
    } catch (e) {
      setActionError(extractApiError(e, 'Не удалось переименовать папку'))
    }
  }

  const handleCreateTableInFolder = (folderId: string) => {
    setCreateFolderId(folderId)
    setShowCreate(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleFolder = (id: string) => {
    setOpenFolders(prev => ({ ...prev, [id]: !(prev[id] ?? true) }))
  }

  const getMoveCandidatesForFolder = (folderId: string) => {
    const descendants = collectDescendants(folderId, childrenMap)
    return folders.filter(f => f.id !== folderId && !descendants.has(f.id) && (folderDepthById[f.id] ?? 0) < MAX_FOLDER_DEPTH)
  }

  const handleDragStart = (tableId: string) => {
    setDraggedFolderId(null)
    setDraggedTableId(tableId)
  }

  const handleDragStartFolder = (folderId: string) => {
    setDraggedTableId(null)
    setDraggedFolderId(folderId)
  }

  const handleDragEnd = () => {
    setDraggedTableId(null)
    setDraggedFolderId(null)
    setDropTarget(null)
  }

  const handleDropToRoot = async () => {
    if (draggedTableId) {
      await handleMoveToFolder(draggedTableId, null)
    } else if (draggedFolderId) {
      await handleMoveFolder(draggedFolderId, null)
    } else {
      return
    }
    setDropTarget(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isEmpty = tables.length === 0 && folders.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Таблицы</h1>
          <p className="text-muted-foreground mt-1">Конструктор таблиц с папками и вложенностью до 2 уровней</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => setShowCreateFolder(v => !v)} title={showCreateFolder ? 'Отмена' : 'Папка'}>
            {showCreateFolder ? <X className="h-4 w-4 sm:mr-2" /> : <FolderPlus className="h-4 w-4 sm:mr-2" />}
            <span className="hidden sm:inline">{showCreateFolder ? 'Отмена' : 'Папка'}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => { setCreateFolderId(null); setShowCreate(v => !v) }}
            className="gradient-primary border-0 text-white"
            title={showCreate ? 'Отмена' : 'Новая таблица'}
          >
            {showCreate ? <X className="h-4 w-4 sm:mr-2" /> : <Plus className="h-4 w-4 sm:mr-2" />}
            <span className="hidden sm:inline">{showCreate ? 'Отмена' : 'Новая таблица'}</span>
          </Button>
        </div>
      </div>
      {actionError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {showCreateFolder && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <FolderPlus className="h-4 w-4 text-amber-400 shrink-0" />
              <Input
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Название папки"
                className="bg-background"
                onKeyDown={e => { if (e.key === 'Enter') void handleCreateFolder() }}
                autoFocus
              />
              <Button onClick={() => void handleCreateFolder()} disabled={creatingFolder || !folderName.trim()} size="sm">
                {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Родительская папка (необязательно)</Label>
              <select
                value={createParentId ?? ''}
                onChange={e => setCreateParentId(e.target.value || null)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm"
              >
                <option value="">Корень</option>
                {allowedParentFolders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Максимальная вложенность: 2 уровня</p>
            </div>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 space-y-4">
            {createFolderId && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Folder className="h-4 w-4 text-amber-400" />
                <span>Папка: <strong className="text-foreground">{folders.find(f => f.id === createFolderId)?.name}</strong></span>
                <button onClick={() => setCreateFolderId(null)} className="hover:text-foreground ml-1" title="Убрать папку">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  maxLength={MAX_NAME_LENGTH}
                  placeholder="Например: Клиенты"
                  className="bg-background"
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreate() }}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="Необязательно" className="bg-background" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Цвет</Label>
              <div className="flex gap-2">
                {colorOptions.map(c => (
                  <button
                    key={c}
                    onClick={() => setCreateColor(c)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${colorMap[c]?.split(' ')[0]} ${createColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    title={c}
                  />
                ))}
              </div>
            </div>

            {folders.length > 0 && !createFolderId && (
              <div className="space-y-2">
                <Label>Папка (необязательно)</Label>
                <div className="flex flex-wrap gap-2">
                  {folders.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setCreateFolderId(f.id)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:border-amber-400/50 hover:bg-amber-500/5 transition-colors"
                    >
                      <Folder className="h-3.5 w-3.5 text-amber-400" />
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={() => void handleCreate()} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Создать таблицу
            </Button>
          </CardContent>
        </Card>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Table2 className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">Нет таблиц</p>
          <p className="text-sm">Создайте первую таблицу или папку для начала работы</p>
        </div>
      ) : (
        <div className="space-y-8">
          {rootFolders.map(folder => (
            <FolderNode
              key={folder.id}
              folder={folder}
              depth={0}
              childrenMap={childrenMap}
              tables={tables}
              allFolders={folders}
              openState={openFolders}
              dropTarget={dropTarget}
              draggedTableId={draggedTableId}
              draggedFolderId={draggedFolderId}
              onToggle={toggleFolder}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              onCreateSubFolder={handleCreateSubFolder}
              onCreateTableInFolder={handleCreateTableInFolder}
              onDeleteTable={handleDelete}
              onRenameTable={handleRenameTable}
              onMoveToFolder={handleMoveToFolder}
              onMoveFolder={handleMoveFolder}
              getMoveCandidates={getMoveCandidatesForFolder}
              onDragStart={handleDragStart}
              onDragStartFolder={handleDragStartFolder}
              onDragEnd={handleDragEnd}
              onDropTargetChange={setDropTarget}
            />
          ))}

          <div
            className={`space-y-3 rounded-lg border p-3 transition-colors ${dropTarget === 'root' ? 'border-primary/50 bg-primary/5' : 'border-border/40'}`}
            onDragOver={e => {
              if (!draggedTableId && !draggedFolderId) return
              e.preventDefault()
              setDropTarget('root')
            }}
            onDragLeave={() => {
              if (dropTarget === 'root') setDropTarget(null)
            }}
            onDrop={e => {
              e.preventDefault()
              void handleDropToRoot()
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">Без папки</span>
              <Badge variant="outline" className="text-xs">{rootTables.length}</Badge>
              {dropTarget === 'root' && <span className="text-xs text-primary">Отпустите для перемещения в корень</span>}
            </div>

            {rootTables.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rootTables.map(t => (
                  <TableCard
                    key={t.id}
                  table={t}
                  folders={folders}
                  dragging={draggedTableId === t.id}
                  onDelete={handleDelete}
                  onRename={handleRenameTable}
                  onMoveToFolder={handleMoveToFolder}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
                Перетащите сюда таблицу или папку, чтобы убрать из папки
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
