import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion, useScroll, useTransform, AnimatePresence, useSpring, useMotionValue } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  FileText, BookOpen, Calendar, BarChart3, Brain, Users,
  Shield, Zap, ArrowRight, Sun, Moon, CheckCircle,
  Globe, Sparkles, Layout,
  Search, Plus, MessageSquare, Send,
  ChevronRight, LineChart, Database, LayoutDashboard,
  MousePointer2
} from 'lucide-react'
import { footerSections } from '@/lib/publicPageContent'

// --- Constants ---

const features = [
  {
    icon: Layout,
    title: 'Смарт Таблицы',
    desc: 'Гибкая структура данных, связи между таблицами, поддержка различных видов (Канбан, Сетка).',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: BookOpen,
    title: 'База знаний',
    desc: 'Корпоративная вики с блочным редактором и древовидной структурой страниц.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    icon: Calendar,
    title: 'Расписание',
    desc: 'Планировщик задач и событий организации с контролем дедлайнов.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: FileText,
    title: 'Документооборот',
    desc: 'Создание, редактирование DOCX и подпись PDF-файлов прямо в браузере.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    icon: Brain,
    title: 'AI Ассистент',
    desc: 'Умный помощник для анализа данных и автоматизации задач.',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
  },
  {
    icon: BarChart3,
    title: 'Аналитика',
    desc: 'Визуализация данных и выгрузка аналитики по всем модулям системы.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
]

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
}

// --- Ambient Cursors (Native Cursor is Visible) ---

function DataStreamParticle({ mouseX, mouseY, index }: { mouseX: any; mouseY: any; index: number }) {
  return (
    <motion.div
      className="fixed top-0 left-0 w-[1px] h-4 bg-primary/50 z-[9990] pointer-events-none"
      style={{
        x: useSpring(mouseX, { damping: 20 - index * 5, stiffness: 150 - index * 30 }),
        y: useSpring(mouseY, { damping: 20 - index * 5, stiffness: 150 - index * 30 }),
        translateX: `${(index - 1) * 8}px`,
        translateY: '10px',
        opacity: 1 - index * 0.3,
      }}
    />
  )
}

const Cursors = {
  // 1. Subtle Aura (Soft glow following the cursor)
  SubtleAura: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-32 h-32 rounded-full z-[9990] pointer-events-none mix-blend-screen opacity-50 dark:opacity-30" style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.4) 0%, transparent 70%)', x: useSpring(mouseX, { damping: 40, stiffness: 200 }), y: useSpring(mouseY, { damping: 40, stiffness: 200 }), translateX: '-50%', translateY: '-50%' }} />
  ),
  // 2. Delayed Trail (A small dot trailing slightly behind)
  DelayedTrail: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-2 h-2 bg-primary/70 rounded-full z-[9998] pointer-events-none" style={{ x: useSpring(mouseX, { damping: 15, stiffness: 100 }), y: useSpring(mouseY, { damping: 15, stiffness: 100 }), translateX: '-50%', translateY: '-50%' }} />
  ),
  // 3. Orbiting Rings (Two thin rings slowly rotating around the cursor)
  OrbitingRings: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-12 h-12 z-[9995] pointer-events-none" style={{ x: useSpring(mouseX, { damping: 30, stiffness: 300 }), y: useSpring(mouseY, { damping: 30, stiffness: 300 }), translateX: '-50%', translateY: '-50%' }}>
      <motion.div className="absolute inset-0 rounded-full border border-primary/30 border-t-primary/70 animate-slow-spin" />
      <motion.div className="absolute inset-2 rounded-full border border-purple-500/30 border-b-purple-500/70 animate-spin-reverse" style={{ animationDuration: '4s' }} />
    </motion.div>
  ),
  // 4. Tech Scanner (A horizontal scanning line following the cursor)
  TechScanner: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-16 h-16 z-[9995] pointer-events-none overflow-hidden rounded-full border border-primary/20" style={{ x: useSpring(mouseX, { damping: 25, stiffness: 250 }), y: useSpring(mouseY, { damping: 25, stiffness: 250 }), translateX: '-50%', translateY: '-50%' }}>
      <div className="w-full h-[2px] bg-primary/80 animate-[scan_2s_ease-in-out_infinite]" />
    </motion.div>
  ),
  // 5. Data Stream (Faint data-like particles trailing)
  DataStream: ({ mouseX, mouseY }: any) => (
    <>
      {[0, 1, 2].map((i) => (
        <DataStreamParticle key={i} mouseX={mouseX} mouseY={mouseY} index={i} />
      ))}
    </>
  ),
  // 6. Pulse Ring (A ring that continuously pulses outwards from the cursor)
  PulseRing: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 z-[9995] pointer-events-none" style={{ x: mouseX, y: mouseY, translateX: '-50%', translateY: '-50%' }}>
      <div className="w-8 h-8 rounded-full border border-primary/50 animate-ping" style={{ animationDuration: '2s' }} />
    </motion.div>
  ),
  // 7. Sparkle Trail (Little sparks following)
  SparkleTrail: ({ mouseX, mouseY }: any) => (
    <>
      <motion.div className="fixed top-0 left-0 w-1 h-1 bg-yellow-400 rounded-full z-[9998] pointer-events-none blur-[1px]" style={{ x: useSpring(mouseX, { damping: 10, stiffness: 80 }), y: useSpring(mouseY, { damping: 10, stiffness: 80 }), translateX: '8px', translateY: '8px' }} />
      <motion.div className="fixed top-0 left-0 w-1.5 h-1.5 bg-blue-400 rounded-full z-[9998] pointer-events-none blur-[1px]" style={{ x: useSpring(mouseX, { damping: 14, stiffness: 120 }), y: useSpring(mouseY, { damping: 14, stiffness: 120 }), translateX: '-10px', translateY: '5px' }} />
    </>
  ),
  // 8. Magnetic Bounds (A subtle square that lags behind)
  MagneticBounds: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-10 h-10 border border-primary/40 rounded-lg z-[9995] pointer-events-none mix-blend-screen" style={{ x: useSpring(mouseX, { damping: 20, stiffness: 180 }), y: useSpring(mouseY, { damping: 20, stiffness: 180 }), translateX: '-50%', translateY: '-50%', rotate: useSpring(mouseX, { damping: 30, stiffness: 50 }) }} />
  ),
  // 9. Neon Crosshair Aura (Soft crosshair glow behind cursor)
  NeonCrosshair: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 w-16 h-16 z-[9995] pointer-events-none opacity-50" style={{ x: useSpring(mouseX, { damping: 35, stiffness: 400 }), y: useSpring(mouseY, { damping: 35, stiffness: 400 }), translateX: '-50%', translateY: '-50%' }}>
      <div className="absolute top-1/2 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent blur-[1px]" />
      <div className="absolute top-0 left-1/2 w-[1px] h-full bg-gradient-to-b from-transparent via-primary to-transparent blur-[1px]" />
    </motion.div>
  ),
  // 10. Floating Particles (Small geometric shapes orbiting)
  FloatingParticles: ({ mouseX, mouseY }: any) => (
    <motion.div className="fixed top-0 left-0 z-[9990] pointer-events-none" style={{ x: useSpring(mouseX, { damping: 25, stiffness: 200 }), y: useSpring(mouseY, { damping: 25, stiffness: 200 }), translateX: '-50%', translateY: '-50%' }}>
      <motion.div className="absolute w-2 h-2 border border-primary/60 rotate-45 animate-pulse" style={{ top: '-15px', left: '10px' }} />
      <motion.div className="absolute w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-pulse" style={{ animationDelay: '0.5s', top: '10px', left: '-10px' }} />
    </motion.div>
  )
}

const cursorNames = [
  "Subtle Aura", "Trail", "Orbiting", "Scanner", "Data Stream",
  "Pulse Ring", "Sparkles", "Bounds", "Neon Aura", "Particles"
]

const CursorManager = ({ cursorIndex }: { cursorIndex: number }) => {
  const mouseX = useMotionValue(-100)
  const mouseY = useMotionValue(-100)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [mouseX, mouseY])

  const CursorComponent = Object.values(Cursors)[cursorIndex] as React.ElementType
  return (
    <div className="hidden md:block">
      <CursorComponent mouseX={mouseX} mouseY={mouseY} />
    </div>
  )
}

// --- Components ---


const Logo = () => (
  <div className="flex items-center gap-3 group cursor-pointer">
    {/* Minimalist Solid Icon */}
    <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all duration-300 group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-[0_0_20px_rgba(37,99,235,0.4)]">
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    </div>

    <div className="flex flex-col justify-center">
      <span className="text-2xl font-black tracking-tight text-foreground leading-none">
        CRM<span className="text-primary italic ml-1">AI</span>
      </span>
      <span className="text-[8px] font-bold uppercase tracking-[0.3em] text-muted-foreground mt-0.5">
        Intelligence OS
      </span>
    </div>
  </div>
)

const Showcase = () => {
  const [activeTab, setActiveTab] = useState('tables')

  const tabs = [
    { id: 'tables', label: 'Таблицы', icon: Layout },
    { id: 'ai', label: 'AI Интеллект', icon: Brain },
    { id: 'docs', label: 'Редактор', icon: FileText },
    { id: 'kb', label: 'База знаний', icon: BookOpen },
    { id: 'dash', label: 'Аналитика', icon: LineChart },
    { id: 'chat', label: 'Чат', icon: MessageSquare, soon: true },
  ]

  return (
    <section id="demo" className="py-24 px-4 relative">
      <div className="container mx-auto max-w-7xl">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-6">Весь бизнес в одном интерфейсе</h2>
          <div className="flex flex-wrap justify-center gap-2 md:gap-4 p-2 rounded-2xl bg-secondary/20 backdrop-blur-xl border border-border/50 max-w-fit mx-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all relative ${activeTab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-background shadow-md rounded-xl"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <tab.icon className="h-4 w-4 relative z-10" />
                <span className="relative z-10">{tab.label}</span>
                {tab.soon && (
                  <span className="relative z-10 text-[8px] bg-emerald-500/10 text-emerald-500 px-1 rounded uppercase">Soon</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          layout
          className="relative rounded-[2.5rem] border border-border/50 bg-background shadow-[0_40px_100px_-20px_rgba(0,0,0,0.5)] overflow-hidden min-h-[500px] md:min-h-[700px] flex flex-col"
        >
          {/* Mock App Header */}
          <div className="h-14 px-6 flex items-center justify-between border-b border-border/50 bg-secondary/10">
            <div className="flex items-center gap-4">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-500/30" />
                <div className="h-3 w-3 rounded-full bg-amber-500/30" />
                <div className="h-3 w-3 rounded-full bg-emerald-500/30" />
              </div>
              <div className="h-6 w-px bg-border/50" />
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-background/50 border border-border/30">
                <Search className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium">Поиск по всей системе...</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-purple-500 shadow-lg" />
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 flex overflow-hidden">
            {/* Mock Sidebar */}
            <div className="w-16 md:w-60 border-r border-border/50 p-4 space-y-8 bg-secondary/5 hidden sm:block">
              <div className="space-y-1">
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${t.id === activeTab ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                  >
                    <t.icon className="h-5 w-5" />
                    <span className="text-sm font-bold hidden md:block">{t.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tab Content Rendering */}
            <div className="flex-1 relative overflow-auto bg-gradient-to-br from-background to-secondary/10 p-4 md:p-12">
              <AnimatePresence mode="wait">
                {activeTab === 'tables' && (
                  <motion.div
                    key="tables"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-8 h-full"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-3xl font-black">Сделки: Департамент Продаж</h3>
                      <Button size="sm" className="gradient-primary text-white font-bold rounded-lg px-4"><Plus className="h-4 w-4 mr-2" /> Сделка</Button>
                    </div>
                    <div className="rounded-2xl border border-border/50 bg-background/50 overflow-hidden shadow-2xl">
                      <div className="grid grid-cols-5 p-5 border-b border-border/50 bg-secondary/20 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                        <span>Проект</span>
                        <span>Статус</span>
                        <span>Ценность</span>
                        <span>Приоритет</span>
                        <span>Владелец</span>
                      </div>
                      {[
                        { p: 'Внедрение AI-платформы', s: 'В работе', v: '2,400,000 ₽', pr: 'Высокий', color: 'text-blue-400', b: 'bg-blue-400/10' },
                        { p: 'Разработка MVP CRM', s: 'Проверка', v: '850,000 ₽', pr: 'Средний', color: 'text-purple-400', b: 'bg-purple-400/10' },
                        { p: 'Дизайн-система v2', s: 'Оплачено', v: '450,000 ₽', pr: 'Низкий', color: 'text-emerald-400', b: 'bg-emerald-400/10' },
                        { p: 'Консалтинг по ИИ', s: 'Лид', v: '120,000 ₽', pr: 'Высокий', color: 'text-amber-400', b: 'bg-amber-400/10' },
                      ].map((row, i) => (
                        <div key={i} className="grid grid-cols-5 p-5 border-b border-border/50 last:border-0 hover:bg-secondary/5 transition-all cursor-pointer">
                          <span className="text-sm font-bold">{row.p}</span>
                          <span className={`text-[10px] font-black px-2 py-1 rounded-md w-fit h-fit ${row.b} ${row.color}`}>{row.s}</span>
                          <span className="text-sm font-mono font-medium">{row.v}</span>
                          <span className="text-xs font-semibold">{row.pr}</span>
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-secondary" />
                            <span className="text-xs text-muted-foreground">Менеджер {i + 1}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {activeTab === 'ai' && (
                  <motion.div
                    key="ai"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 1.05 }}
                    className="flex flex-col h-full gap-8"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-2xl gradient-primary flex items-center justify-center shadow-xl shadow-primary/20">
                        <Brain className="text-white h-7 w-7" />
                      </div>
                      <div>
                        <h3 className="text-3xl font-black">AI Intelligence</h3>
                        <p className="text-muted-foreground font-medium italic">Анализируй данные разговором</p>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-3 gap-6 flex-1">
                      <div className="md:col-span-2 glass-card p-6 space-y-6 relative flex flex-col">
                        <div className="space-y-4 flex-1">
                          <div className="flex gap-4">
                            <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center"><Users className="h-4 w-4 text-primary" /></div>
                            <div className="bg-secondary/20 p-4 rounded-2xl rounded-tl-none text-sm font-medium max-w-[80%]">Какая средняя конверсия лидов из телеграма за прошлый месяц?</div>
                          </div>
                          <div className="flex gap-4 justify-end">
                            <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl rounded-tr-none text-sm font-medium max-w-[80%] space-y-2">
                              <p>Средняя конверсия составила <strong>24.5%</strong>. Это на 12% выше, чем в декабре.</p>
                              <div className="h-24 w-full bg-primary/5 rounded-lg flex items-end gap-1 p-2">
                                {[40, 60, 45, 90, 70, 85].map((h, i) => (
                                  <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${h}%` }} className="flex-1 bg-primary/40 rounded-t" />
                                ))}
                              </div>
                            </div>
                            <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center"><Brain className="h-4 w-4 text-white" /></div>
                          </div>
                        </div>
                        <div className="mt-4 flex gap-3 p-2 glass rounded-xl border-primary/20">
                          <input type="text" placeholder="Задай любой вопрос..." className="flex-1 bg-transparent border-0 outline-none px-4 text-sm font-bold" />
                          <Button size="icon" className="gradient-primary rounded-lg text-white"><Send className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <div className="space-y-6">
                        <Card className="glass-card border-emerald-500/20">
                          <CardContent className="p-6 space-y-3">
                            <div className="flex items-center gap-2 text-emerald-500 font-black text-xs uppercase"><Zap className="h-4 w-4" /> Smart Insight</div>
                            <p className="text-sm font-semibold">Ваш CRM показатель "LTV" вырос на 8% благодаря ИИ-рекомендациям.</p>
                          </CardContent>
                        </Card>
                        <Card className="glass-card">
                          <CardContent className="p-6 space-y-3">
                            <div className="text-xs font-black uppercase text-muted-foreground">Recent Tasks Auto-Completed</div>
                            <div className="space-y-2">
                              {[1, 2, 3].map(i => (
                                <div key={i} className="flex items-center gap-2">
                                  <CheckCircle className="h-3 w-3 text-primary" />
                                  <div className="h-1.5 w-full bg-secondary/50 rounded" />
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'docs' && (
                  <motion.div
                    key="docs"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="flex flex-col h-full gap-8"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-3xl font-black">Редактор Документов</h3>
                      <div className="flex gap-2">
                        <Button variant="outline" className="font-bold">PDF Экспорт</Button>
                        <Button className="gradient-primary text-white font-bold">Сохранить</Button>
                      </div>
                    </div>
                    <Card className="flex-1 glass-card border-none bg-white/10 p-12 relative overflow-hidden">
                      <div className="max-w-2xl mx-auto rounded-sm border border-slate-200 bg-white p-12 text-slate-900 shadow-[0_0_40px_rgba(15,23,42,0.15)] space-y-6 min-h-full dark:border-white/5 dark:bg-zinc-950 dark:text-slate-200 dark:shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                        <div className="border-b-2 border-slate-300 pb-4 dark:border-slate-100">
                          <h1 className="text-2xl font-serif font-black uppercase text-center">Договор №124-Б</h1>
                        </div>
                        <p className="text-sm leading-relaxed font-serif">
                          Настоящее соглашение заключено между <strong>py it platform</strong> и вашим ООО "Успешный успех". Мы обязуемся предоставлять безупречный софт, а вы — радоваться прибыли.
                        </p>
                        <div className="h-32 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center flex-col text-slate-500 dark:border-slate-200 dark:text-slate-300">
                          <Plus className="h-8 w-8 mb-2" />
                          <span className="text-[10px] font-black uppercase tracking-widest">Перетащите сюда печать или подпись</span>
                        </div>
                        <div className="pt-12 flex justify-between gap-12 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                          <div className="flex-1 border-t border-slate-300 pt-2 dark:border-slate-200">Сторона А (Signature)</div>
                          <div className="flex-1 border-t border-slate-300 pt-2 dark:border-slate-200">Сторона Б (Stamp)</div>
                        </div>
                      </div>
                      {/* Mock Toolbar */}
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-4 rounded-full border border-border bg-white/85 p-2 px-6 backdrop-blur dark:border-white/20 dark:bg-black/80">
                        <div className="h-4 w-20 rounded bg-slate-300/80 dark:bg-white/20" />
                        <div className="h-4 w-4 rounded bg-slate-300/80 dark:bg-white/20" />
                        <div className="h-4 w-px bg-slate-300/80 dark:bg-white/10" />
                        <div className="flex gap-2">
                          <div className="h-4 w-4 bg-primary rounded-full cursor-pointer hover:scale-110 transition-transform" />
                          <div className="h-4 w-4 bg-purple-500 rounded-full cursor-pointer hover:scale-110 transition-transform" />
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}

                {activeTab === 'kb' && (
                  <motion.div
                    key="kb"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex h-full gap-8"
                  >
                    <div className="w-64 glass-card p-6 space-y-8 hidden md:block">
                      <div className="space-y-4">
                        <h4 className="text-xs font-black uppercase tracking-widest opacity-50">Навигация по базе</h4>
                        <div className="space-y-2">
                          {['Процессы продаж', 'Маркетинг 2026', 'Онбординг', 'Безопасность'].map((item, i) => (
                            <div key={i} className={`flex items-center gap-2 text-sm font-bold ${i === 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                              {i === 0 ? <ChevronRight className="h-4 w-4 rotate-90" /> : <ChevronRight className="h-4 w-4" />}
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 space-y-8">
                      <div className="space-y-4">
                        <h3 className="text-4xl font-black">Процессы продаж: Инструкция</h3>
                        <div className="flex gap-2">
                          <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-black uppercase">Sales</span>
                          <span className="text-[10px] bg-secondary px-2 py-1 rounded font-black uppercase opacity-50">Confidential</span>
                        </div>
                      </div>
                      <div className="prose dark:prose-invert space-y-6">
                        <p className="text-lg font-medium text-muted-foreground">Этот документ описывает пайплайны взаимодействия с крупным энтерпрайз-сектором через нашу платформу.</p>
                        <div className="grid grid-cols-2 gap-4">
                          <Card className="glass-card border-none bg-blue-500/10 p-6">
                            <h5 className="font-black mb-2">Этап 1: Скоринг</h5>
                            <p className="text-xs opacity-70">Используйте AI для оценки потенциала сделки на основе открытых данных.</p>
                          </Card>
                          <Card className="glass-card border-none bg-purple-500/10 p-6">
                            <h5 className="font-black mb-2">Этап 2: Презентация</h5>
                            <p className="text-xs opacity-70">Создайте кастомный дашборд прямо в этом документе.</p>
                          </Card>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'dash' && (
                  <motion.div
                    key="dash"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-8 h-full"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-3xl font-black">Аналитический центр</h3>
                      <div className="flex gap-2">
                        <select className="bg-secondary/50 border border-border/50 rounded-lg px-4 py-2 text-sm font-bold outline-none">
                          <option>За текущий месяц</option>
                          <option>За квартал</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      {[
                        { l: 'Выручка', v: '₽ 12.4M', c: '+14%', col: 'text-emerald-500' },
                        { l: 'Активных Сделок', v: '184', c: '+8%', col: 'text-blue-500' },
                        { l: 'Средний Чек', v: '₽ 680K', c: '-2%', col: 'text-amber-500' },
                        { l: 'Индекс Счастья', v: '9.4', c: '+0.2', col: 'text-pink-500' },
                      ].map((stat, i) => (
                        <Card key={i} className="glass-card hover:scale-105 transition-transform duration-500">
                          <CardContent className="p-6 space-y-2">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-50">{stat.l}</div>
                            <div className="text-2xl font-black tracking-tight">{stat.v}</div>
                            <div className={`text-[10px] font-bold ${stat.col}`}>{stat.c} vs last mo.</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className="grid md:grid-cols-2 gap-6 h-[250px] md:h-[350px]">
                      <Card className="glass-card p-6 flex flex-col">
                        <h4 className="font-black text-sm mb-6 uppercase tracking-widest opacity-50">Активность команды</h4>
                        <div className="flex-1 flex items-end gap-3 pb-4">
                          {[30, 80, 45, 95, 60, 40, 85, 70, 50, 90].map((h, i) => (
                            <motion.div
                              key={i}
                              initial={{ height: 0 }}
                              whileInView={{ height: `${h}%` }}
                              className="flex-1 bg-gradient-to-t from-primary/80 to-primary/20 rounded-t-lg relative group"
                            >
                              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background px-2 py-1 rounded text-[8px] font-black opacity-0 group-hover:opacity-100 transition-opacity">
                                {h}%
                              </div>
                            </motion.div>
                          ))}
                        </div>
                        <div className="flex justify-between text-[10px] font-bold opacity-50 px-2 uppercase tracking-tighter">
                          <span>Mon</span>
                          <span>Wed</span>
                          <span>Fri</span>
                          <span>Sun</span>
                        </div>
                      </Card>
                      <Card className="glass-card p-6 flex flex-col">
                        <h4 className="font-black text-sm mb-6 uppercase tracking-widest opacity-50">Распределение лидов</h4>
                        <div className="flex-1 flex items-center justify-center relative">
                          <div className="h-40 w-40 rounded-full border-8 border-secondary border-t-primary border-r-purple-500 border-b-emerald-500 animate-slow-spin shadow-2xl" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black">100%</span>
                            <span className="text-[8px] font-bold opacity-50 uppercase">Reach</span>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </motion.div>
                )}

                {activeTab === 'chat' && (
                  <motion.div
                    key="chat"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center h-full space-y-8 text-center"
                  >
                    <div className="relative">
                      <div className="absolute inset-0 bg-primary/20 blur-[80px] rounded-full animate-pulse" />
                      <div className="h-32 w-32 rounded-[2.5rem] gradient-primary flex items-center justify-center shadow-2xl relative z-10 rotate-12 scale-110">
                        <MessageSquare className="h-16 w-16 text-white" />
                      </div>
                    </div>
                    <div className="space-y-4 relative z-10">
                      <h3 className="text-5xl font-black tracking-tight">Корпоративный Мессенджер</h3>
                      <p className="text-xl text-muted-foreground font-medium max-w-lg mx-auto leading-relaxed">
                        Мгновенная связь с командой, приватные каналы и треды.
                        Полная синхронизация с вашими задачами и CRM.
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 font-black text-sm uppercase tracking-widest animate-pulse">
                      <Zap className="h-4 w-4" /> В разработке — Релиз в Апреле
                    </div>
                    <div className="flex gap-4 opacity-50 grayscale select-none">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-12 w-12 rounded-full bg-secondary" />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme()
  const { scrollY } = useScroll()
  const [cursorIndex, setCursorIndex] = useState(6) // Set default to Sparkles

  // Advanced Parallax
  const opacityHero = useTransform(scrollY, [0, 500], [1, 0])
  const yHero = useTransform(scrollY, [0, 500], [0, 150])
  const scaleHero = useTransform(scrollY, [0, 500], [1, 0.8])

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30 overflow-x-hidden">
      <div className="fixed inset-0 gradient-mesh opacity-60 dark:opacity-40" />
      <CursorManager cursorIndex={cursorIndex} />

      {/* Cursor Switcher Widget */}
      <div className="fixed bottom-6 right-6 z-[10000] glass-card p-2 rounded-2xl border border-border/50 hidden md:flex flex-col gap-2 items-end transition-all hover:bg-background/80 shadow-2xl">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2 flex items-center gap-2">
          <MousePointer2 className="h-3 w-3" />
          Cursor Style
        </div>
        <div className="flex bg-secondary/50 rounded-xl p-1 relative items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background" onClick={() => setCursorIndex((prev: number) => (prev > 0 ? prev - 1 : cursorNames.length - 1))}>
            <ChevronRight className="h-4 w-4 rotate-180" />
          </Button>
          <div className="w-28 text-center text-xs font-black text-primary tracking-wider uppercase">
            {cursorNames[cursorIndex]}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background" onClick={() => setCursorIndex((prev: number) => (prev < cursorNames.length - 1 ? prev + 1 : 0))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[160px] animate-pulse-glow" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[160px] animate-pulse-glow" />
      </div>

      {/* Header */}
      <header className="fixed top-0 z-[100] w-full glass border-b border-border/50">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-4 md:px-8 h-20">
          <Link to="/">
            <Logo />
          </Link>

          <div className="flex items-center gap-4 md:gap-8">
            <nav className="hidden lg:flex items-center gap-8 font-black text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <a href="#features" className="hover:text-primary transition-colors">Возможности</a>
              <a href="#demo" className="hover:text-primary transition-colors">Как это выглядит</a>
              <a href="#cta" className="hover:text-primary transition-colors">Начать</a>
            </nav>

            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-xl hover:bg-secondary">
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
              <Link to="/login" className="hidden sm:block">
                <Button variant="ghost" className="font-black text-xs uppercase tracking-widest px-6">Вход</Button>
              </Link>
              <Link to="/register">
                <Button className="bg-foreground text-background hover:bg-foreground/90 font-black text-xs uppercase tracking-widest px-8 h-11 rounded-xl shadow-xl shadow-foreground/10 active:scale-95 transition-all">
                  Старт
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10">
        {/* Extreme Hero */}
        <section className="relative px-4 pt-44 pb-24 md:pt-64 md:pb-44 text-center">
          <motion.div
            style={{ opacity: opacityHero, y: yHero, scale: scaleHero }}
            className="container mx-auto max-w-5xl"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-6 py-3 text-xs font-black uppercase tracking-[0.2em] text-primary mb-12 shadow-2xl shadow-primary/10"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Платформа 2026: Новая Эра CRM
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 1, ease: [0.22, 1, 0.36, 1] }}
              className="text-6xl md:text-[8rem] font-black tracking-tighter leading-[0.85] mb-12"
            >
              Будущее вашего бизнеса — <br />
              это <span className="text-transparent bg-clip-text bg-gradient-to-br from-primary via-purple-500 to-pink-500 drop-shadow-[0_10px_10px_rgba(0,0,0,0.3)]">CRM AI</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 1 }}
              className="text-xl md:text-3xl text-muted-foreground max-w-3xl mx-auto mb-16 font-medium leading-relaxed tracking-tight"
            >
              Интеллектуальная экосистема, которая не просто хранит данные,
              а развивает ваш бизнес с помощью ИИ.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-6"
            >
              <Link to="/register">
                <Button size="lg" className="gradient-primary h-16 px-12 text-xl font-black rounded-2xl shadow-[0_25px_50px_-12px_rgba(37,99,235,0.5)] active:scale-95 transition-all group">
                  Создать воркспейс
                  <ArrowRight className="h-6 w-6 ml-3 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </motion.div>
          </motion.div>

          {/* Floating background blobs */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140%] h-[140%] -z-10 opacity-[0.03] pointer-events-none">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full animate-slow-spin">
              <path fill="currentColor" d="M38.1,-63C49.9,-54.6,60.6,-45.1,68.4,-33C76.2,-20.9,81,-6.1,79.2,7.7C77.4,21.5,69,34.2,59.3,45.2C49.6,56.1,38.6,65.2,26,69.5C13.4,73.8,-0.8,73.4,-14.7,69.5C-28.5,65.6,-42.1,58.3,-53.6,47.9C-65.1,37.6,-74.6,24.1,-77.8,9.4C-81,-5.2,-78,-21.1,-70,-34.2C-62,-47.3,-49,-57.6,-35.3,-64.9C-21.6,-72.1,-7.2,-76.3,3.4,-72C14,-67.7,26.4,-71.4,38.1,-63Z" transform="translate(100 100)" />
            </svg>
          </div>
        </section>

        {/* Tabbed Showcase Section */}
        <Showcase />

        {/* Features Bento Grid */}
        <section id="features" className="py-32 px-4 container mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-24 space-y-6"
          >
            <div className="inline-block px-3 py-1 rounded-full bg-secondary text-primary text-[10px] font-black uppercase tracking-widest">Premium Features</div>
            <h2 className="text-5xl md:text-8xl font-black tracking-tighter">Всё под рукой</h2>
            <p className="text-xl md:text-2xl text-muted-foreground mx-auto max-w-2xl font-medium">Бескомпромиссная модульность для современных команд.</p>
          </motion.div>

          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {features.map((f, i) => (
              <motion.div key={i} variants={item}>
                <Card className="group glass-card h-full hover:border-primary/50 transition-all duration-700 overflow-hidden relative border-border/50">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  <CardContent className="p-10 space-y-6 relative z-10">
                    <div className={`rounded-3xl p-5 w-fit shadow-2xl ${f.bg} group-hover:scale-110 transition-transform duration-700 group-hover:rotate-6`}>
                      <f.icon className={`h-10 w-10 ${f.color}`} />
                    </div>
                    <h3 className="text-3xl font-black tracking-tight">{f.title}</h3>
                    <p className="text-lg text-muted-foreground font-medium leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* Real Features Section */}
        <section id="features" className="py-32 px-4 bg-secondary/10 dark:bg-slate-950/40 border-y border-border/50 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="container mx-auto max-w-7xl">
            <div className="text-center mb-24 space-y-6">
              <h2 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground">
                Интеллектуальная экосистема
              </h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Единая платформа, объединяющая базу знаний, аналитику и встроенные AI-инструменты для эффективного управления процессами.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  icon: Database,
                  title: 'База Знаний',
                  desc: 'Единое пространство для всех документов компании с умным поиском.',
                  delay: 0
                },
                {
                  icon: FileText,
                  title: 'Редактор Word',
                  desc: 'Встроенный полноценный редактор документов с поддержкой совместной работы.',
                  delay: 0.1
                },
                {
                  icon: LayoutDashboard,
                  title: 'Дашборды',
                  desc: 'Интерактивная аналитика и визуализация ключевых показателей в реальном времени.',
                  delay: 0.2
                },
                {
                  icon: MessageSquare,
                  title: 'ИИ Чат (Скоро)',
                  desc: 'Персональный ассистент, знающий весь контекст вашего бизнеса и задач.',
                  delay: 0.3
                }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: item.delay }}
                  viewport={{ once: true }}
                  className="relative group p-8 rounded-[2rem] border border-border/50 dark:border-white/5 bg-background hover:bg-muted/50 transition-colors duration-500 overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-colors" />

                  <div className="relative z-10 space-y-6">
                    <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center border border-primary/30">
                      <item.icon className="h-8 w-8 text-primary" />
                    </div>

                    <div>
                      <h3 className="text-2xl font-black tracking-tight mb-3">{item.title}</h3>
                      <p className="text-sm font-medium text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Extreme CTA */}
        <section id="cta" className="py-44 px-4 relative">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="container mx-auto max-w-6xl relative"
          >
            <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full animate-pulse-glow" />
            <div className="relative glass-card border-border/50 dark:border-white/5 bg-background dark:bg-[#0a0f1d] text-foreground dark:text-slate-50 rounded-[4rem] p-12 md:p-32 text-center space-y-12 overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.4)] dark:shadow-[0_80px_160px_-40px_rgba(0,0,0,0.8)] border-t dark:border-t-white/10">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="absolute -top-10 -right-10 opacity-10"
              >
                <Sparkles className="h-64 w-64" />
              </motion.div>

              <h2 className="text-5xl md:text-8xl font-black tracking-tighter relative z-10 leading-[0.9]">
                Начни новую главу <br /> своего бизнеса
              </h2>
              <p className="text-xl md:text-3xl text-muted-foreground max-w-3xl mx-auto font-medium relative z-10 leading-relaxed">
                Присоединяйся к элите, которая выбирает интеллект и скорость.
                Бесплатно на 14 дней.
              </p>
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="pt-8 relative z-10"
              >
                <Link to="/register" className="mx-auto block w-full max-w-[34rem]">
                  <Button
                    size="lg"
                    className="h-14 w-full justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-black text-white shadow-[0_30px_60px_-12px_rgba(37,99,235,0.6)] hover:bg-primary/90 sm:h-16 sm:gap-3 sm:px-6 sm:text-lg md:h-20 md:rounded-3xl md:px-16 md:text-2xl"
                  >
                    Создать аккаунт сейчас
                    <ArrowRight className="h-5 w-5 shrink-0 sm:h-6 sm:w-6 md:h-8 md:w-8" />
                  </Button>
                </Link>
              </motion.div>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Extreme Footer */}
      <footer className="py-32 border-t border-border/50 relative">
        <div className="container mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-20 mb-32">
            <div className="col-span-2 md:col-span-1 space-y-8">
              <Logo />
              <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                Инструменты завтрашнего дня, доступные уже сегодня.
              </p>
              <div className="flex gap-6">
                {[Zap, Globe, Shield].map((Icon, i) => (
                  <div key={i} className="h-12 w-12 glass rounded-2xl flex items-center justify-center hover:bg-secondary cursor-pointer transition-all hover:scale-110">
                    <Icon className="h-5 w-5" />
                  </div>
                ))}
              </div>
            </div>
            {footerSections.map((section) => (
              <div key={section.title}>
                <h4 className="font-black text-xs uppercase tracking-[0.3em] mb-10 text-primary">{section.title}</h4>
                <ul className="space-y-6 text-sm font-bold text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      <Link to={item.to} className="hover:text-foreground cursor-pointer transition-colors">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between pt-12 border-t border-border/50 gap-8">
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em]">© 2026 CRM AI PLATFORM. ALL RIGHTS RESERVED.</p>
              <div className="flex items-center gap-4">
                <span className="text-[10px] font-black uppercase text-emerald-500 flex items-center gap-1">
                  <div className="h-1 w-1 rounded-full bg-emerald-500" /> System Online
                </span>
                <span className="text-[10px] font-black uppercase opacity-30">Global Nodes: 12</span>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="flex -space-x-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-8 w-8 rounded-full border-2 border-background bg-slate-800 shadow-lg overflow-hidden flex items-center justify-center text-[8px] font-bold text-white/40">U{i}</div>
                ))}
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground cursor-help hover:text-foreground transition-colors">
                Trusted by 400+ Teams
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Global CSS Inject */}
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes slow-spin { 
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes reverse-spin { 
          from { rotate: 360deg; }
          to { rotate: 0deg; }
        }
        .animate-slow-spin { animation: slow-spin 40s linear infinite; }
        .animate-reverse-spin { animation: reverse-spin 25s linear infinite; }
        
        /* Smooth Scrolling */
        html { scroll-behavior: smooth; }
        
        /* Selection Color */
        ::selection {
          background: hsl(var(--primary) / 0.3);
          color: inherit;
        }
      `}} />
    </div>
  )
}
