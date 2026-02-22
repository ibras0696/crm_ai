import { Link } from 'react-router-dom'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  FileText, BookOpen, Calendar, BarChart3, Brain, Users,
  Shield, Zap, ArrowRight, Sun, Moon, CheckCircle,
  Globe, Sparkles,
} from 'lucide-react'

const features = [
  {
    icon: FileText,
    title: 'Таблицы',
    desc: 'Конструктор таблиц с гибкой схемой — текст, числа, связи, формулы. Виды: таблица, канбан, календарь.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: BookOpen,
    title: 'База знаний',
    desc: 'Корпоративная вики с блочным редактором. Вложенные страницы, шаблоны, полнотекстовый поиск.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
  },
  {
    icon: Calendar,
    title: 'Расписание',
    desc: 'Планировщик задач и событий. Календарь, дедлайны, назначение исполнителей, напоминания.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: BarChart3,
    title: 'Отчёты',
    desc: 'Автоматические дашборды и графики по данным таблиц. Экспорт в PDF и Excel.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    icon: Brain,
    title: 'AI Агент — Grok',
    desc: 'Интеллектуальный помощник на базе Grok (xAI). Анализ данных, генерация контента, автоматизация.',
    color: 'text-pink-400',
    bg: 'bg-pink-500/10',
  },
  {
    icon: Users,
    title: 'Команда',
    desc: 'Мультитенантная архитектура. Роли, приглашения, разграничение доступа (RBAC).',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
]

const examples = [
  { title: 'CRM для продаж', desc: 'Воронки сделок, контакты, задачи менеджеров — всё в одном месте' },
  { title: 'Управление проектами', desc: 'Канбан-доски, дедлайны, отчёты по загрузке команды' },
  { title: 'HR-платформа', desc: 'База сотрудников, onboarding-чеклисты, расписание собеседований' },
  { title: 'База знаний компании', desc: 'Документация, регламенты, FAQ — с поиском и AI-саммари' },
]

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 md:px-6 h-14 md:h-16">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <span className="text-sm font-bold text-white">C</span>
            </div>
            <span className="text-lg font-bold">CRM Платформа</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <Link to="/login">
              <Button variant="ghost" className="text-sm">Войти</Button>
            </Link>
            <Link to="/register">
              <Button className="gradient-primary border-0 text-white text-sm">
                Начать бесплатно
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 pt-16 md:pt-24 pb-16">
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm text-primary">
            <Sparkles className="h-4 w-4" />
            Новое поколение бизнес-инструментов
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight">
            Всё для бизнеса —{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
              в одной платформе
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Таблицы, база знаний, расписание, отчёты и AI-агент на базе Grok — 
            замените 5 инструментов одним. Старт за 30 секунд.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Link to="/register">
              <Button size="lg" className="gradient-primary border-0 text-white px-8 h-12 text-base">
                Создать аккаунт бесплатно
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="px-8 h-12 text-base">
                Войти в систему
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 pb-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold">Мощные модули для любых задач</h2>
          <p className="text-muted-foreground mt-2">Каждый модуль работает отдельно и в связке с остальными</p>
        </div>
        <div className="grid gap-4 md:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="border-border/50 hover:border-border transition-colors group">
              <CardContent className="p-6 space-y-3">
                <div className={`rounded-lg p-2.5 w-fit ${f.bg}`}>
                  <f.icon className={`h-6 w-6 ${f.color}`} />
                </div>
                <h3 className="font-semibold text-lg">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Use Cases / Examples */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 pb-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold">Примеры использования</h2>
          <p className="text-muted-foreground mt-2">Адаптируется под любой бизнес-процесс</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {examples.map((ex) => (
            <div key={ex.title} className="rounded-xl border border-border/50 bg-secondary/20 p-6 hover:bg-secondary/30 transition-colors">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <h4 className="font-semibold">{ex.title}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{ex.desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / Tech */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 pb-16">
        <div className="rounded-2xl border border-border/50 bg-secondary/10 p-8 md:p-12">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-blue-500/10 p-3 shrink-0">
                <Shield className="h-6 w-6 text-blue-400" />
              </div>
              <div>
                <h4 className="font-semibold">Безопасность</h4>
                <p className="text-sm text-muted-foreground mt-1">JWT-авторизация, RBAC, аудит-лог всех действий, изоляция данных организаций</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-purple-500/10 p-3 shrink-0">
                <Globe className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <h4 className="font-semibold">Мультитенантность</h4>
                <p className="text-sm text-muted-foreground mt-1">Каждая организация — изолированное пространство с собственными данными и настройками</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-emerald-500/10 p-3 shrink-0">
                <Zap className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <h4 className="font-semibold">Производительность</h4>
                <p className="text-sm text-muted-foreground mt-1">FastAPI + PostgreSQL + Redis. Асинхронная архитектура для максимальной скорости</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 md:px-6 pb-20">
        <div className="text-center space-y-6 rounded-2xl gradient-primary p-10 md:p-16">
          <h2 className="text-2xl md:text-4xl font-bold text-white">Начните прямо сейчас</h2>
          <p className="text-white/80 max-w-lg mx-auto">
            Создайте организацию, пригласите команду и настройте рабочее пространство за минуту. Бесплатно.
          </p>
          <Link to="/register">
            <Button size="lg" className="bg-white text-gray-900 hover:bg-gray-100 px-10 h-12 text-base font-semibold mt-4">
              Создать аккаунт
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 md:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md gradient-primary">
              <span className="text-xs font-bold text-white">C</span>
            </div>
            <span className="text-sm font-semibold">CRM Платформа</span>
          </div>
          <p className="text-xs text-muted-foreground">&copy; 2026 CRM Платформа. Все права защищены.</p>
        </div>
      </footer>
    </div>
  )
}
