import { isI18nEnabled } from '@/lib/featureFlags'

export const APP_LOCALE_STORAGE_KEY = 'crm.locale'
export const SUPPORTED_LOCALES = ['ru', 'en'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function normalizeLocale(value: string | null | undefined): AppLocale {
  if (!isI18nEnabled()) return 'ru'
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw.startsWith('en')) return 'en'
  return 'ru'
}

export function getStoredLocale(): AppLocale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)
    return raw ? normalizeLocale(raw) : null
  } catch {
    return null
  }
}

export function detectBrowserLocale(): AppLocale {
  if (!isI18nEnabled()) return 'ru'
  if (typeof navigator === 'undefined') return 'ru'
  const candidate = navigator.languages?.[0] || navigator.language
  return normalizeLocale(candidate)
}

export function getPreferredLocale(): AppLocale {
  if (!isI18nEnabled()) return 'ru'
  return getStoredLocale() ?? detectBrowserLocale()
}

export function persistLocale(locale: AppLocale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(APP_LOCALE_STORAGE_KEY, normalizeLocale(locale))
  } catch {
    // ignore localStorage failures (private mode / blocked storage)
  }
}
