import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

type ThemeMode = 'dark' | 'light'
type ThemeAccent = 'teal' | 'amber' | string

export interface CustomPrimary { h: number; s: number; l: number }

interface ThemeState {
  mode: ThemeMode
  accent: ThemeAccent
  customEnabled: boolean
  customPrimary: CustomPrimary
  radius: number
  toggleMode: () => void
  setMode: (m: ThemeMode) => void
  setAccent: (a: ThemeAccent) => void
  setCustomEnabled: (v: boolean) => void
  setCustomPrimary: (c: CustomPrimary) => void
  setRadius: (r: number) => void
  /** Called once after server data is loaded; skips persistence round-trip */
  syncFromServer: (data: {
    mode: ThemeMode
    accent: ThemeAccent
    custom_enabled: boolean
    primary_h: number
    primary_s: number
    primary_l: number
    radius: number
  }) => void
  // backward-compat aliases
  theme: ThemeMode
  toggleTheme: () => void
  setTheme: (t: ThemeMode) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() =>
    readLocal<ThemeMode>('theme', 'dark'),
  )
  const [accent, setAccentState] = useState<ThemeAccent>(() =>
    readLocal<ThemeAccent>('theme-accent', 'teal'),
  )
  const [customEnabled, setCustomEnabledState] = useState<boolean>(() =>
    readLocal<boolean>('theme-custom-enabled', false),
  )
  const [customPrimary, setCustomPrimaryState] = useState<CustomPrimary>(() =>
    readLocal<CustomPrimary>('theme-custom-primary', { h: 174, s: 80, l: 39 }),
  )
  const [radius, setRadiusState] = useState<number>(() =>
    readLocal<number>('theme-radius', 0.5),
  )

  // Apply all theme CSS whenever anything changes
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(mode)
    root.style.colorScheme = mode
    root.setAttribute('data-accent', accent)

    if (customEnabled) {
      root.style.setProperty('--primary', `${customPrimary.h} ${customPrimary.s}% ${customPrimary.l}%`)
    } else {
      root.style.removeProperty('--primary')
    }
    root.style.setProperty('--radius', `${radius}rem`)

    localStorage.setItem('theme', JSON.stringify(mode))
    localStorage.setItem('theme-accent', JSON.stringify(accent))
    localStorage.setItem('theme-custom-enabled', JSON.stringify(customEnabled))
    localStorage.setItem('theme-custom-primary', JSON.stringify(customPrimary))
    localStorage.setItem('theme-radius', JSON.stringify(radius))
  }, [mode, accent, customEnabled, customPrimary, radius])

  const toggleMode = useCallback(() => setModeState((m) => (m === 'dark' ? 'light' : 'dark')), [])
  const setMode = useCallback((m: ThemeMode) => setModeState(m), [])
  const setAccent = useCallback((a: ThemeAccent) => setAccentState(a), [])
  const setCustomEnabled = useCallback((v: boolean) => setCustomEnabledState(v), [])
  const setCustomPrimary = useCallback((c: CustomPrimary) => setCustomPrimaryState(c), [])
  const setRadius = useCallback((r: number) => setRadiusState(r), [])

  const syncFromServer = useCallback((data: {
    mode: ThemeMode
    accent: ThemeAccent
    custom_enabled: boolean
    primary_h: number
    primary_s: number
    primary_l: number
    radius: number
  }) => {
    setModeState(data.mode)
    setAccentState(data.accent)
    setCustomEnabledState(data.custom_enabled)
    setCustomPrimaryState({ h: data.primary_h, s: data.primary_s, l: data.primary_l })
    setRadiusState(data.radius)
  }, [])

  return (
    <ThemeContext.Provider value={{
      mode, accent, customEnabled, customPrimary, radius,
      toggleMode, setMode, setAccent, setCustomEnabled, setCustomPrimary, setRadius,
      syncFromServer,
      // backward compat
      theme: mode,
      toggleTheme: toggleMode,
      setTheme: setMode,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
