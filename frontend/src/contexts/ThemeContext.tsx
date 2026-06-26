import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type ThemeMode = 'dark' | 'light'
type ThemeAccent = 'teal' | 'amber'

interface ThemeState {
  mode: ThemeMode
  accent: ThemeAccent
  toggleMode: () => void
  setMode: (m: ThemeMode) => void
  setAccent: (a: ThemeAccent) => void
  // backward compat aliases
  theme: ThemeMode
  toggleTheme: () => void
  setTheme: (t: ThemeMode) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as ThemeMode) || 'dark'
    }
    return 'dark'
  })

  const [accent, setAccentState] = useState<ThemeAccent>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme-accent') as ThemeAccent) || 'teal'
    }
    return 'teal'
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(mode)
    root.style.colorScheme = mode
    root.setAttribute('data-accent', accent)
    localStorage.setItem('theme', mode)
    localStorage.setItem('theme-accent', accent)
  }, [mode, accent])

  const toggleMode = () => setModeState((m) => (m === 'dark' ? 'light' : 'dark'))
  const setMode = (m: ThemeMode) => setModeState(m)
  const setAccent = (a: ThemeAccent) => setAccentState(a)

  return (
    <ThemeContext.Provider value={{
      mode,
      accent,
      toggleMode,
      setMode,
      setAccent,
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
