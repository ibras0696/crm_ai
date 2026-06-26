import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence, useSpring, useMotionValue } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { persistLocale, type AppLocale } from '@/lib/i18n'
import {
  Table,
  Brain,
  BookOpen,
  CalendarBlank,
  FileText,
  ChartLineUp,
  ChatTeardropDots,
  ArrowRight,
  Lightning,
  Globe,
  ShieldCheck,
  Stack,
  PaperPlaneTilt,
  Hash,
  Check,
  Sun,
  Moon,
  List,
  X,
  CaretRight,
  Sparkle,
  At,
} from '@phosphor-icons/react'
import {
  Search, LineChart, Database, LayoutDashboard, MessageSquare,
  Layout, FileText as LucideFileText, BookOpen as LucideBookOpen,
  CheckCircle as LucideCheckCircle, Users as LucideUsers,
  Plus as LucidePlus,
} from 'lucide-react'
import { LANDING_CONTENT, type LandingContent, type LandingLocale } from './landingContent'

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPO_OUT: [number, number, number, number] = [0.32, 0.72, 0, 1]
const SPRING_HEAVY = { damping: 28, stiffness: 280 }

const BENTO_META = [
  { icon: Table,           color: 'text-blue-400',   bg: 'bg-blue-500/10',   glow: 'rgba(59,130,246,0.15)',  size: 'lg:col-span-7' },
  { icon: Brain,           color: 'text-pink-400',   bg: 'bg-pink-500/10',   glow: 'rgba(236,72,153,0.15)',  size: 'lg:col-span-5' },
  { icon: FileText,        color: 'text-amber-400',  bg: 'bg-amber-500/10',  glow: 'rgba(245,158,11,0.12)',  size: 'lg:col-span-4' },
  { icon: BookOpen,        color: 'text-purple-400', bg: 'bg-purple-500/10', glow: 'rgba(168,85,247,0.12)',  size: 'lg:col-span-4' },
  { icon: CalendarBlank,   color: 'text-emerald-400',bg: 'bg-emerald-500/10',glow: 'rgba(52,211,153,0.12)',  size: 'lg:col-span-4' },
  { icon: ChartLineUp,     color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   glow: 'rgba(34,211,238,0.12)',  size: 'lg:col-span-6' },
  { icon: ChatTeardropDots,color: 'text-indigo-400', bg: 'bg-indigo-500/10', glow: 'rgba(99,102,241,0.12)',  size: 'lg:col-span-6' },
]

const SHOWCASE_TABS: ReadonlyArray<{
  id: 'tables' | 'ai' | 'docs' | 'kb' | 'dash' | 'chat'
  icon: React.ComponentType<any>
}> = [
  { id: 'tables', icon: Layout },
  { id: 'ai',     icon: Brain   },
  { id: 'docs',   icon: LucideFileText },
  { id: 'kb',     icon: LucideBookOpen },
  { id: 'dash',   icon: LineChart },
  { id: 'chat',   icon: MessageSquare },
] as const

const TABLE_ROW_STATE_STYLE = [
  { color: 'text-blue-400',   bg: 'bg-blue-400/10' },
  { color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { color: 'text-emerald-400',bg: 'bg-emerald-400/10' },
  { color: 'text-amber-400',  bg: 'bg-amber-400/10' },
]

const ECOSYSTEM_ICON_META = [Database, LucideFileText, LayoutDashboard, MessageSquare] as const

const resolveLandingLocale = (lang: string | undefined): LandingLocale =>
  lang === 'en' ? 'en' : 'ru'

// ─── Landing Theme Switcher ───────────────────────────────────────────────────

const ACCENT_OPTIONS = [
  { id: 'teal',   color: 'hsl(174 80% 39%)' },
  { id: 'amber',  color: 'hsl(37 90% 44%)'  },
  { id: 'violet', color: 'hsl(262 83% 58%)' },
  { id: 'rose',   color: 'hsl(346 77% 50%)' },
  { id: 'sky',    color: 'hsl(199 89% 48%)' },
  { id: 'lime',   color: 'hsl(84 70% 38%)'  },
] as const

const LandingThemeSwitcher = () => {
  const { mode, accent, setMode, setAccent } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const currentColor = ACCENT_OPTIONS.find(a => a.id === accent)?.color ?? 'hsl(174 80% 39%)'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-9 w-9 rounded-xl border border-border/50 bg-secondary/30 flex items-center justify-center hover:bg-secondary transition-colors"
        aria-label="Сменить тему"
      >
        <div
          className="w-[14px] h-[14px] rounded-full ring-2 ring-border/60 transition-colors"
          style={{ background: currentColor }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-[calc(100%+8px)] z-[9999] w-52 rounded-2xl border border-white/10 dark:border-white/5 bg-background/90 backdrop-blur-2xl shadow-2xl p-3 space-y-3"
          >
            {/* Mode */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">Режим</p>
              <div className="flex gap-1.5">
                {([
                  { id: 'dark' as const,  Icon: Moon, label: 'Тёмная'  },
                  { id: 'light' as const, Icon: Sun,  label: 'Светлая' },
                ] as const).map(({ id, Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl py-2 text-[10px] font-semibold transition-all ${
                      mode === id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/70'
                    }`}
                  >
                    <Icon size={14} weight="duotone" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-border/50" />

            {/* Accent */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5">Акцент</p>
              <div className="grid grid-cols-6 gap-1.5">
                {ACCENT_OPTIONS.map(({ id, color }) => (
                  <button
                    key={id}
                    onClick={() => setAccent(id)}
                    className="relative h-7 rounded-lg transition-all duration-150 hover:scale-110 active:scale-95"
                    style={{ background: color }}
                  >
                    {accent === id && (
                      <Check
                        size={11}
                        weight="bold"
                        className="absolute inset-0 m-auto text-white"
                        style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Motion Variants ──────────────────────────────────────────────────────────

const stagger: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)', transition: { duration: 0.7, ease: EXPO_OUT } },
}

// ─── Grain overlay ────────────────────────────────────────────────────────────

const GrainOverlay = () => (
  <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden opacity-[0.028] dark:opacity-[0.042]">
    <div
      className="absolute animate-grain"
      style={{
        inset: '-50%',
        width: '200%',
        height: '200%',
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        backgroundSize: '256px 256px',
      }}
    />
  </div>
)

// ─── Premium Cursor ───────────────────────────────────────────────────────────

const PremiumCursor = () => {
  const mouseX = useMotionValue(-200)
  const mouseY = useMotionValue(-200)

  useEffect(() => {
    const move = (e: MouseEvent) => { mouseX.set(e.clientX); mouseY.set(e.clientY) }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [mouseX, mouseY])

  const dotX  = useSpring(mouseX, { damping: 50, stiffness: 800 })
  const dotY  = useSpring(mouseY, { damping: 50, stiffness: 800 })
  const ringX = useSpring(mouseX, { damping: 22, stiffness: 160 })
  const ringY = useSpring(mouseY, { damping: 22, stiffness: 160 })
  const auraX = useSpring(mouseX, { damping: 36, stiffness: 90 })
  const auraY = useSpring(mouseY, { damping: 36, stiffness: 90 })

  return (
    <div className="hidden md:block pointer-events-none select-none">
      {/* Soft ambient aura */}
      <motion.div
        className="fixed top-0 left-0 w-28 h-28 rounded-full z-[9988]"
        style={{
          x: auraX, y: auraY,
          translateX: '-50%', translateY: '-50%',
          background: 'radial-gradient(circle, hsl(var(--primary)/0.12) 0%, transparent 70%)',
        }}
      />
      {/* Outer ring — spring lag */}
      <motion.div
        className="fixed top-0 left-0 w-10 h-10 rounded-full z-[9996]"
        style={{
          x: ringX, y: ringY,
          translateX: '-50%', translateY: '-50%',
          border: '1px solid hsl(var(--primary)/0.55)',
          boxShadow: '0 0 14px hsl(var(--primary)/0.18), inset 0 0 6px hsl(var(--primary)/0.06)',
        }}
      />
      {/* Inner dot — snappy */}
      <motion.div
        className="fixed top-0 left-0 w-[5px] h-[5px] rounded-full z-[9999]"
        style={{
          x: dotX, y: dotY,
          translateX: '-50%', translateY: '-50%',
          background: 'hsl(var(--primary))',
          boxShadow: '0 0 8px hsl(var(--primary)/0.7)',
        }}
      />
    </div>
  )
}

// ─── Logo ─────────────────────────────────────────────────────────────────────

const Logo = () => (
  <div className="logo-group flex items-center gap-3 group cursor-pointer">
    <div className="logo-icon-wrap relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary transition-all duration-500 group-hover:scale-105 group-hover:bg-primary group-hover:text-white">
      <Stack className="h-4.5 w-4.5" weight="duotone" />
    </div>
    <div className="flex flex-col justify-center">
      <span className="text-xl font-black tracking-[-0.03em] text-foreground leading-none">
        CRM<span className="text-primary italic ml-0.5">AI</span>
      </span>
      <span className="text-[8px] font-semibold uppercase tracking-[0.3em] text-muted-foreground mt-0.5">Intelligence OS</span>
    </div>
  </div>
)

// ─── Showcase ─────────────────────────────────────────────────────────────────

const Showcase = ({ content }: { content: LandingContent }) => {
  const [activeTab, setActiveTab] = useState('tables')
  const tabs = SHOWCASE_TABS.map((tab) => ({
    ...tab,
    label: content.showcase.tabs[tab.id],
  }))

  return (
    <section id="demo" className="py-16 md:py-28 px-4 relative">
      <div className="container mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EXPO_OUT }}
          viewport={{ once: true }}
          className="text-center mb-8 md:mb-14"
        >
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-[-0.04em] leading-[0.9] mb-4">
            {content.showcase.title}
          </h2>

          {/* Desktop tabs */}
          <div className="hidden md:flex flex-wrap justify-center gap-2 p-1.5 rounded-2xl bg-secondary/30 backdrop-blur-xl border border-border/40 max-w-fit mx-auto mt-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all relative ${activeTab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-background shadow-lg rounded-xl"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <tab.icon className="h-4 w-4 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Mobile: 3×2 selector + card */}
        <div className="md:hidden space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-2xl border text-center transition-all active:scale-95 ${
                  activeTab === tab.id
                    ? 'bg-primary/10 border-primary/40'
                    : 'bg-secondary/30 border-border/30 hover:bg-secondary/50'
                }`}
              >
                <tab.icon className={`h-5 w-5 ${activeTab === tab.id ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-[10px] font-bold leading-tight ${activeTab === tab.id ? 'text-primary' : 'text-muted-foreground'}`}>
                  {tab.label}
                </span>
                {activeTab === tab.id && (
                  <motion.div layoutId="activeMobileTab" className="absolute inset-0 rounded-2xl ring-2 ring-primary/30" transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }} />
                )}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-lg"
            >
              {activeTab === 'tables' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Layout className="h-5 w-5 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-black text-xs leading-tight line-clamp-2">{content.showcase.tables.title}</h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{content.showcase.tables.headers[0]} · {content.showcase.tables.headers[1]}</p>
                    </div>
                    <Button size="sm" className="gradient-primary text-white rounded-lg px-3 text-xs h-7 shrink-0 ml-auto">
                      <LucidePlus className="h-3 w-3 mr-1" />{content.showcase.tables.addDeal}
                    </Button>
                  </div>
                  <div className="rounded-xl border border-border/40 overflow-hidden">
                    {content.showcase.tables.rows.slice(0, 3).map((row, i) => {
                      const style = TABLE_ROW_STATE_STYLE[i % TABLE_ROW_STATE_STYLE.length] ?? TABLE_ROW_STATE_STYLE[0]!
                      return (
                        <div key={i} className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 last:border-0">
                          <span className="text-sm font-semibold flex-1 min-w-0 truncate">{row.project}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-md shrink-0 ${style.bg} ${style.color}`}>{row.status}</span>
                          <span className="text-xs font-mono text-muted-foreground shrink-0 ml-1">{row.value}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'ai' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl gradient-primary flex items-center justify-center shrink-0">
                      <Brain className="h-5 w-5 text-white" weight="duotone" />
                    </div>
                    <div>
                      <h3 className="font-black text-sm leading-tight">{content.showcase.ai.title}</h3>
                      <p className="text-[10px] text-muted-foreground italic mt-0.5">{content.showcase.ai.subtitle}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex gap-2.5 items-start">
                      <div className="h-6 w-6 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <LucideUsers className="h-3 w-3 text-primary" />
                      </div>
                      <div className="bg-secondary/40 px-3 py-2 rounded-xl rounded-tl-none text-xs flex-1">{content.showcase.ai.question}</div>
                    </div>
                    <div className="flex gap-2.5 items-start justify-end">
                      <div className="bg-primary/10 border border-primary/20 px-3 py-2 rounded-xl rounded-tr-none text-xs flex-1 text-right">{content.showcase.ai.answer}</div>
                      <div className="h-6 w-6 rounded-lg gradient-primary flex items-center justify-center shrink-0 mt-0.5">
                        <Brain className="h-3 w-3 text-white" weight="duotone" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 items-center rounded-xl border border-border/40 bg-secondary/20 px-3 py-2">
                    <span className="text-xs text-muted-foreground flex-1">{content.showcase.ai.inputPlaceholder}</span>
                    <div className="h-6 w-6 rounded-lg gradient-primary flex items-center justify-center shrink-0">
                      <PaperPlaneTilt className="h-3 w-3 text-white" weight="fill" />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'docs' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                      <LucideFileText className="h-5 w-5 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-black text-sm leading-tight">{content.showcase.docs.title}</h3>
                    </div>
                    <Button size="sm" className="gradient-primary text-white rounded-lg px-3 text-xs h-7 shrink-0">{content.showcase.docs.save}</Button>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background p-3 space-y-2">
                    <div className="font-black text-[10px] uppercase tracking-widest text-center border-b border-border/30 pb-2">{content.showcase.docs.documentTitle}</div>
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">{content.showcase.docs.documentBody}</p>
                    <div className="border-2 border-dashed border-border/50 rounded-lg py-3 flex flex-col items-center text-muted-foreground/60">
                      <LucidePlus className="h-4 w-4 mb-1" />
                      <span className="text-[9px] font-black uppercase tracking-widest">{content.showcase.docs.dropTitle}</span>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'kb' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                      <LucideBookOpen className="h-5 w-5 text-purple-400" />
                    </div>
                    <div>
                      <h3 className="font-black text-sm leading-tight">{content.showcase.knowledge.title}</h3>
                      <div className="flex gap-1 mt-1">
                        <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-black uppercase">{content.showcase.knowledge.badgePrimary}</span>
                        <span className="text-[9px] bg-secondary px-1.5 py-0.5 rounded font-black uppercase opacity-50">{content.showcase.knowledge.badgeSecondary}</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{content.showcase.knowledge.lead}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-blue-500/10 rounded-xl p-3">
                      <h5 className="font-black text-xs mb-1">{content.showcase.knowledge.stageOneTitle}</h5>
                      <p className="text-[10px] opacity-70 leading-relaxed">{content.showcase.knowledge.stageOneText}</p>
                    </div>
                    <div className="bg-purple-500/10 rounded-xl p-3">
                      <h5 className="font-black text-xs mb-1">{content.showcase.knowledge.stageTwoTitle}</h5>
                      <p className="text-[10px] opacity-70 leading-relaxed">{content.showcase.knowledge.stageTwoText}</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'dash' && (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-cyan-500/10 flex items-center justify-center shrink-0">
                      <LineChart className="h-5 w-5 text-cyan-400" />
                    </div>
                    <h3 className="font-black text-sm leading-tight">{content.showcase.analytics.title}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {content.showcase.analytics.stats.map((stat, i) => (
                      <div key={i} className="bg-secondary/30 rounded-xl p-3">
                        <div className="text-[9px] font-black uppercase tracking-wider opacity-50 mb-1 leading-tight line-clamp-2">{stat.label}</div>
                        <div className="text-base font-black">{stat.value}</div>
                        <div className={`text-[10px] font-bold mt-0.5 ${i===0?'text-emerald-500':i===1?'text-blue-500':i===2?'text-amber-500':'text-pink-500'}`}>
                          {stat.delta} {content.showcase.analytics.deltaSuffix}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end gap-1 h-20 px-1">
                    {[30, 80, 45, 95, 60, 40, 85, 70, 50, 90].map((h, i) => (
                      <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i * 0.04, ease: EXPO_OUT }}
                        className="flex-1 bg-gradient-to-t from-primary/80 to-primary/20 rounded-t-md" />
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'chat' && (
                <div className="p-4 space-y-3">
                  {/* Mobile chat preview */}
                  <div className="flex items-center gap-3 pb-2 border-b border-border/40">
                    <div className="h-9 w-9 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                      <ChatTeardropDots className="h-5 w-5 text-indigo-400" weight="duotone" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-black text-sm leading-tight">{content.showcase.chat.title}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[10px] text-emerald-500 font-semibold">{content.showcase.chat.releaseBadge}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {content.showcase.chat.messages.map((msg, i) => (
                      <div key={i} className={`flex gap-2 items-start ${msg.self ? 'flex-row-reverse' : ''}`}>
                        <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${msg.gradient} flex items-center justify-center shrink-0 text-[8px] font-black text-white`}>
                          {msg.initials}
                        </div>
                        <div className={`px-3 py-2 rounded-xl text-xs max-w-[75%] leading-relaxed ${msg.self ? 'bg-primary/15 text-foreground rounded-tr-none' : 'bg-secondary/50 rounded-tl-none'}`}>
                          {msg.text}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/20 px-3 py-2">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" weight="bold" />
                    <span className="text-xs text-muted-foreground flex-1">{content.showcase.chat.inputPlaceholder}</span>
                    <PaperPlaneTilt className="h-4 w-4 text-primary shrink-0" weight="fill" />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Desktop mock browser — double-bezel */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EXPO_OUT }}
          viewport={{ once: true }}
          className="hidden md:block"
        >
          {/* Outer shell */}
          <div className="rounded-[2.5rem] border border-white/8 dark:border-white/5 bg-white/[0.02] p-1.5 shadow-[0_60px_120px_-30px_rgba(0,0,0,0.5)] backdrop-blur-sm">
            {/* Inner core */}
            <div className="rounded-[calc(2.5rem-0.375rem)] border border-white/5 bg-background overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] min-h-[680px] flex flex-col">
              {/* Mock App Header */}
              <div className="h-14 px-6 flex items-center justify-between border-b border-border/50 bg-secondary/10">
                <div className="flex items-center gap-4">
                  <div className="flex gap-1.5">
                    <div className="h-3 w-3 rounded-full bg-red-500/40" />
                    <div className="h-3 w-3 rounded-full bg-amber-500/40" />
                    <div className="h-3 w-3 rounded-full bg-emerald-500/40" />
                  </div>
                  <div className="h-6 w-px bg-border/50" />
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-background/50 border border-border/30">
                    <Search className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground font-medium">{content.showcase.searchPlaceholder}</span>
                  </div>
                </div>
                <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 shadow-lg" />
              </div>

              <div className="flex-1 flex overflow-hidden">
                {/* Mock Sidebar */}
                <div className="w-60 border-r border-border/50 p-4 space-y-8 bg-secondary/5">
                  <div className="space-y-1">
                    {tabs.map((t) => (
                      <div key={t.id} className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${t.id === activeTab ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
                        <t.icon className="h-5 w-5" />
                        <span className="text-sm font-semibold">{t.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 relative overflow-auto bg-gradient-to-br from-background to-secondary/10 p-8">
                  <AnimatePresence mode="wait">
                    {activeTab === 'tables' && (
                      <motion.div key="tables" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: EXPO_OUT }} className="space-y-8 h-full">
                        <div className="flex items-center justify-between">
                          <h3 className="text-3xl font-black tracking-[-0.03em]">{content.showcase.tables.title}</h3>
                          <Button size="sm" className="gradient-primary text-white font-bold rounded-xl px-5">
                            <LucidePlus className="h-4 w-4 mr-2" /> {content.showcase.tables.addDeal}
                          </Button>
                        </div>
                        <div className="rounded-2xl border border-border/50 bg-background/50 overflow-hidden shadow-xl">
                          <div className="grid grid-cols-5 p-5 border-b border-border/50 bg-secondary/20 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            {content.showcase.tables.headers.map((h) => <span key={h}>{h}</span>)}
                          </div>
                          {content.showcase.tables.rows.map((row, i) => {
                            const style = TABLE_ROW_STATE_STYLE[i % TABLE_ROW_STATE_STYLE.length] ?? TABLE_ROW_STATE_STYLE[0]!
                            return (
                              <div key={i} className="grid grid-cols-5 p-5 border-b border-border/50 last:border-0 hover:bg-secondary/10 transition-colors cursor-pointer">
                                <span className="text-sm font-semibold">{row.project}</span>
                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-lg w-fit h-fit ${style.bg} ${style.color}`}>{row.status}</span>
                                <span className="text-sm font-mono font-medium">{row.value}</span>
                                <span className="text-xs font-semibold">{row.priority}</span>
                                <div className="flex items-center gap-2">
                                  <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary/40 to-purple-500/40 shrink-0" />
                                  <span className="text-xs text-muted-foreground">{content.showcase.tables.managerLabel} {i + 1}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'ai' && (
                      <motion.div key="ai" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.3, ease: EXPO_OUT }} className="flex flex-col h-full gap-8">
                        <div className="flex items-center gap-4">
                          <div className="h-12 w-12 rounded-2xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/20">
                            <Brain className="text-white h-7 w-7" weight="duotone" />
                          </div>
                          <div>
                            <h3 className="text-3xl font-black tracking-[-0.03em]">{content.showcase.ai.title}</h3>
                            <p className="text-muted-foreground font-medium italic">{content.showcase.ai.subtitle}</p>
                          </div>
                        </div>
                        <div className="grid md:grid-cols-3 gap-6 flex-1">
                          <div className="md:col-span-2 glass-card p-6 space-y-6 relative flex flex-col rounded-2xl">
                            <div className="space-y-4 flex-1">
                              <div className="flex gap-4">
                                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center"><LucideUsers className="h-4 w-4 text-primary" /></div>
                                <div className="bg-secondary/20 p-4 rounded-2xl rounded-tl-none text-sm font-medium max-w-[80%]">{content.showcase.ai.question}</div>
                              </div>
                              <div className="flex gap-4 justify-end">
                                <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl rounded-tr-none text-sm font-medium max-w-[80%] space-y-2">
                                  <p>{content.showcase.ai.answer}</p>
                                  <div className="h-20 w-full bg-primary/5 rounded-xl flex items-end gap-1 p-2">
                                    {[40, 60, 45, 90, 70, 85].map((h, i) => (
                                      <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: i * 0.07, ease: EXPO_OUT }} className="flex-1 bg-primary/50 rounded-t" />
                                    ))}
                                  </div>
                                </div>
                                <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center"><Brain className="h-4 w-4 text-white" weight="duotone" /></div>
                              </div>
                            </div>
                            <div className="flex gap-3 p-2 glass rounded-xl border-primary/20">
                              <input type="text" placeholder={content.showcase.ai.inputPlaceholder} className="flex-1 bg-transparent border-0 outline-none px-4 text-sm font-medium" />
                              <Button size="icon" className="gradient-primary rounded-lg text-white"><PaperPlaneTilt className="h-4 w-4" weight="fill" /></Button>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <div className="glass-card border-emerald-500/20 p-6 space-y-3 rounded-2xl">
                              <div className="flex items-center gap-2 text-emerald-500 font-black text-xs uppercase"><Lightning className="h-4 w-4" weight="fill" /> {content.showcase.ai.insightTitle}</div>
                              <p className="text-sm font-medium">{content.showcase.ai.insightText}</p>
                            </div>
                            <div className="glass-card p-6 space-y-3 rounded-2xl">
                              <div className="text-xs font-black uppercase text-muted-foreground">{content.showcase.ai.recentTasks}</div>
                              <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                  <div key={i} className="flex items-center gap-2">
                                    <LucideCheckCircle className="h-3 w-3 text-primary" />
                                    <div className="h-1.5 w-full bg-secondary/50 rounded-full" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'docs' && (
                      <motion.div key="docs" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.3, ease: EXPO_OUT }} className="flex flex-col h-full gap-8">
                        <div className="flex items-center justify-between">
                          <h3 className="text-3xl font-black tracking-[-0.03em]">{content.showcase.docs.title}</h3>
                          <div className="flex gap-2">
                            <Button variant="outline" className="font-semibold">{content.showcase.docs.pdfExport}</Button>
                            <Button className="gradient-primary text-white font-semibold">{content.showcase.docs.save}</Button>
                          </div>
                        </div>
                        <div className="flex-1 glass-card border-none bg-white/5 p-8 relative overflow-hidden rounded-2xl">
                          <div className="max-w-2xl mx-auto rounded-sm border border-slate-200 bg-white p-10 text-slate-900 shadow-[0_0_40px_rgba(15,23,42,0.15)] space-y-6 min-h-full dark:border-white/5 dark:bg-zinc-950 dark:text-slate-200">
                            <div className="border-b-2 border-slate-300 pb-4 dark:border-slate-700">
                              <h1 className="text-2xl font-serif font-black uppercase text-center">{content.showcase.docs.documentTitle}</h1>
                            </div>
                            <p className="text-sm leading-relaxed font-serif">{content.showcase.docs.documentBody}</p>
                            <div className="h-32 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center flex-col text-slate-500 dark:border-slate-700">
                              <LucidePlus className="h-8 w-8 mb-2" />
                              <span className="text-[10px] font-black uppercase tracking-widest">{content.showcase.docs.dropTitle}</span>
                            </div>
                          </div>
                          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-4 rounded-full border border-border bg-white/85 p-2 px-6 backdrop-blur dark:border-white/10 dark:bg-black/80">
                            <div className="h-4 w-20 rounded bg-slate-300/80 dark:bg-white/20" />
                            <div className="h-4 w-4 rounded bg-slate-300/80 dark:bg-white/20" />
                            <div className="h-4 w-px bg-slate-300/80 dark:bg-white/10" />
                            <div className="flex gap-2">
                              <div className="h-4 w-4 bg-primary rounded-full cursor-pointer hover:scale-110 transition-transform" />
                              <div className="h-4 w-4 bg-purple-500 rounded-full cursor-pointer hover:scale-110 transition-transform" />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'kb' && (
                      <motion.div key="kb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="flex h-full gap-8">
                        <div className="w-56 glass-card p-6 space-y-6 rounded-2xl">
                          <div className="space-y-3">
                            <h4 className="text-[10px] font-black uppercase tracking-widest opacity-50">{content.showcase.knowledge.navTitle}</h4>
                            <div className="space-y-1">
                              {content.showcase.knowledge.navItems.map((navItem, i) => (
                                <div key={i} className={`flex items-center gap-2 text-sm font-semibold px-2 py-1.5 rounded-lg ${i === 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}>
                                  <CaretRight className={`h-3.5 w-3.5 ${i === 0 ? 'rotate-90' : ''}`} weight="bold" />
                                  {navItem}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 space-y-6">
                          <div className="space-y-3">
                            <h3 className="text-4xl font-black tracking-[-0.03em]">{content.showcase.knowledge.title}</h3>
                            <div className="flex gap-2">
                              <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-black uppercase">{content.showcase.knowledge.badgePrimary}</span>
                              <span className="text-[10px] bg-secondary px-2 py-1 rounded font-black uppercase opacity-50">{content.showcase.knowledge.badgeSecondary}</span>
                            </div>
                          </div>
                          <p className="text-lg font-medium text-muted-foreground">{content.showcase.knowledge.lead}</p>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="glass-card border-none bg-blue-500/10 p-6 rounded-2xl">
                              <h5 className="font-black mb-2">{content.showcase.knowledge.stageOneTitle}</h5>
                              <p className="text-xs opacity-70">{content.showcase.knowledge.stageOneText}</p>
                            </div>
                            <div className="glass-card border-none bg-purple-500/10 p-6 rounded-2xl">
                              <h5 className="font-black mb-2">{content.showcase.knowledge.stageTwoTitle}</h5>
                              <p className="text-xs opacity-70">{content.showcase.knowledge.stageTwoText}</p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'dash' && (
                      <motion.div key="dash" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: EXPO_OUT }} className="space-y-8 h-full">
                        <div className="flex items-center justify-between">
                          <h3 className="text-3xl font-black tracking-[-0.03em]">{content.showcase.analytics.title}</h3>
                          <select className="bg-secondary/50 border border-border/50 rounded-xl px-4 py-2 text-sm font-semibold outline-none">
                            <option>{content.showcase.analytics.periodCurrentMonth}</option>
                            <option>{content.showcase.analytics.periodQuarter}</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-4 gap-4">
                          {content.showcase.analytics.stats.map((stat, i) => (
                            <div key={i} className="glass-card rounded-2xl p-6 space-y-1">
                              <div className="text-[10px] font-black uppercase tracking-widest opacity-50">{stat.label}</div>
                              <div className="text-2xl font-black tracking-[-0.02em]">{stat.value}</div>
                              <div className={`text-[10px] font-bold ${i === 0 ? 'text-emerald-500' : i === 1 ? 'text-blue-500' : i === 2 ? 'text-amber-500' : 'text-pink-500'}`}>
                                {stat.delta} {content.showcase.analytics.deltaSuffix}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="grid md:grid-cols-2 gap-6 h-[280px]">
                          <div className="glass-card p-6 flex flex-col rounded-2xl">
                            <h4 className="font-black text-xs uppercase tracking-widest opacity-50 mb-6">{content.showcase.analytics.teamActivity}</h4>
                            <div className="flex-1 flex items-end gap-2 pb-4">
                              {[30, 80, 45, 95, 60, 40, 85, 70, 50, 90].map((h, i) => (
                                <motion.div key={i} initial={{ height: 0 }} whileInView={{ height: `${h}%` }} transition={{ delay: i * 0.04, ease: EXPO_OUT }}
                                  className="flex-1 bg-gradient-to-t from-primary/80 to-primary/20 rounded-t-lg" />
                              ))}
                            </div>
                            <div className="flex justify-between text-[9px] font-bold opacity-40 uppercase tracking-tight">
                              {content.showcase.analytics.weekdays.map((d) => <span key={d}>{d}</span>)}
                            </div>
                          </div>
                          <div className="glass-card p-6 flex flex-col rounded-2xl">
                            <h4 className="font-black text-xs uppercase tracking-widest opacity-50 mb-6">{content.showcase.analytics.leadDistribution}</h4>
                            <div className="flex-1 flex items-center justify-center relative">
                              <div className="h-36 w-36 rounded-full border-8 border-secondary border-t-primary border-r-purple-500 border-b-emerald-500 animate-slow-spin shadow-2xl" />
                              <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-3xl font-black">100%</span>
                                <span className="text-[8px] font-bold opacity-50 uppercase">{content.showcase.analytics.reach}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {activeTab === 'chat' && (
                      <motion.div key="chat" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EXPO_OUT }} className="flex h-full gap-0 rounded-2xl overflow-hidden border border-border/50 bg-background/50">
                        {/* Channel sidebar */}
                        <div className="w-52 border-r border-border/40 flex flex-col bg-secondary/5">
                          <div className="px-4 py-3 border-b border-border/40">
                            <div className="text-xs font-black uppercase tracking-widest opacity-50">Каналы</div>
                          </div>
                          <div className="p-2 space-y-0.5 flex-1">
                            {content.showcase.chat.channels.map((ch, i) => (
                              <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${ch === content.showcase.chat.activeChannel ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}>
                                <Hash className="h-3.5 w-3.5 shrink-0" weight="bold" />
                                {ch}
                              </div>
                            ))}
                            <div className="px-3 pt-4 pb-1 text-[10px] font-black uppercase tracking-widest opacity-40">Личные</div>
                            {['Анна К.', 'Дмитрий Р.', 'Сара М.'].map((name, i) => (
                              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                                <div className={`h-4 w-4 rounded-full bg-gradient-to-br shrink-0 ${i === 0 ? 'from-violet-500 to-purple-600' : i === 1 ? 'from-blue-500 to-cyan-500' : 'from-emerald-500 to-teal-600'}`} />
                                {name}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Main chat area */}
                        <div className="flex-1 flex flex-col">
                          <div className="px-6 py-3 border-b border-border/40 flex items-center gap-2.5">
                            <Hash className="h-4 w-4 text-muted-foreground" weight="bold" />
                            <span className="font-bold text-sm">{content.showcase.chat.activeChannel}</span>
                            <span className="text-xs text-muted-foreground ml-1">{content.showcase.chat.membersCount}</span>
                            <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-emerald-500">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              {content.showcase.chat.releaseBadge}
                            </div>
                          </div>

                          <div className="flex-1 p-6 space-y-5 overflow-hidden">
                            {content.showcase.chat.messages.map((msg, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.12, ease: EXPO_OUT }}
                                className={`flex gap-3 items-start ${msg.self ? 'flex-row-reverse' : ''}`}
                              >
                                <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${msg.gradient} flex items-center justify-center shrink-0 text-[9px] font-black text-white shadow-lg`}>
                                  {msg.initials}
                                </div>
                                <div className={`max-w-[65%] space-y-1 ${msg.self ? 'items-end flex flex-col' : ''}`}>
                                  <div className={`flex items-center gap-2 ${msg.self ? 'flex-row-reverse' : ''}`}>
                                    <span className="text-xs font-black">{msg.initials === 'Вы' || msg.initials === 'Me' ? (msg.initials === 'Me' ? 'You' : 'Вы') : msg.initials}</span>
                                    <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                                  </div>
                                  <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.self ? 'bg-primary/15 border border-primary/20 rounded-tr-md' : 'bg-secondary/40 rounded-tl-md'}`}>
                                    {msg.text}
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>

                          <div className="px-4 pb-4">
                            <div className="flex items-center gap-3 rounded-xl bg-secondary/30 border border-border/40 px-4 py-2.5">
                              <span className="text-sm text-muted-foreground flex-1">{content.showcase.chat.inputPlaceholder}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <At className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer transition-colors" weight="bold" />
                                <PaperPlaneTilt className="h-4 w-4 text-primary cursor-pointer" weight="fill" />
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const { i18n } = useTranslation()
  const { scrollY } = useScroll()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const locale = resolveLandingLocale(i18n.resolvedLanguage)
  const content = LANDING_CONTENT[locale]

  const setLocale = (next: AppLocale) => {
    void i18n.changeLanguage(next)
    persistLocale(next)
  }

  const opacityHero = useTransform(scrollY, [0, 600], [1, 0])
  const yHero       = useTransform(scrollY, [0, 600], [0, 120])
  const scaleHero   = useTransform(scrollY, [0, 600], [1, 0.88])

  return (
    <div className="min-h-[100dvh] bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 gradient-mesh opacity-70 dark:opacity-50" />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[55%] h-[55%] bg-primary/8 rounded-full blur-[180px] animate-pulse-glow" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[55%] h-[55%] bg-primary/5 rounded-full blur-[180px] animate-pulse-glow" style={{ animationDelay: '3s' }} />
        <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] bg-primary/4 rounded-full blur-[120px] animate-pulse-glow" style={{ animationDelay: '1.5s' }} />
      </div>

      <GrainOverlay />
      <PremiumCursor />

      {/* ── Floating Pill Navbar ──────────────────────────────────── */}
      <header className="fixed top-0 z-[100] w-full px-4 pt-4 md:pt-5">
        <div className="mx-auto max-w-6xl">
          <div className="glass rounded-2xl border border-white/8 dark:border-white/5 shadow-[0_8px_32px_rgba(0,0,0,0.2)] backdrop-blur-xl bg-background/75 flex items-center justify-between px-4 py-3 md:px-6">
            <Link to="/"><Logo /></Link>

            <nav className="hidden lg:flex items-center gap-7 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {content.header.nav.map((navItem) => (
                <a key={navItem.href} href={navItem.href} className="hover:text-primary transition-colors duration-200">
                  {navItem.label}
                </a>
              ))}
            </nav>

            <div className="hidden sm:flex items-center gap-2.5">
              {/* Lang toggle */}
              <div className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-secondary/30 p-1">
                <button onClick={() => setLocale('ru')} className={`h-7 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${locale === 'ru' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>RU</button>
                <button onClick={() => setLocale('en')} className={`h-7 px-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${locale === 'en' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>EN</button>
              </div>

              {/* Theme */}
              <LandingThemeSwitcher />

              <Link to="/login">
                <button className="h-9 px-5 rounded-xl text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                  {content.header.login}
                </button>
              </Link>
              <Link to="/register">
                <button className="h-9 px-5 rounded-xl bg-foreground text-background text-[11px] font-black uppercase tracking-wider hover:bg-foreground/90 active:scale-[0.98] transition-all shadow-lg shadow-foreground/10">
                  {content.header.start}
                </button>
              </Link>
            </div>

            {/* Mobile */}
            <div className="flex sm:hidden items-center gap-2">
              <LandingThemeSwitcher />
              <button onClick={() => setMobileNavOpen(true)} className="h-9 w-9 rounded-xl border border-border/50 flex items-center justify-center">
                <List className="h-4 w-4" weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Nav Drawer */}
      <AnimatePresence>
        {mobileNavOpen && (
          <motion.div className="fixed inset-0 z-[150] sm:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
            <motion.aside
              className="absolute top-0 right-0 h-full w-72 glass border-l border-border/50 flex flex-col"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', ...SPRING_HEAVY }}
            >
              <div className="flex items-center justify-between p-5 border-b border-border/50">
                <Logo />
                <button onClick={() => setMobileNavOpen(false)} className="h-8 w-8 rounded-xl flex items-center justify-center hover:bg-secondary">
                  <X className="h-4 w-4" weight="bold" />
                </button>
              </div>
              <nav className="flex-1 p-5 space-y-1 overflow-y-auto">
                {content.header.nav.map((navItem) => (
                  <a key={navItem.href} href={navItem.href} onClick={() => setMobileNavOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground hover:text-primary hover:bg-secondary/50 transition-all">
                    {navItem.label}
                  </a>
                ))}
              </nav>
              <div className="p-5 space-y-3 border-t border-border/50">
                <div className="flex items-center gap-1 rounded-xl border border-border bg-secondary/20 p-1">
                  <button onClick={() => setLocale('ru')} className={`flex-1 h-8 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${locale === 'ru' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>RU</button>
                  <button onClick={() => setLocale('en')} className={`flex-1 h-8 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${locale === 'en' ? 'bg-primary text-white' : 'text-muted-foreground'}`}>EN</button>
                </div>
                <Link to="/login" onClick={() => setMobileNavOpen(false)}>
                  <Button variant="outline" className="w-full font-black text-xs uppercase tracking-widest">{content.header.login}</Button>
                </Link>
                <Link to="/register" onClick={() => setMobileNavOpen(false)}>
                  <Button className="w-full bg-foreground text-background hover:bg-foreground/90 font-black text-xs uppercase tracking-widest rounded-xl h-11">
                    {content.header.start}
                  </Button>
                </Link>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10">
        {/* ── HERO ──────────────────────────────────────────────────── */}
        <section className="relative px-4 pt-28 pb-16 sm:pt-40 sm:pb-20">
          <div className="container mx-auto max-w-7xl">

            {/* Desktop: split layout */}
            <div className="hidden lg:grid lg:grid-cols-[1fr_1fr] lg:gap-20 lg:items-center lg:min-h-[calc(100dvh-120px)]">

              {/* Left: text */}
              <motion.div style={{ opacity: opacityHero, y: yHero }} className="space-y-8">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EXPO_OUT }}>
                  <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/25 bg-primary/8 px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    {content.hero.badge}
                  </div>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12, duration: 0.9, ease: EXPO_OUT }}
                  className="text-6xl xl:text-7xl 2xl:text-[5.5rem] font-black tracking-[-0.04em] leading-[0.88] text-balance"
                >
                  {content.hero.titleLead}
                  <br />
                  <span className="text-hero-gradient">{content.hero.titleAccent}</span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.24, duration: 0.8, ease: EXPO_OUT }}
                  className="text-lg xl:text-xl text-muted-foreground max-w-[50ch] font-medium leading-relaxed"
                >
                  {content.hero.description}
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.36, duration: 0.7, ease: EXPO_OUT }}
                >
                  <Link to="/register">
                    <button className="cta-btn group inline-flex items-center gap-3 rounded-full bg-primary px-7 py-4 text-base font-bold text-white hover:bg-primary/90 active:scale-[0.98] transition-all duration-300">
                      {content.hero.cta}
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-300">
                        <ArrowRight className="h-4 w-4" weight="bold" />
                      </span>
                    </button>
                  </Link>
                </motion.div>
              </motion.div>

              {/* Right: floating preview card */}
              <motion.div
                initial={{ opacity: 0, x: 48, y: 24 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ delay: 0.4, duration: 1.1, ease: EXPO_OUT }}
                className="relative"
              >
                {/* Ambient glow */}
                <div className="absolute -inset-16 bg-primary/10 blur-[100px] rounded-full pointer-events-none" />

                {/* Outer shell (double-bezel) */}
                <div className="relative rounded-[2rem] border border-white/10 dark:border-white/6 bg-white/[0.025] p-1.5 shadow-[0_48px_96px_-24px_rgba(0,0,0,0.5)] backdrop-blur-sm">
                  {/* Inner core */}
                  <div className="rounded-[calc(2rem-0.375rem)] border border-white/5 bg-card overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                    {/* Mock header */}
                    <div className="h-10 border-b border-border/50 bg-secondary/20 flex items-center px-4 gap-3">
                      <div className="flex gap-1.5">
                        <div className="h-2.5 w-2.5 rounded-full bg-red-500/40" />
                        <div className="h-2.5 w-2.5 rounded-full bg-amber-500/40" />
                        <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/40" />
                      </div>
                      <div className="flex-1 h-5 rounded-md bg-secondary/60 mx-6" />
                      <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-primary to-purple-500" />
                    </div>
                    {/* Stats */}
                    <div className="p-5 space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Выручка', value: '₽12.4M', delta: '+14%', color: 'text-emerald-400' },
                          { label: 'Сделок',  value: '184',    delta: '+8%',  color: 'text-blue-400' },
                          { label: 'Конверсия',value: '24.5%', delta: '+12%', color: 'text-purple-400' },
                        ].map((s, i) => (
                          <div key={i} className="rounded-xl bg-secondary/40 p-3">
                            <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{s.label}</div>
                            <div className="text-lg font-black tracking-[-0.02em]">{s.value}</div>
                            <div className={`text-[10px] font-bold ${s.color}`}>{s.delta}</div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-xl bg-secondary/20 p-4">
                        <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">Активность команды</div>
                        <div className="flex items-end gap-1.5 h-14">
                          {[40, 65, 45, 90, 55, 75, 85, 60, 50, 80].map((h, i) => (
                            <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }}
                              transition={{ delay: 0.7 + i * 0.05, duration: 0.5, ease: EXPO_OUT }}
                              className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/70 to-primary/20"
                            />
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {[
                          { label: 'Внедрение AI-платформы', status: 'В работе',   c: 'bg-blue-400/12 text-blue-400' },
                          { label: 'Разработка MVP CRM',     status: 'Проверка',   c: 'bg-purple-400/12 text-purple-400' },
                          { label: 'Дизайн-система v2',      status: 'Оплачено',   c: 'bg-emerald-400/12 text-emerald-400' },
                        ].map((row, i) => (
                          <div key={i} className="flex items-center gap-3 rounded-lg bg-secondary/20 px-3 py-2">
                            <span className="text-xs font-medium flex-1 truncate">{row.label}</span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${row.c}`}>{row.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Mobile / Tablet: centered */}
            <div className="lg:hidden text-center">
              <motion.div style={{ opacity: opacityHero, y: yHero, scale: scaleHero }} className="space-y-6 sm:space-y-8">
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EXPO_OUT }}>
                  <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/25 bg-primary/8 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-75" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    {content.hero.badge}
                  </div>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.9, ease: EXPO_OUT }}
                  className="text-4xl sm:text-6xl font-black tracking-[-0.04em] leading-[0.88]"
                >
                  {content.hero.titleLead}
                  <br />
                  <span className="text-hero-gradient">{content.hero.titleAccent}</span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.28, duration: 0.8, ease: EXPO_OUT }}
                  className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto font-medium leading-relaxed"
                >
                  {content.hero.description}
                </motion.p>

                <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.42, duration: 0.7, ease: EXPO_OUT }}>
                  <Link to="/register">
                    <button className="cta-btn-sm group inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 text-base font-bold text-white hover:bg-primary/90 active:scale-[0.98] transition-all duration-300">
                      {content.hero.cta}
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 group-hover:translate-x-0.5 transition-transform duration-300">
                        <ArrowRight className="h-4 w-4" weight="bold" />
                      </span>
                    </button>
                  </Link>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── SHOWCASE ──────────────────────────────────────────────── */}
        <Showcase content={content} />

        {/* ── BENTO FEATURES ────────────────────────────────────────── */}
        <section id="features" className="py-20 md:py-36 px-4 container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EXPO_OUT }}
            viewport={{ once: true }}
            className="text-center mb-14 md:mb-20 space-y-4"
          >
            <div className="inline-block px-4 py-1.5 rounded-full bg-secondary/60 border border-border/50 text-primary text-[10px] font-black uppercase tracking-[0.2em]">
              {content.modules.badge}
            </div>
            <h2 className="text-4xl sm:text-6xl lg:text-[5.5rem] font-black tracking-[-0.04em] leading-[0.9] text-balance">
              {content.modules.title}
            </h2>
            <p className="text-lg md:text-xl text-muted-foreground mx-auto max-w-2xl font-medium leading-relaxed">
              {content.modules.subtitle}
            </p>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid gap-4 md:gap-5 lg:grid-cols-12"
          >
            {BENTO_META.map((meta, i) => {
              const card = content.modules.cards[i]
              if (!card) return null
              const Icon = meta.icon
              return (
                <motion.div
                  key={i}
                  variants={fadeUp}
                  className={`${meta.size} group relative rounded-[1.75rem] overflow-hidden border border-border/50 bg-card p-7 md:p-8 hover:border-primary/35 transition-all duration-700 cursor-default`}
                  style={{ boxShadow: `0 0 0 0 ${meta.glow}` }}
                  whileHover={{ boxShadow: `0 0 60px 0 ${meta.glow}` }}
                  transition={{ duration: 0.4 }}
                >
                  {/* Hover gradient overlay */}
                  <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 ${meta.bg}`} style={{ background: `radial-gradient(ellipse at 30% 30%, ${meta.glow.replace('0.15', '0.12').replace('0.12', '0.1')}, transparent 70%)` }} />

                  <div className="relative z-10 space-y-5">
                    <div className="flex items-start justify-between">
                      <div className={`rounded-2xl p-4 w-fit shadow-lg ${meta.bg} group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}>
                        <Icon className={`h-7 w-7 ${meta.color}`} weight="duotone" />
                      </div>
                      <span className="text-[10px] font-black text-muted-foreground/30 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xl md:text-2xl font-black tracking-[-0.02em] mb-2">{card.title}</h3>
                      <p className="text-sm md:text-base text-muted-foreground font-medium leading-relaxed">{card.desc}</p>
                    </div>

                    {/* Mini visual for big cards */}
                    {i === 0 && (
                      <div className="rounded-xl border border-border/40 overflow-hidden mt-2">
                        {['Внедрение AI', 'Разработка CRM', 'Дизайн v2'].map((row, j) => (
                          <div key={j} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/30 last:border-0 bg-secondary/10 hover:bg-secondary/20 transition-colors">
                            <div className={`h-1.5 w-1.5 rounded-full ${j === 0 ? 'bg-blue-400' : j === 1 ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                            <span className="text-xs font-medium flex-1">{row}</span>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${j === 0 ? 'bg-blue-400/10 text-blue-400' : j === 1 ? 'bg-purple-400/10 text-purple-400' : 'bg-emerald-400/10 text-emerald-400'}`}>
                              {j === 0 ? 'В работе' : j === 1 ? 'Проверка' : 'Готово'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {i === 1 && (
                      <div className="space-y-2 mt-2">
                        <div className="bg-secondary/30 rounded-xl px-4 py-2.5 text-xs text-muted-foreground">Какая конверсия за март?</div>
                        <div className="bg-primary/10 border border-primary/15 rounded-xl px-4 py-2.5 text-xs text-foreground">Конверсия составила <span className="font-bold text-primary">24.5%</span> — на 12% выше декабря.</div>
                      </div>
                    )}

                    {i === 6 && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-xs font-semibold text-emerald-500">{content.showcase.chat.releaseBadge}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </motion.div>
        </section>

        {/* ── ECOSYSTEM ─────────────────────────────────────────────── */}
        <section className="py-20 md:py-32 px-4 bg-secondary/8 dark:bg-slate-950/30 border-y border-border/40 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="container mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EXPO_OUT }}
              viewport={{ once: true }}
              className="text-center mb-14 md:mb-20 space-y-4"
            >
              <h2 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-[-0.04em] leading-[0.9]">
                {content.ecosystem.title}
              </h2>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed font-medium">
                {content.ecosystem.subtitle}
              </p>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
              {content.ecosystem.cards.map((ecosystemItem, i) => {
                const Icon = ECOSYSTEM_ICON_META[i] || Database
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.7, ease: EXPO_OUT }}
                    viewport={{ once: true }}
                    className="relative group p-7 rounded-[1.75rem] border border-border/50 dark:border-white/5 bg-background hover:bg-muted/40 transition-colors duration-500 overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-28 h-28 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors" />
                    <div className="relative z-10 space-y-5">
                      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/15 flex items-center justify-center border border-primary/20">
                        <Icon className="h-7 w-7 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black tracking-[-0.02em] mb-2">{ecosystemItem.title}</h3>
                        <p className="text-sm font-medium text-muted-foreground leading-relaxed">{ecosystemItem.desc}</p>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        </section>

        {/* ── CTA ───────────────────────────────────────────────────── */}
        <section id="cta" className="py-24 md:py-44 px-4 relative">
          <motion.div
            initial={{ opacity: 0, y: 48 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: EXPO_OUT }}
            viewport={{ once: true }}
            className="container mx-auto max-w-5xl relative"
          >
            {/* Glow */}
            <div className="absolute inset-0 bg-primary/15 blur-[120px] rounded-full animate-pulse-glow" />

            {/* Outer shell */}
            <div className="relative rounded-[2rem] sm:rounded-[3rem] border border-white/10 dark:border-white/6 bg-white/[0.02] p-1.5 shadow-[0_60px_120px_-30px_rgba(0,0,0,0.5)]">
              {/* Inner core */}
              <div className="relative rounded-[calc(3rem-0.375rem)] border border-white/5 bg-card overflow-hidden shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] px-8 py-16 sm:px-16 sm:py-24 md:px-24 md:py-32 text-center space-y-8">
                {/* Rotating sparkle */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                  className="absolute -top-8 -right-8 opacity-[0.07]"
                >
                  <Sparkle className="h-48 w-48 md:h-64 md:w-64" weight="fill" />
                </motion.div>

                <div className="relative z-10 space-y-8">
                  <h2 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] leading-[0.88] text-balance">
                    {content.cta.title}
                  </h2>
                  <div className="pt-4">
                    <Link to="/register">
                      <button className="cta-btn-lg group inline-flex items-center gap-3 rounded-full bg-primary px-8 py-5 text-lg font-bold text-white hover:bg-primary/90 active:scale-[0.98] transition-all duration-300">
                        {content.cta.button}
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-300">
                          <ArrowRight className="h-5 w-5" weight="bold" />
                        </span>
                      </button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </main>

      {/* ── FOOTER ────────────────────────────────────────────────── */}
      <footer className="py-16 md:py-28 border-t border-border/40 relative">
        <div className="container mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-16 mb-14 md:mb-24">
            <div className="col-span-2 md:col-span-1 space-y-5">
              <Logo />
              <p className="text-base text-muted-foreground font-medium leading-relaxed">
                {content.footer.tagline}
              </p>
              <div className="flex gap-3">
                {[Lightning, Globe, ShieldCheck].map((Icon, i) => (
                  <button key={i} className="h-10 w-10 glass rounded-xl flex items-center justify-center hover:bg-secondary cursor-pointer transition-all hover:scale-105 active:scale-95">
                    <Icon className="h-4 w-4" weight="duotone" />
                  </button>
                ))}
              </div>
            </div>
            {content.footer.sections.map((section) => (
              <div key={section.title}>
                <h4 className="font-black text-[10px] uppercase tracking-[0.25em] mb-6 text-primary">{section.title}</h4>
                <ul className="space-y-4 text-sm font-medium text-muted-foreground">
                  {section.items.map((footerItem) => (
                    <li key={footerItem.to}>
                      <Link to={footerItem.to} className="hover:text-foreground transition-colors">
                        {footerItem.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row items-center justify-between pt-10 border-t border-border/40 gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em]">{content.footer.copyrights}</p>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-bold text-emerald-500 flex items-center gap-1.5 uppercase tracking-wide">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {content.footer.systemOnline}
                </span>
                <span className="text-[10px] font-bold opacity-30 uppercase tracking-wide">{content.footer.globalNodes}</span>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slow-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes scan {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(calc(64px - 2px)); }
        }
        .animate-slow-spin { animation: slow-spin 40s linear infinite; }
        html { scroll-behavior: smooth; }
        ::selection { background: hsl(var(--primary) / 0.3); color: inherit; }
        /* CTA button — shadow follows primary accent */
        .cta-btn        { box-shadow: 0 20px 48px -12px hsl(var(--primary) / 0.5); }
        .cta-btn:hover  { box-shadow: 0 24px 56px -12px hsl(var(--primary) / 0.65); }
        .cta-btn-sm     { box-shadow: 0 16px 40px -12px hsl(var(--primary) / 0.5); }
        .cta-btn-lg     { box-shadow: 0 24px 56px -12px hsl(var(--primary) / 0.55); }
        .cta-btn-lg:hover { box-shadow: 0 28px 64px -12px hsl(var(--primary) / 0.7); }
        /* Logo icon glow on hover */
        .logo-icon-wrap { transition: box-shadow 0.5s ease; }
        .logo-group:hover .logo-icon-wrap { box-shadow: 0 0 24px hsl(var(--primary) / 0.4); }
      `}} />
    </div>
  )
}
