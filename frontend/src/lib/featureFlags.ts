const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])
const I18N_ROLLOUT_SEED_STORAGE_KEY = 'crm.i18n.rollout-seed'

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string') return fallback
  const normalized = raw.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return fallback
}

function parseRolloutPercent(raw: string | undefined, fallback: number): number {
  if (typeof raw !== 'string') return fallback
  const value = Number.parseFloat(raw.trim())
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.min(100, value))
}

function readRolloutSeed(): string {
  if (typeof window === 'undefined') return 'server'
  try {
    const existing = window.localStorage.getItem(I18N_ROLLOUT_SEED_STORAGE_KEY)
    if (existing && existing.trim()) return existing
    const created = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).trim()
    window.localStorage.setItem(I18N_ROLLOUT_SEED_STORAGE_KEY, created)
    return created
  } catch {
    return 'fallback'
  }
}

function hashStringToBucket(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash % 100)
}

export function isI18nEnabled(): boolean {
  const flagEnabled = parseBooleanFlag(import.meta.env.VITE_I18N_ENABLED, true)
  if (!flagEnabled) return false

  const rolloutPercent = parseRolloutPercent(import.meta.env.VITE_I18N_ROLLOUT_PERCENT, 100)
  if (rolloutPercent >= 100) return true
  if (rolloutPercent <= 0) return false

  const bucket = hashStringToBucket(readRolloutSeed())
  return bucket < rolloutPercent
}
