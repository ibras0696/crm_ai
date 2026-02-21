import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { tablesApi, TableInfo, FolderInfo } from '@/lib/api'
import {
  Plus, FileText, Loader2, Trash2, Table2, Columns3, X,
  Folder, FolderOpen, ChevronDown, ChevronRight, FolderPlus, Pencil, Check,
} from 'lucide-react'

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

interface TableCardProps {
  table: TableInfo
  onDelete: (id: string) => void
  onMoveToFolder: (tableId: string, folderId: string | null) => void
  folders: FolderInfo[]
}

function TableCard({ table, onDelete, onMoveToFolder, folders }: TableCardProps) {
  const navigate = useNavigate()
  const cls = colorMap[table.color || 'blue'] || colorMap.blue
  const [showMove, setShowMove] = useState(false)

  return (
    <Card
      className="border-border/50 hover:border-border transition-colors cursor-pointer group relative"
      onClick={() => navigate(`/tables/${table.id}`)}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className={`rounded-lg p-2.5 ${cls.split(' ')[0]}`}>
            <FileText className={`h-5 w-5 ${cls.split(' ')[1]}`} />
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    className="absolute right-0 top-7 z-50 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg py-1"
                    onClick={e => e.stopPropagation()}
                  >
                    {table.folder_id && (
                      <button
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent"
                        onClick={() => { onMoveToFolder(table.id, null); setShowMove(false) }}
                      >
                        Убрать из папки
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
              onClick={e => { e.stopPropagation(); onDelete(table.id) }}
              className="text-muted-foreground hover:text-destructive p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <h3 className="font-semibold mt-3">{table.name}</h3>
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

interface FolderSectionProps {
  folder: FolderInfo
  tables: TableInfo[]
  allFolders: FolderInfo[]
  onDeleteFolder: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteTable: (id: string) => void
  onMoveToFolder: (tableId: string, folderId: string | null) => void
  onCreateTableInFolder: (folderId: string) => void
}

function FolderSection({
  folder, tables, allFolders, onDeleteFolder, onRenameFolder,
  onDeleteTable, onMoveToFolder, onCreateTableInFolder,
}: FolderSectionProps) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(folder.name)

  const handleRename = () => {
    if (editName.trim() && editName !== folder.name) {
      onRenameFolder(folder.id, editName.trim())
    }
    setEditing(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 group/folder">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 flex-1 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {open ? <FolderOpen className="h-4 w-4 text-amber-400" /> : <Folder className="h-4 w-4 text-amber-400" />}
          {editing ? (
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false) }}
              onClick={e => e.stopPropagation()}
              className="bg-transparent border-b border-primary outline-none text-sm font-medium"
            />
          ) : (
            <span>{folder.name}</span>
          )}
          <Badge variant="outline" className="text-xs ml-1">{tables.length}</Badge>
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover/folder:opacity-100 transition-opacity">
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
            title="Удалить папку"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {open && (
        tables.length === 0 ? (
          <div className="ml-6 py-4 text-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-lg">
            Папка пуста
          </div>
        ) : (
          <div className="ml-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tables.map(t => (
              <TableCard
                key={t.id}
                table={t}
                onDelete={onDeleteTable}
                onMoveToFolder={onMoveToFolder}
                folders={allFolders}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

export default function TablesPage() {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [loading, setLoading] = useState(true)

  // Create table state
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createColor, setCreateColor] = useState('blue')
  const [createFolderId, setCreateFolderId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Create folder state
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  const load = async () => {
    try {
      const [tablesResp, foldersResp] = await Promise.all([
        tablesApi.list(),
        tablesApi.listFolders(),
      ])
      if (tablesResp.data.ok && tablesResp.data.data) setTables(tablesResp.data.data)
      if (foldersResp.data.ok && foldersResp.data.data) setFolders(foldersResp.data.data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (folderId?: string | null) => {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const resp = await tablesApi.create({
        name: createName,
        description: createDesc || undefined,
        color: createColor,
        folder_id: folderId ?? createFolderId ?? undefined,
      })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => [resp.data.data!, ...prev])
        setShowCreate(false)
        setCreateName('')
        setCreateDesc('')
        setCreateFolderId(null)
      }
    } catch { /* ignore */ }
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    try {
      await tablesApi.delete(id)
      setTables(prev => prev.filter(t => t.id !== id))
    } catch { /* ignore */ }
  }

  const handleMoveToFolder = async (tableId: string, folderId: string | null) => {
    try {
      const resp = await tablesApi.update(tableId, { folder_id: folderId })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => prev.map(t => t.id === tableId ? resp.data.data! : t))
      }
    } catch { /* ignore */ }
  }

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return
    setCreatingFolder(true)
    try {
      const resp = await tablesApi.createFolder({ name: folderName.trim() })
      if (resp.data.ok && resp.data.data) {
        setFolders(prev => [...prev, resp.data.data!])
        setFolderName('')
        setShowCreateFolder(false)
      }
    } catch { /* ignore */ }
    setCreatingFolder(false)
  }

  const handleDeleteFolder = async (id: string) => {
    try {
      await tablesApi.deleteFolder(id)
      setFolders(prev => prev.filter(f => f.id !== id))
      // Move tables from deleted folder to root
      setTables(prev => prev.map(t => t.folder_id === id ? { ...t, folder_id: null } : t))
    } catch { /* ignore */ }
  }

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      const resp = await tablesApi.updateFolder(id, { name })
      if (resp.data.ok && resp.data.data) {
        setFolders(prev => prev.map(f => f.id === id ? resp.data.data! : f))
      }
    } catch { /* ignore */ }
  }

  const handleCreateTableInFolder = (folderId: string) => {
    setCreateFolderId(folderId)
    setShowCreate(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const rootTables = tables.filter(t => !t.folder_id)
  const isEmpty = tables.length === 0 && folders.length === 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Таблицы</h1>
          <p className="text-muted-foreground mt-1">Конструктор таблиц с гибкой схемой данных</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setShowCreateFolder(v => !v)}
          >
            {showCreateFolder ? <X className="h-4 w-4 mr-2" /> : <FolderPlus className="h-4 w-4 mr-2" />}
            {showCreateFolder ? 'Отмена' : 'Папка'}
          </Button>
          <Button
            onClick={() => { setCreateFolderId(null); setShowCreate(v => !v) }}
            className="gradient-primary border-0 text-white"
          >
            {showCreate ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {showCreate ? 'Отмена' : 'Новая таблица'}
          </Button>
        </div>
      </div>

      {/* Create folder form */}
      {showCreateFolder && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <FolderPlus className="h-4 w-4 text-amber-400 shrink-0" />
              <Input
                value={folderName}
                onChange={e => setFolderName(e.target.value)}
                placeholder="Название папки"
                className="bg-background"
                onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder() }}
                autoFocus
              />
              <Button onClick={handleCreateFolder} disabled={creatingFolder || !folderName.trim()} size="sm">
                {creatingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create table form */}
      {showCreate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 space-y-4">
            {createFolderId && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Folder className="h-4 w-4 text-amber-400" />
                <span>Папка: <strong className="text-foreground">{folders.find(f => f.id === createFolderId)?.name}</strong></span>
                <button onClick={() => setCreateFolderId(null)} className="hover:text-foreground ml-1">
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
                  placeholder="Например: Клиенты"
                  className="bg-background"
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
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
            <Button onClick={() => handleCreate()} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Создать таблицу
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Table2 className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">Нет таблиц</p>
          <p className="text-sm">Создайте первую таблицу или папку для начала работы</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Folders */}
          {folders.map(folder => (
            <FolderSection
              key={folder.id}
              folder={folder}
              tables={tables.filter(t => t.folder_id === folder.id)}
              allFolders={folders}
              onDeleteFolder={handleDeleteFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteTable={handleDelete}
              onMoveToFolder={handleMoveToFolder}
              onCreateTableInFolder={handleCreateTableInFolder}
            />
          ))}

          {/* Root tables (no folder) */}
          {rootTables.length > 0 && (
            <div className="space-y-3">
              {folders.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Без папки</span>
                  <Badge variant="outline" className="text-xs">{rootTables.length}</Badge>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rootTables.map(t => (
                  <TableCard
                    key={t.id}
                    table={t}
                    onDelete={handleDelete}
                    onMoveToFolder={handleMoveToFolder}
                    folders={folders}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
