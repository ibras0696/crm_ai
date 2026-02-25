import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Search } from 'lucide-react'

type PageNode = {
  id: string
  title: string
  parent_id?: string | null
}

type Props = {
  pages: PageNode[]
  selectedIds: string[]
  onSelectedIdsChange: (next: string[]) => void
  disabled?: boolean
  emptyText?: string
  heightClassName?: string
}

function buildChildrenMap(pages: PageNode[]) {
  const map: Record<string, PageNode[]> = {}
  for (const p of pages) {
    const key = p.parent_id ?? 'root'
    map[key] = map[key] ?? []
    map[key].push(p)
  }
  for (const key of Object.keys(map)) {
    map[key]?.sort((a, b) => a.title.localeCompare(b.title, 'ru'))
  }
  return map
}

export default function KbPageTreeSelect({
  pages,
  selectedIds,
  onSelectedIdsChange,
  disabled = false,
  emptyText = 'Нет страниц',
  heightClassName = 'max-h-64',
}: Props) {
  const [query, setQuery] = useState('')
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({})
  const childrenMap = useMemo(() => buildChildrenMap(pages), [pages])

  const q = query.trim().toLowerCase()
  const visiblePageIds = useMemo(() => {
    if (!q) return new Set(pages.map(p => p.id))
    return new Set(pages.filter(p => p.title.toLowerCase().includes(q)).map(p => p.id))
  }, [pages, q])

  const visibleNodes = useMemo(() => {
    const visible = new Set<string>()

    const dfs = (id: string): boolean => {
      const self = pages.find(p => p.id === id)
      if (!self) return false
      const selfMatch = !q || self.title.toLowerCase().includes(q)
      const childMatch = (childrenMap[id] ?? []).some(ch => dfs(ch.id))
      const ok = selfMatch || childMatch || visiblePageIds.has(id)
      if (ok) visible.add(id)
      return ok
    }

    for (const root of childrenMap.root ?? []) dfs(root.id)
    return visible
  }, [pages, childrenMap, q, visiblePageIds])

  const togglePage = (id: string) => {
    const set = new Set(selectedIds)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    onSelectedIdsChange(Array.from(set))
  }

  const renderNode = (node: PageNode, depth = 0): JSX.Element | null => {
    if (!visibleNodes.has(node.id)) return null
    const children = (childrenMap[node.id] ?? []).filter(ch => visibleNodes.has(ch.id))
    const hasChildren = children.length > 0
    const forcedOpen = q.length > 0
    const isOpen = forcedOpen || openNodes[node.id] !== false

    return (
      <div key={node.id} className="space-y-1">
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/30"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <button
            type="button"
            onClick={() => setOpenNodes(prev => ({ ...prev, [node.id]: !isOpen }))}
            className="h-4 w-4 flex items-center justify-center text-muted-foreground"
            disabled={!hasChildren || forcedOpen}
          >
            {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
          </button>
          <input
            type="checkbox"
            checked={selectedIds.includes(node.id)}
            onChange={() => togglePage(node.id)}
            disabled={disabled}
            className="h-4 w-4"
          />
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm truncate">{node.title}</span>
        </div>

        {isOpen && children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  const rootNodes = (childrenMap.root ?? []).filter(n => visibleNodes.has(n.id))

  if (pages.length === 0) {
    return <div className="rounded-lg border border-border bg-background/40 p-3 text-sm text-muted-foreground">{emptyText}</div>
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card/70 p-2 space-y-2">
        <div className="h-9 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск страниц"
            className="min-w-0 flex-1 bg-transparent outline-none text-sm"
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onSelectedIdsChange(pages.map(p => p.id))}
            className="text-xs h-7 px-2 rounded-md border border-border hover:bg-secondary whitespace-nowrap"
            disabled={disabled}
          >
            Все
          </button>
          <button
            type="button"
            onClick={() => onSelectedIdsChange([])}
            className="text-xs h-7 px-2 rounded-md border border-border hover:bg-secondary whitespace-nowrap"
            disabled={disabled}
          >
            Снять
          </button>
        </div>
      </div>

      <div className={`${heightClassName} overflow-auto rounded-lg border border-border bg-background/30 p-2 space-y-1`}>
        {rootNodes.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-1">{emptyText}</p>
        ) : (
          rootNodes.map(node => renderNode(node))
        )}
      </div>
    </div>
  )
}
