import { useState, useEffect, useCallback } from 'react'
import { scheduleApi } from '@/lib/api'
import { Plus, ChevronLeft, ChevronRight, Check, Trash2, X, Repeat, Clock, Edit3 } from 'lucide-react'

interface Event {
  id: string
  title: string
  description?: string
  start_at: string
  end_at?: string
  all_day: boolean
  color: string
  is_done: boolean
  recurrence?: string
}

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316']
const RECURRENCE = [
  { value: '', label: 'Без повтора' },
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekly', label: 'Каждую неделю' },
  { value: 'monthly', label: 'Каждый месяц' },
  { value: 'yearly', label: 'Каждый год' },
]
const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const DAYS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
const VIEWS = ['day','month','year'] as const
type View = typeof VIEWS[number]

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function SchedulePage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('month')
  const [current, setCurrent] = useState(new Date())
  const [showForm, setShowForm] = useState(false)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [form, setForm] = useState({ title: '', description: '', start_at: '', end_at: '', all_day: true, color: COLORS[0], recurrence: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [editError, setEditError] = useState('')
  const [editEvent, setEditEvent] = useState<Event | null>(null)
  const [editForm, setEditForm] = useState({ title: '', description: '', start_at: '', end_at: '', all_day: true, color: COLORS[0], recurrence: '' })

  const load = useCallback(async () => {
    try {
      const r = await scheduleApi.list()
      if (r.data.ok && r.data.data) setEvents(r.data.data as Event[])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const todayIso = () => new Date().toISOString().slice(0, 10)

  const openForm = (day?: Date) => {
    const d = day || new Date()
    const iso = d.toISOString().slice(0, 10)
    setForm(f => ({ ...f, start_at: iso + 'T09:00', end_at: iso + 'T10:00' }))
    setSelectedDay(d)
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    const eventDate = new Date(form.start_at)
    const now = new Date()
    now.setSeconds(0, 0)
    if (eventDate < now) {
      setFormError('Нельзя создать событие задним числом. Выберите дату и время не раньше текущего момента.')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      const r = await scheduleApi.create({ ...form, all_day: form.all_day, recurrence: form.recurrence || undefined })
      if (r.data.ok && r.data.data) {
        setEvents(prev => [...prev, r.data.data as Event])
        setShowForm(false)
        setForm({ title: '', description: '', start_at: '', end_at: '', all_day: true, color: COLORS[0], recurrence: '' })
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const openEdit = (ev: Event) => {
    setEditError('')
    setEditEvent(ev)
    setEditForm({
      title: ev.title,
      description: ev.description || '',
      start_at: ev.start_at.slice(0, 16),
      end_at: ev.end_at ? ev.end_at.slice(0, 16) : '',
      all_day: ev.all_day,
      color: ev.color || COLORS[0],
      recurrence: ev.recurrence || '',
    })
  }

  const handleUpdate = async () => {
    if (!editEvent || !editForm.title.trim()) return
    const eventDate = new Date(editForm.start_at)
    const now = new Date()
    now.setSeconds(0, 0)
    if (eventDate < now) {
      setEditError('Нельзя перенести событие в прошлое. Выберите дату и время не раньше текущего момента.')
      return
    }
    setEditError('')
    setSaving(true)
    try {
      const r = await scheduleApi.update(editEvent.id, {
        title: editForm.title,
        description: editForm.description || undefined,
        start_at: editForm.start_at,
        end_at: editForm.end_at || undefined,
        all_day: editForm.all_day,
        color: editForm.color,
        recurrence: editForm.recurrence || undefined,
      })
      if (r.data.ok && r.data.data) {
        setEvents(prev => prev.map(e => e.id === editEvent.id ? r.data.data as Event : e))
        setEditEvent(null)
      }
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleToggle = async (ev: Event) => {
    try {
      const r = await scheduleApi.update(ev.id, { is_done: !ev.is_done })
      if (r.data.ok && r.data.data) setEvents(prev => prev.map(e => e.id === ev.id ? r.data.data as Event : e))
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await scheduleApi.delete(id)
      setEvents(prev => prev.filter(e => e.id !== id))
    } catch { /* ignore */ }
  }

  const eventsOnDay = (d: Date) => events.filter(e => {
    try { return isSameDay(new Date(e.start_at), d) } catch { return false }
  })

  // --- Navigation ---
  const nav = (dir: number) => {
    const d = new Date(current)
    if (view === 'day') d.setDate(d.getDate() + dir)
    else if (view === 'month') d.setMonth(d.getMonth() + dir)
    else d.setFullYear(d.getFullYear() + dir)
    setCurrent(d)
  }

  const title = view === 'day'
    ? current.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'month'
    ? `${MONTHS_RU[current.getMonth()]} ${current.getFullYear()}`
    : `${current.getFullYear()}`

  // --- Month grid ---
  const buildMonthGrid = () => {
    const year = current.getFullYear(), month = current.getMonth()
    const first = new Date(year, month, 1)
    const startDow = (first.getDay() + 6) % 7 // Mon=0
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startDow; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }

  // --- Year grid ---
  const buildYearGrid = () => {
    return Array.from({ length: 12 }, (_, m) => {
      const d = new Date(current.getFullYear(), m, 1)
      const cnt = events.filter(e => { try { const ed = new Date(e.start_at); return ed.getFullYear() === current.getFullYear() && ed.getMonth() === m } catch { return false } }).length
      return { month: m, label: MONTHS_RU[m], count: cnt }
    })
  }

  // --- Day view ---
  const dayEvents = eventsOnDay(current)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">Расписание</h1>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-secondary/30">
          {VIEWS.map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === v ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {v === 'day' ? 'День' : v === 'month' ? 'Месяц' : 'Год'}
            </button>
          ))}
        </div>
        <button onClick={() => openForm()} className="flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" /> Событие
        </button>
      </div>

      {/* Calendar nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"><ChevronLeft className="h-4 w-4" /></button>
        <span className="flex-1 text-center font-semibold capitalize">{title}</span>
        <button onClick={() => setCurrent(new Date())} className="h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors">Сегодня</button>
        <button onClick={() => nav(1)} className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {/* Month view */}
      {view === 'month' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border">
            {DAYS_RU.map(d => <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {buildMonthGrid().map((day, i) => {
              const isToday = day && isSameDay(day, new Date())
              const dayEvs = day ? eventsOnDay(day) : []
              return (
                <div key={i} onClick={() => { if (day) { setCurrent(day); setView('day') } }} className={`min-h-[80px] p-1.5 border-b border-r border-border/50 cursor-pointer transition-colors ${day ? 'hover:bg-secondary/20' : 'bg-secondary/5'} ${isToday ? 'bg-primary/5' : ''}`}>
                  {day && (
                    <>
                      <span className={`text-xs font-medium inline-flex h-6 w-6 items-center justify-center rounded-full ${isToday ? 'bg-primary text-white' : 'text-foreground'}`}>{day.getDate()}</span>
                      <div className="mt-1 space-y-0.5">
                        {dayEvs.slice(0, 3).map(ev => (
                          <div key={ev.id} className="text-[10px] px-1 py-0.5 rounded truncate text-white" style={{ background: ev.color }}>{ev.title}</div>
                        ))}
                        {dayEvs.length > 3 && <div className="text-[10px] text-muted-foreground px-1">+{dayEvs.length - 3} ещё</div>}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Day view */}
      {view === 'day' && (
        <div className="rounded-xl border border-border bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="font-medium">{dayEvents.length} событий</span>
            <button onClick={() => openForm(current)} className="text-sm text-primary hover:underline flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Добавить</button>
          </div>
          {dayEvents.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>Нет событий на этот день</p>
              <button onClick={() => openForm(current)} className="mt-3 text-sm text-primary hover:underline">Добавить событие</button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {dayEvents.map(ev => (
                <div key={ev.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors group cursor-pointer" onClick={() => openEdit(ev)}>
                  <div className="h-3 w-3 rounded-full mt-1.5 shrink-0" style={{ background: ev.color }} />
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${ev.is_done ? 'line-through text-muted-foreground' : ''}`}>{ev.title}</p>
                    {ev.description && <p className="text-sm text-muted-foreground mt-0.5">{ev.description}</p>}
                    <div className="flex items-center gap-3 mt-1">
                      {!ev.all_day && <span className="text-xs text-muted-foreground">{new Date(ev.start_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}{ev.end_at ? ` — ${new Date(ev.end_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
                      {ev.recurrence && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Repeat className="h-3 w-3" /> {RECURRENCE.find(r => r.value === ev.recurrence)?.label}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleToggle(ev) }} className={`h-7 w-7 rounded flex items-center justify-center transition-colors ${ev.is_done ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}><Check className="h-4 w-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); openEdit(ev) }} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"><Edit3 className="h-4 w-4" /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(ev.id) }} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Year view */}
      {view === 'year' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {buildYearGrid().map(({ month, label, count }) => {
            const isCurrentMonth = new Date().getFullYear() === current.getFullYear() && new Date().getMonth() === month
            return (
              <button key={month} onClick={() => { setCurrent(new Date(current.getFullYear(), month, 1)); setView('month') }}
                className={`rounded-xl border p-4 text-left hover:bg-secondary/20 transition-colors ${isCurrentMonth ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
                <p className="font-medium text-sm">{label}</p>
                <p className="text-2xl font-bold mt-1">{count}</p>
                <p className="text-xs text-muted-foreground">событий</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Upcoming events list */}
      {view !== 'day' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold">Предстоящие события</h2>
          </div>
          {events.filter(e => !e.is_done && new Date(e.start_at) >= new Date()).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()).slice(0, 10).length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Нет предстоящих событий</p>
          ) : (
            <div className="divide-y divide-border">
              {events.filter(e => !e.is_done && new Date(e.start_at) >= new Date()).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()).slice(0, 10).map(ev => (
                <div key={ev.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors group cursor-pointer" onClick={() => openEdit(ev)}>
                  <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: ev.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ev.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(ev.start_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  </div>
                  {ev.recurrence && <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(ev.id) }} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Event Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Новое событие</h2>
              <button onClick={() => setShowForm(false)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Название события" className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary" />
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Описание (необязательно)" rows={2} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary resize-none" />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.all_day} onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))} className="rounded" />
                Весь день
              </label>
            </div>
            {!form.all_day && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Начало</label><input type="datetime-local" min={new Date().toISOString().slice(0,16)} value={form.start_at} onChange={e => { setForm(f => ({ ...f, start_at: e.target.value })); setFormError('') }} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">Конец</label><input type="datetime-local" min={form.start_at || new Date().toISOString().slice(0,16)} value={form.end_at} onChange={e => setForm(f => ({ ...f, end_at: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
              </div>
            )}
            {form.all_day && (
              <div><label className="text-xs text-muted-foreground">Дата</label><input type="date" min={todayIso()} value={form.start_at.slice(0, 10)} onChange={e => { setForm(f => ({ ...f, start_at: e.target.value + 'T00:00' })); setFormError('') }} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
            )}
            {formError && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{formError}</p>}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Повтор</label>
              <select value={form.recurrence} onChange={e => setForm(f => ({ ...f, recurrence: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                {RECURRENCE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Цвет</label>
              <div className="flex gap-2">
                {COLORS.map(c => <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))} className={`h-7 w-7 rounded-full transition-transform ${form.color === c ? 'scale-125 ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'}`} style={{ background: c }} />)}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowForm(false); setFormError('') }} className="flex-1 h-10 rounded-lg border border-border text-sm hover:bg-secondary transition-colors">Отмена</button>
              <button onClick={handleSave} disabled={saving || !form.title.trim()} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving ? 'Сохранение...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Event Modal */}
      {editEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditEvent(null)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Редактировать событие</h2>
              <button onClick={() => setEditEvent(null)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
            </div>
            <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} placeholder="Название события" className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary" />
            <textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} placeholder="Описание (необязательно)" rows={2} className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary resize-none" />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={editForm.all_day} onChange={e => setEditForm(f => ({ ...f, all_day: e.target.checked }))} className="rounded" />
                Весь день
              </label>
            </div>
            {!editForm.all_day && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">Начало</label><input type="datetime-local" min={new Date().toISOString().slice(0,16)} value={editForm.start_at} onChange={e => { setEditForm(f => ({ ...f, start_at: e.target.value })); setEditError('') }} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
                <div><label className="text-xs text-muted-foreground">Конец</label><input type="datetime-local" min={editForm.start_at || new Date().toISOString().slice(0,16)} value={editForm.end_at} onChange={e => setEditForm(f => ({ ...f, end_at: e.target.value }))} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
              </div>
            )}
            {editForm.all_day && (
              <div><label className="text-xs text-muted-foreground">Дата</label><input type="date" min={todayIso()} value={editForm.start_at.slice(0, 10)} onChange={e => { setEditForm(f => ({ ...f, start_at: e.target.value + 'T00:00' })); setEditError('') }} className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary mt-1" /></div>
            )}
            {editError && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{editError}</p>}
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Повтор</label>
              <select value={editForm.recurrence} onChange={e => setEditForm(f => ({ ...f, recurrence: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary">
                {RECURRENCE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Цвет</label>
              <div className="flex gap-2">
                {COLORS.map(c => <button key={c} onClick={() => setEditForm(f => ({ ...f, color: c }))} className={`h-7 w-7 rounded-full transition-transform ${editForm.color === c ? 'scale-125 ring-2 ring-offset-2 ring-primary' : 'hover:scale-110'}`} style={{ background: c }} />)}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setEditEvent(null); setEditError('') }} className="flex-1 h-10 rounded-lg border border-border text-sm hover:bg-secondary transition-colors">Отмена</button>
              <button onClick={handleUpdate} disabled={saving || !editForm.title.trim()} className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
