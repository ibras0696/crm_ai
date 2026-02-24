export const SA_SELECTED_ORG_KEY = 'sa_selected_org_id'

export const PLAN_LABELS: Record<string, string> = {
  free: 'Бесплатный',
  team: 'Команда',
  business: 'Бизнес',
}

export const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Активна',
  past_due: 'Просрочена',
  cancelled: 'Отменена',
  trialing: 'Триал',
  none: 'Нет',
}

export function formatBytes(b: number) {
  if (!Number.isFinite(b) || b < 0) return '—'
  if (b < 1024) return `${b} Б`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} КБ`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} МБ`
  return `${(b / 1073741824).toFixed(1)} ГБ`
}
