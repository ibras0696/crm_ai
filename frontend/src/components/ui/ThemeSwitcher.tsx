import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun, Palette, CaretDown, Check, Plus, Trash } from '@phosphor-icons/react'
import { useTheme } from '@/contexts/ThemeContext'
import { appearanceApi } from '@/lib/api'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Accent definitions
// ---------------------------------------------------------------------------
const ACCENTS = [
  { id: 'teal',   label: 'Teal',   h: 174, s: 80, l: 39 },
  { id: 'amber',  label: 'Amber',  h: 37,  s: 90, l: 44 },
  { id: 'violet', label: 'Violet', h: 262, s: 83, l: 58 },
  { id: 'rose',   label: 'Rose',   h: 346, s: 77, l: 50 },
  { id: 'sky',    label: 'Sky',    h: 199, s: 89, l: 48 },
  { id: 'lime',   label: 'Lime',   h: 84,  s: 70, l: 38 },
] as const

// ---------------------------------------------------------------------------
// SVG icons per accent
// ---------------------------------------------------------------------------
function AccentIcon({ id, color }: { id: string; color: string }) {
  const size = 22
  switch (id) {
    case 'teal':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* water drop */}
          <path d="M11 4C11 4 6.5 9.5 6.5 13A4.5 4.5 0 0 0 15.5 13C15.5 9.5 11 4 11 4Z"
            fill="white" opacity="0.9" />
        </svg>
      )
    case 'amber':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* sun */}
          <circle cx="11" cy="11" r="3.5" fill="white" opacity="0.9" />
          {[0,45,90,135,180,225,270,315].map((deg) => {
            const r = (deg * Math.PI) / 180
            return (
              <line key={deg}
                x1={(11 + 5.5 * Math.cos(r)).toFixed(2)} y1={(11 + 5.5 * Math.sin(r)).toFixed(2)}
                x2={(11 + 7.2 * Math.cos(r)).toFixed(2)} y2={(11 + 7.2 * Math.sin(r)).toFixed(2)}
                stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
            )
          })}
        </svg>
      )
    case 'violet':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* gem / diamond */}
          <polygon points="11,4.5 16,9 11,18 6,9" fill="white" opacity="0.85" />
          <polygon points="11,4.5 16,9 11,10.5 6,9" fill="white" opacity="0.5" />
          <line x1="6" y1="9" x2="16" y2="9" stroke={color} strokeWidth="0.8" opacity="0.6" />
        </svg>
      )
    case 'rose':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* heart */}
          <path d="M11 16.5C11 16.5 4.5 12.2 4.5 8.5C4.5 6.5 6.2 5 8 5C9.3 5 10.4 5.7 11 6.7C11.6 5.7 12.7 5 14 5C15.8 5 17.5 6.5 17.5 8.5C17.5 12.2 11 16.5 11 16.5Z"
            fill="white" opacity="0.9" />
        </svg>
      )
    case 'sky':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* cloud */}
          <ellipse cx="11" cy="13" rx="5.5" ry="3.2" fill="white" opacity="0.9" />
          <circle cx="9" cy="11.5" r="2.5" fill="white" opacity="0.9" />
          <circle cx="13" cy="11" r="3" fill="white" opacity="0.9" />
        </svg>
      )
    case 'lime':
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="11" fill={color} />
          {/* leaf */}
          <path d="M11 5C11 5 17 8 17 13C17 16 14.5 17 11 17C7.5 17 5 16 5 13C5 8 11 5 11 5Z"
            fill="white" opacity="0.9" />
          <line x1="11" y1="17" x2="11" y2="9" stroke={color} strokeWidth="1" opacity="0.5" />
          <path d="M11 12 Q8 10 7 8" stroke={color} strokeWidth="0.8" fill="none" opacity="0.4" />
          <path d="M11 10 Q14 8 15 7" stroke={color} strokeWidth="0.8" fill="none" opacity="0.4" />
        </svg>
      )
    default:
      return (
        <span className="h-[22px] w-[22px] rounded-full" style={{ background: color }} />
      )
  }
}

// ---------------------------------------------------------------------------
// Saved preset type
// ---------------------------------------------------------------------------
interface StylePreset {
  name: string
  mode: 'dark' | 'light'
  accent: string
  customEnabled: boolean
  customPrimary: { h: number; s: number; l: number }
  radius: number
}

const PRESETS_KEY = 'theme-saved-presets'
const MAX_PRESETS = 4

function loadPresets(): (StylePreset | null)[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return [null, null, null, null]
    const arr = JSON.parse(raw) as (StylePreset | null)[]
    // ensure length 4
    while (arr.length < 4) arr.push(null)
    return arr.slice(0, 4)
  } catch {
    return [null, null, null, null]
  }
}

function savePresets(presets: (StylePreset | null)[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
}

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
        <CaretDown size={11} className={cn('transition-transform duration-200', open ? 'rotate-180' : '')} />
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
function HslSlider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
      />
      <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{Math.round(value)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Preset slot
// ---------------------------------------------------------------------------
function PresetSlot({
  preset,
  index,
  onApply,
  onSave,
  onDelete,
}: {
  preset: StylePreset | null
  index: number
  onApply: (p: StylePreset) => void
  onSave: (index: number) => void
  onDelete: (index: number) => void
}) {
  if (!preset) {
    return (
      <button
        type="button"
        onClick={() => onSave(index)}
        title="Сохранить текущий стиль"
        className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
      >
        <Plus size={16} />
        <span className="text-[9px]">Слот {index + 1}</span>
      </button>
    )
  }

  const accent = ACCENTS.find((a) => a.id === preset.accent)
  const previewColor = preset.customEnabled
    ? `hsl(${preset.customPrimary.h} ${preset.customPrimary.s}% ${preset.customPrimary.l}%)`
    : accent
      ? `hsl(${accent.h} ${accent.s}% ${accent.l}%)`
      : 'hsl(var(--primary))'

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onApply(preset)}
        title={`Применить: ${preset.name}`}
        className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors overflow-hidden"
      >
        {/* colour band */}
        <span
          className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl"
          style={{ background: previewColor }}
        />
        <span className="text-[10px] font-medium truncate max-w-full px-1 mt-1">{preset.name}</span>
        <span className="text-[9px] text-muted-foreground">
          {preset.mode === 'dark' ? '🌙' : '☀️'} {preset.accent}
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(index) }}
        className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-destructive group-hover:flex transition-colors"
      >
        <Trash size={10} />
      </button>
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
  const [presets, setPresets] = useState<(StylePreset | null)[]>(loadPresets)
  const [savingName, setSavingName] = useState<number | null>(null)
  const [nameInput, setNameInput] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Load from server on mount
  useEffect(() => {
    appearanceApi.get()
      .then((r) => { if (r.data.ok && r.data.data) syncFromServer(r.data.data) })
      .catch(() => {})
  }, [syncFromServer])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onOut = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSavingName(null)
      }
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [open])

  // Debounced save to server
  const save = useCallback(() => {
    appearanceApi.update({
      mode, accent, custom_enabled: customEnabled,
      primary_h: customPrimary.h, primary_s: customPrimary.s, primary_l: customPrimary.l,
      radius,
    }).catch(() => {})
  }, [mode, accent, customEnabled, customPrimary, radius])
  useDebouncedEffect(save, [mode, accent, customEnabled, customPrimary, radius], 800)

  const currentAccent = ACCENTS.find((a) => a.id === accent)
  const previewColor = customEnabled
    ? `hsl(${customPrimary.h} ${customPrimary.s}% ${customPrimary.l}%)`
    : currentAccent
      ? `hsl(${currentAccent.h} ${currentAccent.s}% ${currentAccent.l}%)`
      : 'hsl(var(--primary))'

  const handleSavePreset = (index: number) => {
    setSavingName(index)
    setNameInput(`Стиль ${index + 1}`)
  }

  const confirmSavePreset = (index: number) => {
    const preset: StylePreset = {
      name: nameInput.trim() || `Стиль ${index + 1}`,
      mode, accent, customEnabled, customPrimary, radius,
    }
    const next = [...presets]
    next[index] = preset
    setPresets(next)
    savePresets(next)
    setSavingName(null)
  }

  const applyPreset = (p: StylePreset) => {
    setMode(p.mode)
    setAccent(p.accent)
    setCustomEnabled(p.customEnabled)
    setCustomPrimary(p.customPrimary)
    setRadius(p.radius)
  }

  const deletePreset = (index: number) => {
    const next = [...presets]
    next[index] = null
    setPresets(next)
    savePresets(next)
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSavingName(null) }}
        aria-label="Настройки темы"
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          'text-muted-foreground hover:text-foreground hover:bg-muted/60',
          open && 'bg-muted/60 text-foreground',
        )}
      >
        <Palette size={18} weight="duotone" />
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
            className="absolute right-0 top-[calc(100%+6px)] z-[9999] w-64 rounded-2xl border border-border bg-card shadow-2xl"
          >
            <div className="space-y-3 p-3">

              {/* ── Mode ── */}
              <Section title="Режим">
                <div className="mt-1.5 flex gap-1.5">
                  {([
                    { id: 'dark' as const, Icon: Moon, label: 'Тёмная' },
                    { id: 'light' as const, Icon: Sun, label: 'Светлая' },
                  ]).map(({ id, Icon, label }) => (
                    <button key={id} onClick={() => setMode(id)}
                      className={cn(
                        'flex flex-1 flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium transition-all',
                        mode === id ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <Icon size={16} weight="duotone" />
                      {label}
                    </button>
                  ))}
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* ── Accents ── */}
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
                            ? 'bg-muted/60 ring-2 ring-offset-1 ring-offset-card text-foreground'
                            : 'bg-muted/40 text-muted-foreground hover:bg-muted',
                        )}
                        style={isActive ? { '--tw-ring-color': color } as React.CSSProperties : undefined}
                      >
                        <span className="relative flex items-center justify-center">
                          <AccentIcon id={a.id} color={color} />
                          {isActive && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Check size={12} weight="bold" className="text-white drop-shadow" />
                            </span>
                          )}
                        </span>
                        {a.label}
                      </button>
                    )
                  })}
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* ── Custom color ── */}
              <Section title="Свой цвет" defaultOpen={false}>
                <div className="mt-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Кастом цвет</span>
                    <button
                      type="button"
                      onClick={() => setCustomEnabled(!customEnabled)}
                      className={cn('relative h-5 w-9 rounded-full transition-colors', customEnabled ? 'bg-primary' : 'bg-muted')}
                    >
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', customEnabled ? 'translate-x-4' : 'translate-x-0.5')} />
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {customEnabled && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.16 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pt-1">
                          <HslSlider label="H" value={customPrimary.h} min={0} max={360}
                            onChange={(h) => setCustomPrimary({ ...customPrimary, h })} />
                          <HslSlider label="S" value={customPrimary.s} min={0} max={100}
                            onChange={(s) => setCustomPrimary({ ...customPrimary, s })} />
                          <HslSlider label="L" value={customPrimary.l} min={10} max={70}
                            onChange={(l) => setCustomPrimary({ ...customPrimary, l })} />
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

              {/* ── Radius ── */}
              <Section title="Скругление" defaultOpen={false}>
                <div className="mt-2 space-y-1">
                  <input
                    type="range" min={0} max={1.5} step={0.1} value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Острые</span>
                    <span>{radius.toFixed(1)} rem</span>
                    <span>Круглые</span>
                  </div>
                  <div className="flex gap-1.5 pt-1">
                    {([0, 0.5, 1, 1.5] as number[]).map((r) => (
                      <button key={r} onClick={() => setRadius(r)}
                        className={cn('h-7 flex-1 border transition-colors', Math.abs(radius - r) < 0.05 ? 'border-primary bg-primary/10' : 'border-border bg-muted/40 hover:bg-muted')}
                        style={{ borderRadius: `${r}rem` }}
                      />
                    ))}
                  </div>
                </div>
              </Section>

              <div className="h-px bg-border" />

              {/* ── Saved presets ── */}
              <Section title={`Стили (${presets.filter(Boolean).length}/${MAX_PRESETS})`} defaultOpen>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {presets.map((p, i) =>
                    savingName === i ? (
                      /* Name input */
                      <div key={i} className="col-span-2 flex gap-1.5">
                        <input
                          autoFocus
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmSavePreset(i)
                            if (e.key === 'Escape') setSavingName(null)
                          }}
                          placeholder="Название стиля"
                          className="flex-1 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={() => confirmSavePreset(i)}
                          className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setSavingName(null)}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <PresetSlot
                        key={i}
                        preset={p}
                        index={i}
                        onApply={applyPreset}
                        onSave={handleSavePreset}
                        onDelete={deletePreset}
                      />
                    )
                  )}
                </div>
              </Section>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
