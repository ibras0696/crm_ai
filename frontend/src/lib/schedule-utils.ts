/**
 * Utilities for expanding recurring schedule events.
 * Expands virtual event instances for the current view range.
 */

export interface ScheduleEvent {
  id: string
  title: string
  description?: string
  start_at: string
  end_at?: string | null
  all_day: boolean
  color: string
  is_done: boolean
  recurrence?: string | null
}

export interface ExpandedEvent extends ScheduleEvent {
  _originalId: string
  _isVirtual: boolean
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function isWithinRange(date: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return date >= rangeStart && date <= rangeEnd
}

function toLocalIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`
}

function advanceDate(date: Date, recurrence: string): Date {
  const next = new Date(date)
  switch (recurrence) {
    case 'daily':
      next.setDate(next.getDate() + 1)
      break
    case 'weekly':
      next.setDate(next.getDate() + 7)
      break
    case 'monthly':
      next.setMonth(next.getMonth() + 1)
      break
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1)
      break
  }
  return next
}

export function expandRecurringEvents(
  events: ScheduleEvent[],
  viewStart: Date,
  viewEnd: Date,
): ExpandedEvent[] {
  const result: ExpandedEvent[] = []
  const MAX_ITERATIONS = 400

  for (const event of events) {
    const eventStart = new Date(event.start_at)
    if (Number.isNaN(eventStart.getTime())) {
      continue
    }

    const duration =
      event.end_at
        ? new Date(event.end_at).getTime() - eventStart.getTime()
        : 0

    if (!event.recurrence) {
      if (isWithinRange(eventStart, viewStart, viewEnd)) {
        result.push({
          ...event,
          _originalId: event.id,
          _isVirtual: false,
        })
      }
      continue
    }

    let current = new Date(eventStart)
    let iterations = 0

    while (current < viewStart && iterations < MAX_ITERATIONS) {
      current = advanceDate(current, event.recurrence)
      iterations++
    }

    while (current <= viewEnd && iterations < MAX_ITERATIONS) {
      if (isWithinRange(current, viewStart, viewEnd) || isSameDay(current, viewStart)) {
        const instanceStart = new Date(current)
        const instanceEnd =
          duration > 0 ? new Date(instanceStart.getTime() + duration) : null

        result.push({
          ...event,
          start_at: toLocalIso(instanceStart),
          end_at: instanceEnd ? toLocalIso(instanceEnd) : event.end_at ?? null,
          _originalId: event.id,
          _isVirtual: !isSameDay(current, eventStart),
        })
      }

      current = advanceDate(current, event.recurrence)
      iterations++
    }
  }

  return result
}
