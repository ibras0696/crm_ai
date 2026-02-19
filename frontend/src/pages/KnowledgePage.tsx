import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { knowledgeApi } from '@/lib/api'
import { Plus, Trash2, ChevronRight, ChevronDown, FileText, FolderOpen, X, Save, Edit3, Search, Bold, Italic, Code, Heading1, Heading2, Heading3, List, ListOrdered, Link, Quote, Minus, Eye, EyeOff } from 'lucide-react'

interface KBPage {
  id: string
  title: string
  content: string
  parent_id: string | null
  slug: string
  created_at: string
  updated_at: string
}

function buildTree(pages: KBPage[], parentId: string | null = null): KBPage[] {
  return pages.filter(p => p.parent_id === parentId)
}

function TreeNode({ page, pages, selected, onSelect, onDelete, depth = 0 }: {
  page: KBPage; pages: KBPage[]; selected: string | null
  onSelect: (p: KBPage) => void; onDelete: (id: string) => void; depth?: number
}) {
  const [open, setOpen] = useState(true)
  const children = buildTree(pages, page.id)
  const isSelected = selected === page.id
  return (
    <div>
      <div className={`flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer group transition-colors ${isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-secondary/50'}`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}>
        <button onClick={() => setOpen(o => !o)} className="h-4 w-4 flex items-center justify-center text-muted-foreground shrink-0">
          {children.length > 0 ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
        </button>
        <span onClick={() => onSelect(page)} className="flex-1 flex items-center gap-1.5 text-sm min-w-0">
          {children.length > 0 ? <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-60" /> : <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />}
          <span className="truncate">{page.title}</span>
        </span>
        <button onClick={() => onDelete(page.id)} className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {open && children.map(child => <TreeNode key={child.id} page={child} pages={pages} selected={selected} onSelect={onSelect} onDelete={onDelete} depth={depth + 1} />)}
    </div>
  )
}

export default function KnowledgePage() {
  const [pages, setPages] = useState<KBPage[]>([])
  const [selected, setSelected] = useState<KBPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ title: '', content: '', parent_id: '' })
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await knowledgeApi.list()
      if (r.data.ok && r.data.data) setPages(r.data.data as KBPage[])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelect = (p: KBPage) => {
    setSelected(p); setDraft({ title: p.title, content: p.content }); setEditing(false)
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const r = await knowledgeApi.update(selected.id, draft)
      if (r.data.ok && r.data.data) {
        const updated = r.data.data as KBPage
        setPages(prev => prev.map(p => p.id === updated.id ? updated : p))
        setSelected(updated)
        setEditing(false)
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleCreate = async () => {
    if (!newForm.title.trim()) return
    setSaving(true)
    try {
      const r = await knowledgeApi.create({ ...newForm, parent_id: newForm.parent_id || null })
      if (r.data.ok && r.data.data) {
        const created = r.data.data as KBPage
        setPages(prev => [...prev, created])
        setSelected(created)
        setDraft({ title: created.title, content: created.content })
        setShowNew(false)
        setNewForm({ title: '', content: '', parent_id: '' })
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    try {
      await knowledgeApi.delete(id)
      setPages(prev => prev.filter(p => p.id !== id))
      if (selected?.id === id) setSelected(null)
    } catch { /* ignore */ }
  }

  const filtered = search ? pages.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || p.content.toLowerCase().includes(search.toLowerCase())) : pages
  const roots = buildTree(filtered)

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl border border-border overflow-hidden bg-card">
      {/* Sidebar */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm flex-1">База знаний</h2>
            <button onClick={() => setShowNew(true)} className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors" title="Новая страница">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." className="w-full h-7 pl-7 pr-2 text-xs rounded-md border border-input bg-background outline-none focus:border-primary" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
          ) : roots.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>Нет страниц</p>
              <button onClick={() => setShowNew(true)} className="mt-2 text-primary hover:underline">Создать первую</button>
            </div>
          ) : (
            roots.map(p => <TreeNode key={p.id} page={p} pages={filtered} selected={selected?.id || null} onSelect={handleSelect} onDelete={handleDelete} />)
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selected ? (
          <KBEditor
            selected={selected}
            editing={editing}
            setEditing={setEditing}
            draft={draft}
            setDraft={setDraft}
            saving={saving}
            onSave={handleSave}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <FileText className="h-16 w-16 opacity-20" />
            <p className="text-lg font-medium">Выберите страницу</p>
            <p className="text-sm">или создайте новую нажав <span className="text-primary">+</span></p>
          </div>
        )}
      </div>

      {/* New page modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Новая страница</h2>
              <button onClick={() => setShowNew(false)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} placeholder="Заголовок страницы" className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary" />
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Родительская страница (необязательно)</label>
              <select value={newForm.parent_id} onChange={e => setNewForm(f => ({ ...f, parent_id: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                <option value="">— Корневая страница —</option>
                {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
            <textarea value={newForm.content} onChange={e => setNewForm(f => ({ ...f, content: e.target.value }))} placeholder="Содержимое (необязательно)" rows={3} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary resize-none" />
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
  let html = md
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
  return '<p class="my-2">' + html + '</p>'
}

/* ─── KBEditor component ─── */
function KBEditor({ selected, editing, setEditing, draft, setDraft, saving, onSave }: {
  selected: KBPage
  editing: boolean
  setEditing: (v: boolean) => void
  draft: { title: string; content: string }
  setDraft: (fn: (d: { title: string; content: string }) => { title: string; content: string }) => void
  saving: boolean
  onSave: () => Promise<void>
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

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
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border">
        {editing ? (
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} className="flex-1 text-lg font-bold bg-transparent outline-none border-b border-primary/50 pb-0.5" />
        ) : (
          <h1 className="flex-1 text-lg font-bold truncate">{selected.title}</h1>
        )}
        <div className="flex items-center gap-1.5">
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
              <button onClick={() => { setEditing(false); setPreview(false); setDraft(() => ({ title: selected.title, content: selected.content })) }} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"><X className="h-4 w-4" /></button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-sm hover:bg-secondary transition-colors">
              <Edit3 className="h-3.5 w-3.5" /> Редактировать
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {editing && !preview && (
        <div className="flex items-center gap-0.5 px-5 py-1.5 border-b border-border bg-secondary/20 flex-wrap">
          {toolbarButtons.map((btn, i) =>
            'sep' in btn ? <div key={i} className="w-px h-5 bg-border mx-1" /> :
            <button key={i} onClick={btn.action} title={btn.title} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
              <btn.icon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {editing && !preview ? (
          <textarea ref={textareaRef} value={draft.content} onChange={e => setDraft(d => ({ ...d, content: e.target.value }))}
            className="w-full h-full min-h-[400px] text-sm bg-transparent outline-none resize-none font-mono leading-relaxed"
            placeholder="Содержимое страницы (поддерживается Markdown)..." />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {(editing ? draft.content : selected.content) ? (
              <div className="text-sm leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            ) : (
              <p className="text-muted-foreground italic">Страница пуста. Нажмите «Редактировать» для добавления содержимого.</p>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-2 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
        <span>Изменено: {new Date(selected.updated_at).toLocaleString('ru')}</span>
        {editing && <span className="text-primary/60">Markdown поддерживается</span>}
      </div>
    </>
  )
}
