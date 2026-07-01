import { type DragEvent as ReactDragEvent, type ReactNode, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { isAxiosError } from 'axios'
import EmojiPicker, { Theme } from 'emoji-picker-react'
import { knowledgeApi, type KBContentType, type KBPageInfo } from '@/lib/api'
import { linkifyHtmlContent } from '@/lib/linkify'
import { cn } from '@/lib/utils'
import { Plus, Trash2, ChevronRight, ChevronDown, FileText, FolderOpen, X, Save, Edit3, Search, Bold, Italic, Code, Heading1, Heading2, Heading3, List, ListOrdered, Link, Quote, Minus, Eye, EyeOff, PanelLeftClose, PanelLeftOpen, Smile } from 'lucide-react'

interface KBPage {
  id: string
  title: string
  content: string
  sanitized_content: string
  content_type: KBContentType
  icon: string | null
  parent_id: string | null
  slug: string
  position: number
  created_at: string
  updated_at?: string
}

function normalizePage(p: KBPageInfo): KBPage {
  return {
    id: p.id,
    title: p.title,
    content: p.content ?? '',
    sanitized_content: p.sanitized_content ?? '',
    content_type: p.content_type ?? 'text',
    icon: p.icon ?? null,
    parent_id: p.parent_id,
    slug: p.slug,
    position: p.position,
    created_at: p.created_at,
    updated_at: p.updated_at || p.created_at,
  }
}

function buildTree(pages: KBPage[], parentId: string | null = null): KBPage[] {
  return pages
    .filter(p => p.parent_id === parentId)
    .sort((a, b) => {
      const posDiff = a.position - b.position
      if (posDiff !== 0) return posDiff
      return a.title.localeCompare(b.title, 'ru')
    })
}

function collectDescendants(pages: KBPage[], rootId: string): Set<string> {
  const descendants = new Set<string>()
  const queue = [rootId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const page of pages) {
      if (page.parent_id === current && !descendants.has(page.id)) {
        descendants.add(page.id)
        queue.push(page.id)
      }
    }
  }
  return descendants
}

function resolveDraggedPageId(
  event: Pick<ReactDragEvent<HTMLElement>, 'dataTransfer'> | ReactDragEvent<HTMLElement>,
  draggedPageId: string | null,
): string | null {
  if (draggedPageId?.trim()) return draggedPageId
  const direct = event.dataTransfer?.getData('application/x-kb-page-id')?.trim()
  if (direct) return direct
  const fallback = event.dataTransfer?.getData('text/plain')?.trim()
  return fallback || null
}

function EmojiPickerField({
  value,
  onChange,
  title = 'Выбрать эмодзи',
  align = 'left',
}: {
  value: string
  onChange: (next: string) => void
  title?: string
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const pickerTheme =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? Theme.DARK : Theme.LIGHT

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-input bg-background text-xl transition-colors hover:bg-secondary"
        title={title}
        aria-label={title}
      >
        {value || <Smile className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className={`absolute top-12 z-[90] ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <EmojiPicker
            theme={pickerTheme}
            width={320}
            height={380}
            lazyLoadEmojis
            searchPlaceholder="Поиск эмодзи"
            onEmojiClick={(emojiData) => {
              onChange(emojiData.emoji)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

function TreeNode({ page, pages, selected, onSelect, onDelete, onMove, onQuickCreate, draggedPageId, dropTargetId, onDragStartPage, onDragEndPage, onDropTargetChange, resolveActiveDraggedPageId, depth = 0 }: {
  page: KBPage; pages: KBPage[]; selected: string | null
  onSelect: (p: KBPage) => void
  onDelete: (id: string) => void
  onMove: (pageId: string, parentId: string | null) => Promise<void>
  onQuickCreate: (parentId: string) => void
  draggedPageId: string | null
  dropTargetId: string | null
  onDragStartPage: (pageId: string) => void
  onDragEndPage: () => void
  onDropTargetChange: (pageId: string | null) => void
  resolveActiveDraggedPageId: (
    event: Pick<ReactDragEvent<HTMLElement>, 'dataTransfer'> | ReactDragEvent<HTMLElement>,
  ) => string | null
  depth?: number
}) {
  const [open, setOpen] = useState(true)
  const children = buildTree(pages, page.id)
  const isSelected = selected === page.id
  const isDragging = draggedPageId === page.id
  const isDropActive = dropTargetId === page.id
  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-kb-page-id', page.id)
          e.dataTransfer.setData('text/plain', page.id)
          onDragStartPage(page.id)
        }}
        onDragEnd={() => {
          onDropTargetChange(null)
          onDragEndPage()
        }}
        onDragEnter={(e) => {
          const activeDraggedPageId = resolveActiveDraggedPageId(e)
          if (!activeDraggedPageId || activeDraggedPageId === page.id) return
          e.preventDefault()
          onDropTargetChange(page.id)
        }}
        onDragOver={(e) => {
          const activeDraggedPageId = resolveActiveDraggedPageId(e)
          if (!activeDraggedPageId || activeDraggedPageId === page.id) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          onDropTargetChange(page.id)
        }}
        onDrop={async (e) => {
          e.preventDefault()
          e.stopPropagation()
          const activeDraggedPageId = resolveActiveDraggedPageId(e)
          if (!activeDraggedPageId || activeDraggedPageId === page.id) return
          await onMove(activeDraggedPageId, page.id)
          onDropTargetChange(null)
        }}
        onClick={() => onSelect(page)}
        className={`flex cursor-grab select-none items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors group ${isSelected ? 'border-primary/20 bg-primary/10 text-primary' : 'border-transparent hover:bg-secondary/50'} ${isDragging ? 'opacity-50' : ''} ${isDropActive ? 'border-primary/40 bg-primary/10' : ''}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(o => !o)
          }}
          className="h-4 w-4 flex items-center justify-center text-muted-foreground shrink-0"
          draggable={false}
        >
          {children.length > 0 ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm active:cursor-grabbing">
          {page.icon ? (
            <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none">{page.icon}</span>
          ) : page.content_type === 'html' ? (
            <Code className="h-3.5 w-3.5 shrink-0 opacity-60" />
          ) : children.length > 0 ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-60" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
          )}
          <span className="truncate">{page.title}</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onQuickCreate(page.id)
          }}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:bg-secondary hover:text-primary group-hover:opacity-100"
          title={`Создать дочернюю страницу в «${page.title}»`}
          draggable={false}
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(page.id)
          }}
          className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
          draggable={false}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {isDropActive && draggedPageId !== page.id && (
        <div
          className="ml-2 mr-2 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5 text-[11px] text-primary"
          style={{ marginLeft: `${24 + depth * 16}px` }}
        >
          Отпустите, чтобы вложить страницу в «{page.title}»
        </div>
      )}
      {open && children.map(child => (
        <TreeNode
          key={child.id}
          page={child}
          pages={pages}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onMove={onMove}
          onQuickCreate={onQuickCreate}
          draggedPageId={draggedPageId}
          dropTargetId={dropTargetId}
          onDragStartPage={onDragStartPage}
          onDragEndPage={onDragEndPage}
          onDropTargetChange={onDropTargetChange}
          resolveActiveDraggedPageId={resolveActiveDraggedPageId}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

export default function KnowledgePage() {
  const [pages, setPages] = useState<KBPage[]>([])
  const [selected, setSelected] = useState<KBPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ title: string; content: string; icon: string; content_type: KBContentType }>({
    title: '',
    content: '',
    icon: '',
    content_type: 'text',
  })
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState<{
    title: string
    content: string
    parent_id: string
    icon: string
    content_type: KBContentType
  }>({ title: '', content: '', parent_id: '', icon: '', content_type: 'text' })
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [errorText, setErrorText] = useState('')
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const draggedPageIdRef = useRef<string | null>(null)

  const getErrorMessage = (error: unknown, fallback: string): string => {
    if (isAxiosError(error)) {
      const code = error.response?.data?.error?.code
      const message = error.response?.data?.error?.message
      if (typeof message === 'string' && message.trim()) return message
      if (code === 'KNOWLEDGE_LIMIT_REACHED') {
        return 'Достигнут лимит тарифа по базе знаний. Удалите лишние записи или повысьте тариф.'
      }
    }
    return fallback
  }

  const load = useCallback(async () => {
    try {
      const r = await knowledgeApi.list()
      if (r.data.ok && r.data.data) {
        setPages(r.data.data.map(normalizePage))
      } else {
        setErrorText(r.data.error?.message || 'Не удалось загрузить страницы базы знаний')
      }
    } catch (e) {
      setErrorText(getErrorMessage(e, 'Не удалось загрузить страницы базы знаний'))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openCreateModal = useCallback((parentId?: string | null) => {
    setNewForm({
      title: '',
      content: '',
      parent_id: parentId || '',
      icon: '',
      content_type: 'text',
    })
    setShowNew(true)
  }, [])

  const startDraggingPage = useCallback((pageId: string) => {
    draggedPageIdRef.current = pageId
    setDraggedPageId(pageId)
  }, [])

  const endDraggingPage = useCallback(() => {
    draggedPageIdRef.current = null
    setDraggedPageId(null)
    setDropTargetId(null)
  }, [])

  const resolveActiveDraggedPageId = useCallback(
    (event: Pick<ReactDragEvent<HTMLElement>, 'dataTransfer'> | ReactDragEvent<HTMLElement>) =>
      resolveDraggedPageId(event, draggedPageIdRef.current),
    [],
  )

  const handleSelect = (p: KBPage) => {
    setSelected(p); setDraft({ title: p.title, content: p.content, icon: p.icon || '', content_type: p.content_type }); setEditing(false)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setSidebarOpen(false)
    }
  }

  const handleSave = async () => {
    if (!selected) return
    setErrorText('')
    setSaving(true)
    try {
      const r = await knowledgeApi.update(selected.id, {
        title: draft.title,
        content: draft.content,
        content_type: draft.content_type,
        icon: draft.icon.trim() || undefined,
        expected_updated_at: selected.updated_at || new Date().toISOString(),
      })
      if (r.data.ok && r.data.data) {
        const updated = normalizePage(r.data.data)
        setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
        setSelected(updated)
        setEditing(false)
      } else {
        setErrorText(r.data.error?.message || 'Не удалось сохранить страницу')
      }
    } catch (e) {
      await load()
      setErrorText(getErrorMessage(e, 'Не удалось сохранить страницу'))
    }
    setSaving(false)
  }

  const handleCreate = async () => {
    if (!newForm.title.trim()) return
    setErrorText('')
    setSaving(true)
    try {
      const r = await knowledgeApi.create({
        title: newForm.title,
        content: newForm.content,
        content_type: newForm.content_type,
        parent_id: newForm.parent_id || undefined,
        icon: newForm.icon.trim() || undefined,
      })
      if (r.data.ok && r.data.data) {
        const created = normalizePage(r.data.data)
        setPages(prev => [...prev, created])
        setSelected(created)
        setDraft({ title: created.title, content: created.content, icon: created.icon || '', content_type: created.content_type })
        setShowNew(false)
        setNewForm({ title: '', content: '', parent_id: '', icon: '', content_type: 'text' })
      } else {
        setErrorText(r.data.error?.message || 'Не удалось создать страницу')
      }
    } catch (e) {
      setErrorText(getErrorMessage(e, 'Не удалось создать страницу'))
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    setErrorText('')
    try {
      await knowledgeApi.delete(id)
      setPages(prev => prev.filter(p => p.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch (e) {
      setErrorText(getErrorMessage(e, 'Не удалось удалить страницу'))
    }
  }

  const handleMove = async (pageId: string, parentId: string | null) => {
    const page = pages.find(p => p.id === pageId)
    if (!page) {
      endDraggingPage()
      return
    }
    if (page.parent_id === parentId) {
      endDraggingPage()
      return
    }
    const descendants = collectDescendants(pages, pageId)
    if (parentId === pageId || (parentId && descendants.has(parentId))) {
      setErrorText('Нельзя переместить страницу внутрь своей дочерней ветки.')
      endDraggingPage()
      return
    }
    setErrorText('')
    try {
      const response = await knowledgeApi.update(pageId, {
        parent_id: parentId,
        expected_updated_at: page.updated_at || new Date().toISOString(),
      })
      if (response.data.ok && response.data.data) {
        const updated = normalizePage(response.data.data)
        setPages(prev => prev.map(p => (p.id === pageId ? updated : p)))
        if (selected?.id === pageId) {
          setSelected(updated)
        }
      } else {
        setErrorText(response.data.error?.message || 'Не удалось переместить страницу')
      }
    } catch (e) {
      await load()
      setErrorText(getErrorMessage(e, 'Не удалось переместить страницу'))
    } finally {
      endDraggingPage()
    }
  }

  const filtered = search ? pages.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || (p.content || '').toLowerCase().includes(search.toLowerCase()) || (p.sanitized_content || '').toLowerCase().includes(search.toLowerCase())) : pages
  const roots = buildTree(filtered)

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100dvh-8rem)] md:h-[calc(100vh-8rem)] gap-0 rounded-xl border border-border overflow-hidden bg-card">
      {/* Sidebar */}
      <div className={cn(
        'border-b md:border-b-0 md:border-r border-border md:shrink-0 flex flex-col transition-all duration-300 overflow-hidden',
        sidebarOpen ? 'w-full md:w-64' : 'hidden md:flex md:w-0 md:border-r-0'
      )}>
        <div className="p-3 border-b border-border space-y-2 min-w-0 md:min-w-[256px]">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm flex-1">База знаний</h2>
            <button onClick={() => setSidebarOpen(false)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Скрыть панель">
              <PanelLeftClose className="h-4 w-4" />
            </button>
            <button onClick={() => openCreateModal(null)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Новая страница">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-background outline-none focus:border-primary" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 min-w-0 md:min-w-[256px]">
          {draggedPageId && (
            <div
              onDragEnter={(e) => {
                const activeDraggedPageId = resolveActiveDraggedPageId(e)
                if (!activeDraggedPageId) return
                e.preventDefault()
                setDropTargetId('__root__')
              }}
              onDragOver={(e) => {
                const activeDraggedPageId = resolveActiveDraggedPageId(e)
                if (!activeDraggedPageId) return
                e.preventDefault()
                setDropTargetId('__root__')
              }}
              onDrop={async (e) => {
                e.preventDefault()
                const activeDraggedPageId = resolveActiveDraggedPageId(e)
                if (!activeDraggedPageId) return
                await handleMove(activeDraggedPageId, null)
              }}
              className={`mb-2 rounded-lg border border-dashed px-3 py-2 text-xs transition-colors ${
                dropTargetId === '__root__'
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              Перетащите сюда, чтобы вынести страницу в корень
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
          ) : roots.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Нет страниц</p>
              <button onClick={() => openCreateModal(null)} className="mt-2 text-primary hover:underline">Создать первую</button>
            </div>
          ) : (
            roots.map(p => (
              <TreeNode
                key={p.id}
                page={p}
                pages={filtered}
                selected={selected?.id || null}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onMove={handleMove}
                onQuickCreate={(parentId) => openCreateModal(parentId)}
                draggedPageId={draggedPageId}
                dropTargetId={dropTargetId}
                onDragStartPage={startDraggingPage}
                onDragEndPage={endDraggingPage}
                onDropTargetChange={setDropTargetId}
                resolveActiveDraggedPageId={resolveActiveDraggedPageId}
              />
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className={cn('flex-1 flex-col min-w-0 relative', sidebarOpen ? 'hidden md:flex' : 'flex')}>
        {selected ? (
          <KBEditor
            selected={selected}
            editing={editing}
            setEditing={setEditing}
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            onSave={handleSave}
            errorText={errorText}
            sidebarToggle={!sidebarOpen ? (
              <button
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 rounded-md border border-border bg-background flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                title="Показать панель"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : null}
          />
        ) : (
          <div className="flex-1 flex flex-col">
            {!sidebarOpen && (
              <div className="flex items-center gap-2 px-3 sm:px-5 py-3 border-b border-border">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="h-8 w-8 rounded-md border border-border bg-background flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  title="Показать панель"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText className="h-16 w-16 opacity-20" />
            <p className="text-lg font-medium">Выберите страницу</p>
            <p className="text-sm">или создайте новую нажав <span className="text-primary">+</span></p>
            </div>
          </div>
        )}
      </div>

      {/* New page modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="relative z-10 w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Новая страница</h2>
              <button onClick={() => setShowNew(false)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex items-center gap-2">
              <EmojiPickerField
                value={newForm.icon}
                onChange={(next) => setNewForm((f) => ({ ...f, icon: next }))}
                title="Выбрать эмодзи для страницы"
              />
              <input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} placeholder="Заголовок страницы" className="h-10 flex-1 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Иконка не обязательна.</span>
              {newForm.icon && (
                <button
                  type="button"
                  onClick={() => setNewForm((f) => ({ ...f, icon: '' }))}
                  className="inline-flex items-center rounded-md border border-border px-2 py-1 hover:bg-secondary"
                >
                  Убрать иконку
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-background p-1">
              {([
                ['text', 'Markdown'],
                ['html', 'HTML'],
              ] as const).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setNewForm((f) => ({ ...f, content_type: type }))}
                  className={cn(
                    'h-8 rounded-md text-sm transition-colors',
                    newForm.content_type === type ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Родительская страница (необязательно)</label>
              <select value={newForm.parent_id} onChange={e => setNewForm(f => ({ ...f, parent_id: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                <option value="">— Корневая страница —</option>
                {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <textarea
              value={newForm.content}
              onChange={e => setNewForm(f => ({ ...f, content: e.target.value }))}
              placeholder={newForm.content_type === 'html' ? '<section><h1>Заголовок</h1><p>HTML будет очищен перед показом.</p></section>' : 'Содержимое (необязательно)'}
              rows={newForm.content_type === 'html' ? 6 : 3}
              className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary resize-none font-mono"
            />
            {newForm.content_type === 'html' && (
              <p className="text-xs text-muted-foreground">
                Скрипты, обработчики событий, iframe и опасные ссылки будут удалены при сохранении.
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setShowNew(false)} className="flex-1 h-10 rounded-lg border border-border text-sm hover:bg-secondary transition-colors">Отмена</button>
              <button onClick={handleCreate} disabled={saving || !newForm.title.trim()} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">{saving ? 'Создание...' : 'Создать'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Simple Markdown → HTML renderer ─── */
function renderMarkdown(md: string): string {
  const html = md
    // code blocks ```lang\n...\n```
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-secondary/50 rounded-lg p-3 overflow-x-auto text-sm font-mono my-3"><code>$2</code></pre>')
    // inline code
    .replace(/`([^`]+)`/g, '<code class="bg-secondary/50 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
    // headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-5 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-3">$1</h1>')
    // blockquote
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-primary/30 pl-4 py-1 my-2 text-muted-foreground italic">$1</blockquote>')
    // hr
    .replace(/^---$/gm, '<hr class="border-border my-4" />')
    // bold & italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="text-primary underline hover:text-primary/80">$1</a>')
    // images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="rounded-lg max-w-full my-2" />')
    // unordered list
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // ordered list
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="my-2">')
    // single newline → br
    .replace(/\n/g, '<br />')
  const baseHtml = '<p class="my-2">' + html + '</p>'
  return linkifyHtmlContent(baseHtml)
}

function buildHtmlPageSrcDoc(sanitizedHtml: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base target="_blank" />
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      padding: 24px;
      color: #111827;
      background: #ffffff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    img, video, table { max-width: 100%; }
    img { height: auto; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 8px; }
    pre { overflow-x: auto; white-space: pre-wrap; }
    a { color: #2563eb; }
    @media (prefers-color-scheme: dark) {
      body { color: #e5e7eb; background: #0b0f14; }
      th, td { border-color: #374151; }
      a { color: #60a5fa; }
    }
  </style>
</head>
<body>${sanitizedHtml}</body>
</html>`
}

function SafeHtmlFrame({ html }: { html: string }) {
  return (
    <iframe
      title="HTML-страница базы знаний"
      className="h-full min-h-[520px] w-full rounded-lg border border-border bg-background"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={buildHtmlPageSrcDoc(html)}
    />
  )
}

/* ─── KBEditor component ─── */
function KBEditor({ selected, editing, setEditing, draft, setDraft, saving, onSave, errorText, sidebarToggle }: {
  selected: KBPage
  editing: boolean
  setEditing: (v: boolean) => void
  draft: { title: string; content: string; icon: string; content_type: KBContentType }
  setDraft: (fn: (d: { title: string; content: string; icon: string; content_type: KBContentType }) => { title: string; content: string; icon: string; content_type: KBContentType }) => void
  saving: boolean
  onSave: () => Promise<void>
  errorText: string
  sidebarToggle?: ReactNode
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const activeContentType = editing ? draft.content_type : selected.content_type
  const isHtmlPage = activeContentType === 'html'

  const renderedHtml = useMemo(() => {
    const src = editing ? draft.content : selected.content
    return renderMarkdown(src || '')
  }, [editing, draft.content, selected.content])

  const insertAtCursor = (before: string, after: string = '') => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const text = draft.content
    const selectedText = text.substring(start, end)
    const newText = text.substring(0, start) + before + selectedText + after + text.substring(end)
    setDraft(d => ({ ...d, content: newText }))
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + before.length
      ta.selectionEnd = start + before.length + selectedText.length
    }, 0)
  }

  const toolbarButtons = [
    { icon: Bold, title: 'Жирный', action: () => insertAtCursor('**', '**') },
    { icon: Italic, title: 'Курсив', action: () => insertAtCursor('*', '*') },
    { icon: Code, title: 'Код', action: () => insertAtCursor('`', '`') },
    { sep: true },
    { icon: Heading1, title: 'Заголовок 1', action: () => insertAtCursor('# ') },
    { icon: Heading2, title: 'Заголовок 2', action: () => insertAtCursor('## ') },
    { icon: Heading3, title: 'Заголовок 3', action: () => insertAtCursor('### ') },
    { sep: true },
    { icon: List, title: 'Список', action: () => insertAtCursor('- ') },
    { icon: ListOrdered, title: 'Нумерованный список', action: () => insertAtCursor('1. ') },
    { icon: Quote, title: 'Цитата', action: () => insertAtCursor('> ') },
    { sep: true },
    { icon: Link, title: 'Ссылка', action: () => insertAtCursor('[', '](url)') },
    { icon: Minus, title: 'Разделитель', action: () => insertAtCursor('\n---\n') },
  ] as const

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-b border-border">
        {sidebarToggle}
        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <EmojiPickerField
              value={draft.icon}
              onChange={(next) => setDraft((d) => ({ ...d, icon: next }))}
              title="Выбрать эмодзи страницы"
            />
            <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} className="flex-1 text-lg font-bold bg-transparent outline-none border-b border-primary/50 pb-0.5" />
          </div>
        ) : (
          <h1 className="flex flex-1 items-center gap-2 truncate text-lg font-bold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-background/70 text-base">
              {selected.icon || '📄'}
            </span>
            <span className="truncate">{selected.title}</span>
            {selected.content_type === 'html' && (
              <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                HTML
              </span>
            )}
          </h1>
        )}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {editing && (
            <button onClick={() => setPreview(!preview)} className={`h-8 w-8 rounded-md flex items-center justify-center transition-colors ${preview ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary'}`} title={preview ? 'Редактор' : 'Предпросмотр'}>
              {preview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
          {editing ? (
            <>
              <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <Save className="h-3.5 w-3.5" />{saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => { setEditing(false); setPreview(false); setDraft(() => ({ title: selected.title, content: selected.content, icon: selected.icon || '', content_type: selected.content_type })) }} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"><X className="h-4 w-4" /></button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-sm hover:bg-secondary transition-colors">
              <Edit3 className="h-3.5 w-3.5" /> Редактировать
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 sm:px-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Smile className="h-3.5 w-3.5" /> Иконка не обязательна.</span>
          <button
            type="button"
            onClick={() => setDraft(d => ({ ...d, icon: '' }))}
            className="ml-1 inline-flex h-7 items-center rounded-md border border-border px-2 hover:bg-secondary"
          >
            Без иконки
          </button>
          <div className="ml-0 flex rounded-md border border-border bg-background p-0.5 sm:ml-2">
            {([
              ['text', 'Markdown'],
              ['html', 'HTML'],
            ] as const).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => setDraft(d => ({ ...d, content_type: type }))}
                className={cn(
                  'h-6 rounded px-2 text-xs transition-colors',
                  draft.content_type === type ? 'bg-primary text-white' : 'hover:bg-secondary',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      {editing && !preview && !isHtmlPage && (
        <div className="flex items-center gap-0.5 px-3 sm:px-5 py-1.5 border-b border-border bg-secondary/20 flex-wrap">
          {toolbarButtons.map((btn, i) =>
            'sep' in btn ? <div key={i} className="w-px h-5 bg-border mx-1" /> :
            <button key={i} onClick={btn.action} title={btn.title} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
              <btn.icon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {editing && !preview ? (
          <textarea ref={textareaRef} value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            className="w-full h-full min-h-[400px] text-sm bg-transparent outline-none resize-none font-mono leading-relaxed"
            placeholder={isHtmlPage ? '<section><h1>Заголовок</h1><p>HTML будет очищен на сервере.</p></section>' : 'Содержимое страницы (поддерживается Markdown)...'} />
        ) : isHtmlPage ? (
          <div className="flex h-full min-h-[520px] flex-col gap-3">
            {editing && (
              <div className="rounded-lg border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
                Показана последняя сохраненная безопасная версия. Сохраните страницу, чтобы обновить HTML-предпросмотр.
              </div>
            )}
            {selected.sanitized_content ? (
              <SafeHtmlFrame html={selected.sanitized_content} />
            ) : (
              <p className="text-muted-foreground italic">HTML-страница пуста или еще не сохранена.</p>
            )}
          </div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none prose-p:break-words prose-li:break-words prose-pre:whitespace-pre-wrap prose-pre:break-words">
            {(editing ? draft.content : selected.content) ? (
              <div className="text-sm leading-relaxed text-foreground break-words [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            ) : (
              <p className="text-muted-foreground italic">Страница пуста. Нажмите «Редактировать» для добавления содержимого.</p>
            )}
          </div>
        )}
      </div>
      {errorText && (
        <div className="mx-3 sm:mx-5 mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorText}
        </div>
      )}
      <div className="px-3 sm:px-5 py-2 border-t border-border text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-1.5">
        <span>Изменено: {new Date(selected.updated_at || selected.created_at).toLocaleString('ru')}</span>
        {editing && <span className="text-primary/60">{isHtmlPage ? 'HTML будет очищен при сохранении' : 'Markdown поддерживается'}</span>}
      </div>
    </>
  )
}
