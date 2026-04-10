import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { scheduleApi } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { isAxiosError } from 'axios'
import { Plus, ChevronLeft, ChevronRight, Check, Trash2, X, Repeat, Clock, Edit3 } from 'lucide-react'
import { expandRecurringEvents, type ExpandedEvent } from '@/lib/schedule-utils'

interface Event {
  id: string
  title: string
  description?: string
  start_at: string
  end_at?: string | null
  all_day: boolean
  color: string
  is_done: boolean
  recurrence?: string | null
  assigned_to?: string | null
  participant_ids?: string[]
  reminder_offsets_minutes?: number[]
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
const REMINDER_OPTIONS = [
  { value: 60, label: 'За 1 час' },
  { value: 120, label: 'За 2 часа' },
  { value: 1440, label: 'За 1 день' },
]
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))

function extractApiError(e: unknown, fallback: string): string {
  if (!isAxiosError(e)) return fallback
  const apiError = (e.response?.data as { error?: { message?: string } } | undefined)?.error
  if (apiError?.message) return apiError.message
  if (e.response?.status === 429) return 'Слишком много запросов. Попробуйте позже.'
  return fallback
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatDateKeyLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function extractIsoDateKey(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value || '')
  return match?.[1] || ''
}

function parseLocalDateTimeInput(value: string): Date | null {
  const [datePart, timePart] = value.split('T')
  if (!datePart || !timePart) return null
  const [yearRaw, monthRaw, dayRaw] = datePart.split('-')
  const [hourRaw, minuteRaw] = timePart.slice(0, 5).split(':')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function localInputToApiIso(value: string): string {
  const dt = parseLocalDateTimeInput(value)
  return dt ? dt.toISOString() : value
}

function apiIsoToLocalInput(value: string): string {
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return value.slice(0, 16)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const d = String(dt.getDate()).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}`
}

function allDayDateToApiIso(value: string): string {
  const datePart = extractIsoDateKey(value)
  return datePart ? `${datePart}T00:00:00Z` : value
}

function eventDayKey(event: Pick<Event, 'start_at' | 'all_day'>): string {
  if (event.all_day) return extractIsoDateKey(event.start_at)
  const dt = new Date(event.start_at)
  return Number.isNaN(dt.getTime()) ? '' : formatDateKeyLocal(dt)
}

function formatDateRuFromKey(dateKey: string): string {
  const parts = (dateKey || '').split('-')
  if (parts.length !== 3) return dateKey
  const y = Number(parts[0])
  const m = Number(parts[1])
  const d = Number(parts[2])
  if ([y, m, d].some((n) => Number.isNaN(n))) return dateKey
  return new Date(y, m - 1, d).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
}

function splitDateTime(value: string) {
  if (!value) return { date: '', time: '09:00' }
  const [datePart, timePart] = value.split('T')
  return {
    date: datePart || '',
    time: (timePart || '09:00').slice(0, 5),
  }
}

function joinDateTime(date: string, time: string) {
  if (!date || !time) return ''
  return `${date}T${time}`
}

function withDate(datetimeValue: string, nextDate: string) {
  const { time } = splitDateTime(datetimeValue)
  return joinDateTime(nextDate, time)
}

function withTime(datetimeValue: string, nextTime: string) {
  const { date } = splitDateTime(datetimeValue)
  return joinDateTime(date, nextTime)
}

function TimeWheelField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [hour, minute] = (value || '09:00').split(':')

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <div className="relative" ref={wrapRef}>
      <label className="text-xs text-muted-foreground block mb-1">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((p) => !p)}
        className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary flex items-center justify-between disabled:opacity-60"
      >
        <span>{value || '09:00'}</span>
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-xl p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/70 bg-background/40 p-1">
              <div className="text-[11px] text-muted-foreground px-1 pb-1">Часы</div>
              <div className="max-h-36 overflow-y-auto pr-1 space-y-1">
                {HOUR_OPTIONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onChange(`${h}:${minute || '00'}`)}
                    className={`w-full h-8 rounded-md text-sm transition-colors ${
                      h === hour ? 'bg-primary/15 text-primary border border-primary/30' : 'hover:bg-secondary/30'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/40 p-1">
              <div className="text-[11px] text-muted-foreground px-1 pb-1">Минуты</div>
              <div className="max-h-36 overflow-y-auto pr-1 space-y-1">
                {MINUTE_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange(`${hour || '09'}:${m}`)}
                    className={`w-full h-8 rounded-md text-sm transition-colors ${
                      m === minute ? 'bg-primary/15 text-primary border border-primary/30' : 'hover:bg-secondary/30'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SchedulePage() {
  const { user, members } = useAuth()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('month')
  const [current, setCurrent] = useState(new Date())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    start_at: '',
    end_at: '',
    all_day: false,
    color: COLORS[0],
    recurrence: '',
    participant_ids: [] as string[],
    reminder_offsets_minutes: [] as number[],
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [editError, setEditError] = useState('')
  const [editEvent, setEditEvent] = useState<Event | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    start_at: '',
    end_at: '',
    all_day: false,
    color: COLORS[0],
    recurrence: '',
    participant_ids: [] as string[],
    reminder_offsets_minutes: [] as number[],
  })
  const [editMemberSearch, setEditMemberSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await scheduleApi.list()
      if (r.data.ok && r.data.data) setEvents(r.data.data as Event[])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const todayIso = () => formatDateKeyLocal(new Date())

  const openForm = (day?: Date) => {
    const d = day || new Date()
    const iso = formatDateKeyLocal(d)
    setForm(f => ({
      ...f,
      start_at: iso + 'T09:00',
      end_at: iso + 'T10:00',
      all_day: false,
      participant_ids: user?.id ? [user.id] : [],
      reminder_offsets_minutes: [60],
    }))
    setMemberSearch('')
    setFormError('')
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    if (form.all_day) {
      const selectedDate = splitDateTime(form.start_at).date
      if (selectedDate < todayIso()) {
        setFormError('Нельзя создать событие задним числом. Выберите сегодняшнюю или будущую дату.')
        return
      }
    } else {
      const eventDate = new Date(form.start_at)
      const eventEndDate = form.end_at ? new Date(form.end_at) : null
      const now = new Date()
      now.setSeconds(0, 0)
      if (eventDate < now) {
        setFormError('Нельзя создать событие задним числом. Выберите дату и время не раньше текущего момента.')
        return
      }
      if (eventEndDate && eventEndDate < eventDate) {
        setFormError('Время окончания не может быть раньше времени начала.')
        return
      }
    }
    setFormError('')
    setSaving(true)
    try {
      const assignedTo = form.participant_ids.find(id => id !== user?.id)
      const r = await scheduleApi.create({
        ...form,
        start_at: form.all_day ? allDayDateToApiIso(form.start_at) : localInputToApiIso(form.start_at),
        end_at: form.all_day ? undefined : (form.end_at ? localInputToApiIso(form.end_at) : undefined),
        all_day: form.all_day,
        recurrence: form.recurrence || undefined,
        assigned_to: assignedTo,
      })
      if (r.data.ok && r.data.data) {
        setEvents(prev => [...prev, r.data.data as Event])
        setShowForm(false)
        setForm({
          title: '',
          description: '',
          start_at: '',
          end_at: '',
          all_day: false,
          color: COLORS[0],
          recurrence: '',
          participant_ids: user?.id ? [user.id] : [],
          reminder_offsets_minutes: [],
        })
      }
    } catch (e) {
      setFormError(extractApiError(e, 'Не удалось создать событие'))
    }
    setSaving(false)
  }

  const openEdit = (ev: Event) => {
    setEditError('')
    setEditEvent(ev)
    setEditForm({
      title: ev.title,
      description: ev.description || '',
      start_at: ev.all_day ? `${extractIsoDateKey(ev.start_at)}T00:00` : apiIsoToLocalInput(ev.start_at),
      end_at: ev.end_at ? (ev.all_day ? `${extractIsoDateKey(ev.end_at)}T00:00` : apiIsoToLocalInput(ev.end_at)) : '',
      all_day: ev.all_day,
      color: ev.color || COLORS[0],
      recurrence: ev.recurrence || '',
      participant_ids: ev.participant_ids || (ev.assigned_to ? [ev.assigned_to] : []),
      reminder_offsets_minutes: ev.reminder_offsets_minutes || [],
    })
    setEditMemberSearch('')
  }

  const handleUpdate = async () => {
    if (!editEvent || !editForm.title.trim()) return
    if (editForm.all_day) {
      const selectedDate = splitDateTime(editForm.start_at).date
      if (selectedDate < todayIso()) {
        setEditError('Нельзя перенести событие в прошлое. Выберите сегодняшнюю или будущую дату.')
        return
      }
    } else {
      const eventDate = new Date(editForm.start_at)
      const eventEndDate = editForm.end_at ? new Date(editForm.end_at) : null
      const now = new Date()
      now.setSeconds(0, 0)
      if (eventDate < now) {
        setEditError('Нельзя перенести событие в прошлое. Выберите дату и время не раньше текущего момента.')
        return
      }
      if (eventEndDate && eventEndDate < eventDate) {
        setEditError('Время окончания не может быть раньше времени начала.')
        return
      }
    }
    setEditError('')
    setSaving(true)
    try {
      const assignedTo = editForm.participant_ids.find(id => id !== user?.id)
      const r = await scheduleApi.update(editEvent.id, {
        title: editForm.title,
        description: editForm.description || undefined,
        start_at: editForm.all_day ? allDayDateToApiIso(editForm.start_at) : localInputToApiIso(editForm.start_at),
        end_at: editForm.all_day ? undefined : (editForm.end_at ? localInputToApiIso(editForm.end_at) : undefined),
        all_day: editForm.all_day,
        color: editForm.color,
        assigned_to: assignedTo,
        participant_ids: editForm.participant_ids,
        reminder_offsets_minutes: editForm.reminder_offsets_minutes,
        recurrence: editForm.recurrence || undefined,
      })
      if (r.data.ok && r.data.data) {
        setEvents(prev => prev.map(e => e.id === editEvent.id ? r.data.data as Event : e))
        setEditEvent(null)
      }
    } catch (e) {
      setEditError(extractApiError(e, 'Не удалось обновить событие'))
    }
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

  // --- Expanded recurring events ---
  const viewRange = useMemo(() => {
    if (view === 'day') {
      const start = new Date(current.getFullYear(), current.getMonth(), current.getDate())
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      return { start, end }
    }
    if (view === 'month') {
      const start = new Date(current.getFullYear(), current.getMonth(), 1)
      // include padding days: go back to Monday of the first week
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
      const end = new Date(current.getFullYear(), current.getMonth() + 1, 0)
      // include padding days: go to Sunday of the last week
      end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7)) % 7)
      return { start, end }
    }
    // year
    const start = new Date(current.getFullYear(), 0, 1)
    const end = new Date(current.getFullYear(), 11, 31)
    return { start, end }
  }, [current, view])

  const expandedEvents: ExpandedEvent[] = useMemo(
    () => expandRecurringEvents(events, viewRange.start, viewRange.end),
    [events, viewRange],
  )

  // For upcoming events, expand 60 days ahead
  const upcomingExpanded: ExpandedEvent[] = useMemo(() => {
    const now = new Date()
    const future = new Date()
    future.setDate(future.getDate() + 60)
    return expandRecurringEvents(events, now, future)
  }, [events])

  const eventsOnDay = (d: Date) => {
    const dayKey = formatDateKeyLocal(d)
    return expandedEvents.filter((e) => eventDayKey(e) === dayKey)
  }

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

  // --- Year grid (using expanded events for correct recurring counts) ---
  const buildYearGrid = () => {
    const yearStart = new Date(current.getFullYear(), 0, 1)
    const yearEnd = new Date(current.getFullYear(), 11, 31)
    const yearExpanded = expandRecurringEvents(events, yearStart, yearEnd)
    return Array.from({ length: 12 }, (_, m) => {
      const cnt = yearExpanded.filter((e) => {
        const key = eventDayKey(e)
        if (!key) return false
        const [y, month] = key.split('-').map((part) => Number(part))
        return y === current.getFullYear() && month === m + 1
      }).length
      return { month: m, label: MONTHS_RU[m], count: cnt }
    })
  }

  // --- Day view ---
  const dayEvents = eventsOnDay(current)
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return members
    return members.filter(m => {
      const fullName = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim().toLowerCase()
      return (
        fullName.includes(q) ||
        (m.user_email || '').toLowerCase().includes(q)
      )
    })
  }, [memberSearch, members])
  const filteredEditMembers = useMemo(() => {
    const q = editMemberSearch.trim().toLowerCase()
    if (!q) return members
    return members.filter(m => {
      const fullName = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim().toLowerCase()
      return (
        fullName.includes(q) ||
        (m.user_email || '').toLowerCase().includes(q)
      )
    })
  }, [editMemberSearch, members])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

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
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button onClick={() => nav(-1)} className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"><ChevronLeft className="h-4 w-4" /></button>
        <span className="flex-1 text-center font-semibold capitalize">{title}</span>
        <button onClick={() => setCurrent(new Date())} className="h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors">Сегодня</button>
        <button onClick={() => nav(1)} className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-secondary transition-colors"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {/* Month view */}
      {view === 'month' && (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-7 border-b border-border">
              {DAYS_RU.map(dayLabel => <div key={dayLabel} className="py-2 text-center text-xs font-medium text-muted-foreground">{dayLabel}</div>)}
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
                  <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
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
          {(() => {
            const todayKey = formatDateKeyLocal(new Date())
            const now = new Date()
            const upcoming = upcomingExpanded
              .filter((e) => {
                if (e.is_done) return false
                if (e.all_day) {
                  const key = eventDayKey(e)
                  return !!key && key >= todayKey
                }
                const start = new Date(e.start_at)
                if (Number.isNaN(start.getTime())) return false
                return start >= now
              })
              .sort((a, b) => {
                const leftKey = eventDayKey(a)
                const rightKey = eventDayKey(b)
                const left = a.all_day ? Date.parse(`${leftKey || '1970-01-01'}T00:00:00`) : new Date(a.start_at).getTime()
                const right = b.all_day ? Date.parse(`${rightKey || '1970-01-01'}T00:00:00`) : new Date(b.start_at).getTime()
                return left - right
              })
              .slice(0, 10)
            if (upcoming.length === 0) {
              return <p className="px-4 py-6 text-sm text-muted-foreground">Нет предстоящих событий</p>
            }
            return (
              <div className="divide-y divide-border">
                {upcoming.map((ev, idx) => {
                  const original = events.find(e => e.id === ev._originalId) || ev
                  return (
                    <div key={`${ev._originalId}-${idx}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors group cursor-pointer" onClick={() => openEdit(original as Event)}>
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: ev.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ev.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {ev.all_day
                            ? formatDateRuFromKey(eventDayKey(ev))
                            : new Date(ev.start_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </p>
                      </div>
                      {ev.recurrence && <Repeat className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      {!ev._isVirtual && (
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(ev.id) }} className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all"><Trash2 className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* Create Event Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative z-10 w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl p-4 sm:p-6 space-y-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата начала</label>
                  <input
                    type="date"
                    min={todayIso()}
                    value={splitDateTime(form.start_at).date}
                    onChange={e => {
                      setForm(f => ({ ...f, start_at: withDate(f.start_at, e.target.value) }))
                      setFormError('')
                    }}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
                  />
                </div>
                <TimeWheelField
                  label="Время начала"
                  value={splitDateTime(form.start_at).time}
                  onChange={(next) => {
                    setForm(f => ({ ...f, start_at: withTime(f.start_at, next) }))
                    setFormError('')
                  }}
                />
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата конца</label>
                  <input
                    type="date"
                    min={splitDateTime(form.start_at).date || todayIso()}
                    value={splitDateTime(form.end_at).date}
                    onChange={e => setForm(f => ({ ...f, end_at: withDate(f.end_at || f.start_at, e.target.value) }))}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
                  />
                </div>
                <TimeWheelField
                  label="Время конца"
                  value={splitDateTime(form.end_at).time}
                  onChange={(next) => setForm(f => ({ ...f, end_at: withTime(f.end_at || f.start_at, next) }))}
                />
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
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Участники события</label>
              <input
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                placeholder="Поиск сотрудника по имени/email"
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
              />
              <div className="max-h-32 overflow-auto rounded-lg border border-border/60 divide-y divide-border/40">
                {filteredMembers.map(m => {
                  const display = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || 'Пользователь'
                  const checked = form.participant_ids.includes(m.user_id)
                  return (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/20">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setForm(prev => ({
                            ...prev,
                            participant_ids: e.target.checked
                              ? [...prev.participant_ids, m.user_id]
                              : prev.participant_ids.filter(id => id !== m.user_id),
                          }))
                        }}
                      />
                      <span>{display}</span>
                    </label>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => setForm(prev => ({ ...prev, participant_ids: user?.id ? [user.id] : [] }))}
                className="text-xs text-primary hover:underline"
              >
                Оставить только меня
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Напомнить</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {REMINDER_OPTIONS.map(opt => {
                  const checked = form.reminder_offsets_minutes.includes(opt.value)
                  return (
                    <label key={opt.value} className="flex items-center gap-2 text-xs rounded-lg border border-border px-2 py-2 cursor-pointer hover:bg-secondary/20">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setForm(prev => ({
                            ...prev,
                            reminder_offsets_minutes: e.target.checked
                              ? [...prev.reminder_offsets_minutes, opt.value]
                              : prev.reminder_offsets_minutes.filter(x => x !== opt.value),
                          }))
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Цвет</label>
              <div className="flex flex-wrap gap-2">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setEditEvent(null)} />
          <div className="relative z-10 w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl p-4 sm:p-6 space-y-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата начала</label>
                  <input
                    type="date"
                    min={todayIso()}
                    value={splitDateTime(editForm.start_at).date}
                    onChange={e => {
                      setEditForm(f => ({ ...f, start_at: withDate(f.start_at, e.target.value) }))
                      setEditError('')
                    }}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
                  />
                </div>
                <TimeWheelField
                  label="Время начала"
                  value={splitDateTime(editForm.start_at).time}
                  onChange={(next) => {
                    setEditForm(f => ({ ...f, start_at: withTime(f.start_at, next) }))
                    setEditError('')
                  }}
                />
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Дата конца</label>
                  <input
                    type="date"
                    min={splitDateTime(editForm.start_at).date || todayIso()}
                    value={splitDateTime(editForm.end_at).date}
                    onChange={e => setEditForm(f => ({ ...f, end_at: withDate(f.end_at || f.start_at, e.target.value) }))}
                    className="w-full h-9 px-2 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
                  />
                </div>
                <TimeWheelField
                  label="Время конца"
                  value={splitDateTime(editForm.end_at).time}
                  onChange={(next) => setEditForm(f => ({ ...f, end_at: withTime(f.end_at || f.start_at, next) }))}
                />
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
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Участники события</label>
              <input
                value={editMemberSearch}
                onChange={e => setEditMemberSearch(e.target.value)}
                placeholder="Поиск сотрудника по имени/email"
                className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm outline-none focus:border-primary"
              />
              <div className="max-h-32 overflow-auto rounded-lg border border-border/60 divide-y divide-border/40">
                {filteredEditMembers.map(m => {
                  const display = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || 'Пользователь'
                  const checked = editForm.participant_ids.includes(m.user_id)
                  return (
                    <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-secondary/20">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setEditForm(prev => ({
                            ...prev,
                            participant_ids: e.target.checked
                              ? [...prev.participant_ids, m.user_id]
                              : prev.participant_ids.filter(id => id !== m.user_id),
                          }))
                        }}
                      />
                      <span>{display}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Напомнить</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {REMINDER_OPTIONS.map(opt => {
                  const checked = editForm.reminder_offsets_minutes.includes(opt.value)
                  return (
                    <label key={opt.value} className="flex items-center gap-2 text-xs rounded-lg border border-border px-2 py-2 cursor-pointer hover:bg-secondary/20">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setEditForm(prev => ({
                            ...prev,
                            reminder_offsets_minutes: e.target.checked
                              ? [...prev.reminder_offsets_minutes, opt.value]
                              : prev.reminder_offsets_minutes.filter(x => x !== opt.value),
                          }))
                        }}
                      />
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Цвет</label>
              <div className="flex flex-wrap gap-2">
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
