import { useState, useRef, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun, Palette } from '@phosphor-icons/react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'

const ACCENT_HEX: Record<string, string> = {
  teal: 'hsl(174,80%,39%)',
  amber: 'hsl(37,90%,44%)',
}

const MODES = [
  { id: 'dark' as const, Icon: Moon, label: 'Тёмная' },
  { id: 'light' as const, Icon: Sun, label: 'Светлая' },
]

function TealIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="11" fill="hsl(174,80%,39%)" />
      <path
        d="M11 4.5C11 4.5 6 9.5 6 12.5A5 5 0 0 0 16 12.5C16 9.5 11 4.5 11 4.5Z"
        fill="white"
        opacity="0.92"
      />
    </svg>
  )
}

function AmberIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="11" fill="hsl(37,90%,44%)" />
      <circle cx="11" cy="11" r="3.8" fill="white" opacity="0.92" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        const x1 = 11 + 5.8 * Math.cos(rad)
        const y1 = 11 + 5.8 * Math.sin(rad)
        const x2 = 11 + 7.5 * Math.cos(rad)
        const y2 = 11 + 7.5 * Math.sin(rad)
        return (
          <line
            key={deg}
            x1={x1.toFixed(2)}
            y1={y1.toFixed(2)}
            x2={x2.toFixed(2)}
            y2={y2.toFixed(2)}
            stroke="white"
            strokeWidth="1.7"
            strokeLinecap="round"
            opacity="0.92"
          />
        )
      })}
    </svg>
  )
}

export function ThemeSwitcher() {
  const { mode, accent, setMode, setAccent } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.94 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="bg-card border border-border rounded-2xl shadow-2xl p-3 w-52"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-2">
              Режим
            </p>

            <div className="flex gap-1.5 mb-3">
              {MODES.map(({ id, Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium transition-all',
                    mode === id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                  )}
                >
                  <Icon size={18} weight="duotone" />
                  {label}
                </button>
              ))}
            </div>

            <div className="h-px bg-border mb-3" />

            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-2">
              Акцент
            </p>

            <div className="flex gap-1.5">
              <button
                onClick={() => setAccent('teal')}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium transition-all',
                  accent === 'teal'
                    ? 'ring-2 ring-[hsl(174,80%,39%)] bg-[hsl(174,80%,39%,0.12)] text-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                )}
              >
                <TealIcon />
                Teal
              </button>

              <button
                onClick={() => setAccent('amber')}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium transition-all',
                  accent === 'amber'
                    ? 'ring-2 ring-[hsl(37,90%,44%)] bg-[hsl(37,90%,44%,0.12)] text-foreground'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted'
                )}
              >
                <AmberIcon />
                Amber
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger */}
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        aria-label="Настройки темы"
        className={cn(
          'relative h-12 w-12 rounded-full shadow-lg border border-border flex items-center justify-center transition-colors',
          'bg-card hover:bg-accent',
          open && 'ring-2 ring-primary'
        )}
      >
        <motion.span
          animate={{ rotate: open ? 30 : 0 }}
          transition={{ duration: 0.22, ease: 'easeInOut' }}
          className="flex"
        >
          <Palette size={22} className="text-primary" weight="duotone" />
        </motion.span>
        {/* Active accent dot */}
        <span
          className="absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-card"
          style={{ background: ACCENT_HEX[accent] }}
        />
      </motion.button>
    </div>
  )
}
