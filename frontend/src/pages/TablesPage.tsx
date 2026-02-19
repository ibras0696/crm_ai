import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { tablesApi, TableInfo } from '@/lib/api'
import {
  Plus, FileText, Loader2, Trash2, Pencil, Table2, Columns3, X, MoreHorizontal,
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

export default function TablesPage() {
  const navigate = useNavigate()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createColor, setCreateColor] = useState('blue')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    try {
      const resp = await tablesApi.list()
      if (resp.data.ok && resp.data.data) setTables(resp.data.data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const resp = await tablesApi.create({ name: createName, description: createDesc || undefined, color: createColor })
      if (resp.data.ok && resp.data.data) {
        setTables(prev => [resp.data.data!, ...prev])
        setShowCreate(false)
        setCreateName('')
        setCreateDesc('')
        navigate(`/tables/${resp.data.data.id}`)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Таблицы</h1>
          <p className="text-muted-foreground mt-1">Конструктор таблиц с гибкой схемой данных</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} className="gradient-primary border-0 text-white">
          {showCreate ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
          {showCreate ? 'Отмена' : 'Новая таблица'}
        </Button>
      </div>

      {showCreate && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Название</Label>
                <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Например: Клиенты" className="bg-background" />
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
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Создать таблицу
            </Button>
          </CardContent>
        </Card>
      )}

      {tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Table2 className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">Нет таблиц</p>
          <p className="text-sm">Создайте первую таблицу для начала работы</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map(t => {
            const cls = colorMap[t.color || 'blue'] || colorMap.blue
            return (
              <Card
                key={t.id}
                className="border-border/50 hover:border-border transition-colors cursor-pointer group"
                onClick={() => navigate(`/tables/${t.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className={`rounded-lg p-2.5 ${cls.split(' ')[0]}`}>
                      <FileText className={`h-5 w-5 ${cls.split(' ')[1]}`} />
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(t.id) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <h3 className="font-semibold mt-3">{t.name}</h3>
                  {t.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <Badge variant="secondary" className="text-xs">
                      <Columns3 className="h-3 w-3 mr-1" />
                      {t.columns.length} полей
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
