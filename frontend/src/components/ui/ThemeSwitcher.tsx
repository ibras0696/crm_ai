import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Moon, Sun, Palette, CaretDown, Check,
} from '@phosphor-icons/react'
import { useTheme } from '@/contexts/ThemeContext'
import { appearanceApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Accent presets
// ---------------------------------------------------------------------------
const ACCENTS = [
  { id: 'teal',   label: 'Teal',   h: 174, s: 80, l: 39 },
  { id: 'amber',  label: 'Amber',  h: 37,  s: 90, l: 44 },
  { id: 'violet', label: 'Violet', h: 262, s: 83, l: 58 },
  { id: 'rose',   label: 'Rose',   h: 346, s: 77, l: 50 },
  { id: 'sky',    label: 'Sky',    h: 199, s: 89, l: 48 },
  { id: 'lime',   label: 'Lime',   h: 84,  s: 70, l: 38 },
]

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------
function useDebouncedEffect(fn: () => void, deps: unknown[], ms: number) {
  useEffect(() => {
    const id = window.setTimeout(fn, ms)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, ms])
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------
function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-1 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
      >
        {title}
        <CaretDown
          size={11}
          className={cn('transition-transform duration-200', open ? 'rotate-180' : '')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HSL Slider
// ---------------------------------------------------------------------------
function HslSlider({
  label,
  value,
  min,
  max,
  onChange,
  trackStyle,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  trackStyle?: React.CSSProperties
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 text-[10px] text-muted-foreground shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
        style={trackStyle}
      />
      <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{Math.round(value)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ThemeSwitcher() {
  const {
    mode, setMode,
    accent, setAccent,
    customEnabled, setCustomEnabled,
    customPrimary, setCustomPrimary,
    radius, setRadius,
    syncFromServer,
  } = useTheme()

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Load appearance from server on mount
  useEffect(() => {
    appearanceApi.get().then((r) => {
      if (r.data.ok && r.data.data) syncFromServer(r.data.data)
    }).catch(() => { /* offline / unauthed — use localStorage */ })
  }, [syncFromServer])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  // Debounced save to server
  const save = useCallback(() => {
    appearanceApi.update({
      mode,
      accent,
      custom_enabled: customEnabled,
      primary_h: customPrimary.h,
      primary_s: customPrimary.s,
      primary_l: customPrimary.l,
      radius,
    }).catch(() => { /* ignore offline */ })
  }, [mode, accent, customEnabled, customPrimary, radius])

  useDebouncedEffect(save, [mode, accent, customEnabled, customPrimary, radius], 800)

  const currentAccentHsl = ACCENTS.find((a) => a.id === accent)
  const previewColor = customEnabled
    ? `hsl(${customPrimary.h} ${customPrimary.s}% ${customPrimary.l}%)`
    : currentAccentHsl
      ? `hsl(${currentAccentHsl.h} ${currentAccentHsl.s}% ${currentAccentHsl.l}%)`
      : 'hsl(var(--primary))'

  return (
    <div ref={ref} className="relative">
      {/* Trigger — compact for header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Настройки темы"
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted/60',
          open && 'bg-muted/60 text-foreground',
        )}
      >
        <Palette size={18} weight="duotone" />
        {/* Active color dot */}
        <span
          className="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-background"
          style={{ background: previewColor }}
        />
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-[9999] w-60 rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="space-y-3 p-3">

              {/* Mode */}
              <Section title="Режим">
                <div className="mt-1.5 flex gap-1.5">
                  {([
                    { id: 'dark' as const,  Icon: Moon, label: 'Тёмная' },
                    { id: 'light' as const, Icon: Sun,  label: 'Светлая' },
                  ]).map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => setMode(id)}
                      className={cn(
                        'flex flex-1 flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium transition-all',
                        mode === id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <Icon size={16} weight="duotone" />
                      {label}
                    </button>
                  ))}
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* Accent presets */}
              <Section title="Акцент">
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {ACCENTS.map((a) => {
                    const color = `hsl(${a.h} ${a.s}% ${a.l}%)`
                    const isActive = accent === a.id && !customEnabled
                    return (
                      <button
                        key={a.id}
                        onClick={() => { setAccent(a.id); setCustomEnabled(false) }}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-all',
                          isActive
                            ? 'ring-2 ring-offset-1 ring-offset-card bg-muted/40 text-foreground'
                            : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                        )}
                        style={{ '--ring-color': color } as React.CSSProperties}
                      >
                        <span
                          className="relative flex h-5 w-5 items-center justify-center rounded-full"
                          style={{ background: color }}
                        >
                          {isActive && <Check size={11} weight="bold" className="text-white" />}
                        </span>
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* Custom color */}
              <Section title="Свой цвет" defaultOpen={false}>
                <div className="mt-2 space-y-3">
                  {/* Enable toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Кастом цвет</span>
                    <button
                      type="button"
                      onClick={() => setCustomEnabled(!customEnabled)}
                      className={cn(
                        'relative h-5 w-9 rounded-full transition-colors',
                        customEnabled ? 'bg-primary' : 'bg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                          customEnabled ? 'translate-x-4' : 'translate-x-0.5',
                        )}
                      />
                    </button>
                  </div>

                  {/* Sliders — only when custom enabled */}
                  <AnimatePresence initial={false}>
                    {customEnabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pt-1">
                          <HslSlider
                            label="H"
                            value={customPrimary.h}
                            min={0}
                            max={360}
                            onChange={(h) => setCustomPrimary({ ...customPrimary, h })}
                          />
                          <HslSlider
                            label="S"
                            value={customPrimary.s}
                            min={0}
                            max={100}
                            onChange={(s) => setCustomPrimary({ ...customPrimary, s })}
                          />
                          <HslSlider
                            label="L"
                            value={customPrimary.l}
                            min={10}
                            max={70}
                            onChange={(l) => setCustomPrimary({ ...customPrimary, l })}
                          />
                          {/* Live preview swatch */}
                          <div
                            className="mt-1 h-6 w-full rounded-lg border border-border/60"
                            style={{ background: `hsl(${customPrimary.h} ${customPrimary.s}% ${customPrimary.l}%)` }}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* Radius */}
              <Section title="Скруглення" defaultOpen={false}>
                <div className="mt-2 space-y-1">
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Острые</span>
                    <span>{radius.toFixed(1)} rem</span>
                    <span>Круглые</span>
                  </div>
                  {/* Preview boxes */}
                  <div className="flex gap-1.5 pt-1">
                    {[0, 0.5, 1, 1.5].map((r: number) => (
                      <button
                        key={r}
                        onClick={() => setRadius(r)}
                        className={cn(
                          'h-7 flex-1 border transition-colors',
                          Math.abs(radius - r) < 0.05
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-muted/40 hover:bg-muted',
                        )}
                        style={{ borderRadius: `${r}rem` }}
                      />
                    ))}
                  </div>
                </div>
              </Section>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
