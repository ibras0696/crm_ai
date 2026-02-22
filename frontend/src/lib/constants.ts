// Shared constants used across multiple pages/components.

// --- Reports / Dashboard ---

export const WIDGET_TYPES = [
  { value: 'metric', label: 'Метрика' },
  { value: 'bar', label: 'Гистограмма' },
  { value: 'line', label: 'Линия' },
  { value: 'area', label: 'Область' },
  { value: 'pie', label: 'Круговая' },
  { value: 'donut', label: 'Кольцевая' },
  { value: 'table', label: 'Таблица' },
] as const

export const AGGREGATIONS = [
  { value: 'count', label: 'Количество' },
  { value: 'sum', label: 'Сумма' },
  { value: 'avg', label: 'Среднее' },
  { value: 'min', label: 'Минимум' },
  { value: 'max', label: 'Максимум' },
] as const

export const FILTER_OPERATORS = [
  { value: 'eq', label: 'Равно' },
  { value: 'neq', label: 'Не равно' },
  { value: 'contains', label: 'Содержит' },
  { value: 'gt', label: 'Больше' },
  { value: 'lt', label: 'Меньше' },
  { value: 'gte', label: '≥ (не менее)' },
  { value: 'lte', label: '≤ (не более)' },
] as const

export const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316']

// --- Schedule ---

export const EVENT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']

export const RECURRENCE_OPTIONS = [
  { value: '', label: 'Без повтора' },
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekly', label: 'Каждую неделю' },
  { value: 'monthly', label: 'Каждый месяц' },
  { value: 'yearly', label: 'Каждый год' },
] as const

export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

export const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
