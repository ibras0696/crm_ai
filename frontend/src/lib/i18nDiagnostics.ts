const MISSING_KEYS_STORAGE_KEY = 'crm.i18n.missing-keys'
const MAX_STORED_KEYS = 200

interface MissingKeyRecord {
  locale: string
  namespace: string
  key: string
  count: number
  last_seen_at: string
}

function readStoredMissingKeys(): MissingKeyRecord[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MISSING_KEYS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is MissingKeyRecord => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Record<string, unknown>
      return (
        typeof candidate.locale === 'string'
        && typeof candidate.namespace === 'string'
        && typeof candidate.key === 'string'
        && typeof candidate.count === 'number'
        && typeof candidate.last_seen_at === 'string'
      )
    })
  } catch {
    return []
  }
}

function writeStoredMissingKeys(records: MissingKeyRecord[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MISSING_KEYS_STORAGE_KEY, JSON.stringify(records.slice(0, MAX_STORED_KEYS)))
  } catch {
    // ignore storage errors
  }
}

export function reportMissingI18nKey(locales: readonly string[] | string, namespace: string, key: string): void {
  const locale = Array.isArray(locales) ? locales[0] || 'unknown' : locales || 'unknown'
  const normalizedLocale = String(locale || 'unknown')
  const normalizedNamespace = String(namespace || 'common')
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey) return

  const records = readStoredMissingKeys()
  const now = new Date().toISOString()
  const idx = records.findIndex(
    (item) =>
      item.locale === normalizedLocale && item.namespace === normalizedNamespace && item.key === normalizedKey,
  )
  if (idx >= 0) {
    const existing = records[idx]
    if (existing) {
      records[idx] = {
        ...existing,
        count: existing.count + 1,
        last_seen_at: now,
      }
    }
  } else {
    records.unshift({
      locale: normalizedLocale,
      namespace: normalizedNamespace,
      key: normalizedKey,
      count: 1,
      last_seen_at: now,
    })
  }
  writeStoredMissingKeys(records)
  if (import.meta.env.DEV) {
    console.warn(`[i18n] missing key: ${normalizedLocale}:${normalizedNamespace}.${normalizedKey}`)
  }
}
