import { useLocation } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { FileText, BookOpen, Calendar, BarChart3, Brain, Construction } from 'lucide-react'

const modules: Record<string, { icon: typeof FileText; title: string; desc: string; features: string[] }> = {
  '/tables': {
    icon: FileText,
    title: 'Таблицы',
    desc: 'Конструктор таблиц с гибкой схемой данных — аналог Airtable. Создавайте кастомные поля, связи между таблицами, формулы и фильтры.',
    features: [
      'Кастомные типы полей (текст, число, дата, выбор, файл, связь)',
      'Множественные виды: таблица, канбан, календарь, галерея',
      'Фильтрация, сортировка и группировка',
      'Импорт/экспорт CSV и Excel',
      'Совместное редактирование в реальном времени',
    ],
  },
  '/knowledge': {
    icon: BookOpen,
    title: 'База знаний',
    desc: 'Корпоративная вики с блочным редактором — аналог Notion. Структурированная документация для всей команды.',
    features: [
      'Блочный редактор с drag & drop',
      'Вложенные страницы и папки',
      'Шаблоны документов',
      'Встраивание таблиц, медиа и кода',
      'Полнотекстовый поиск по всей базе',
    ],
  },
  '/schedule': {
    icon: Calendar,
    title: 'Расписание',
    desc: 'Планировщик задач и событий с интеграцией в календарь. Управление временем команды.',
    features: [
      'Календарь: день, неделя, месяц',
      'Задачи с приоритетами и дедлайнами',
      'Назначение исполнителей',
      'Напоминания и уведомления',
      'Синхронизация с Google Calendar',
    ],
  },
  '/reports': {
    icon: BarChart3,
    title: 'Аналитика',
    desc: 'Дашборды и визуализация данных по таблицам. Следите за ключевыми показателями в одном месте.',
    features: [
      'Графики: линейные, столбчатые, круговые',
      'Автоматическая сводка по данным таблиц',
      'Экспорт в PDF и Excel',
      'Шаблоны аналитики',
      'Расписание автоотправки по email',
    ],
  },
  '/ai': {
    icon: Brain,
    title: 'AI Агент — Grok',
    desc: 'Интеллектуальный помощник на базе Grok AI от xAI. Анализ данных, генерация контента, автоматизация рутины.',
    features: [
      'Чат с AI по данным вашей организации',
      'Автозаполнение полей в таблицах',
      'Генерация отчётов и саммари',
      'Умный поиск по базе знаний',
      'Автоматизация workflow по расписанию',
      'Интеграция с Grok API (xAI)',
    ],
  },
}

export default function ComingSoonPage() {
  const location = useLocation()
  const mod = modules[location.pathname] || {
    icon: Construction,
    title: 'Модуль',
    desc: 'Этот модуль находится в разработке.',
    features: [],
  }

  const Icon = mod.icon

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-primary/10 p-3">
          <Icon className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{mod.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">
              <Construction className="h-3 w-3" />
              В разработке
            </span>
          </div>
        </div>
      </div>

      <p className="text-muted-foreground text-base leading-relaxed">{mod.desc}</p>

      {mod.features.length > 0 && (
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Что будет доступно
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {mod.features.map((f, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg bg-secondary/30 p-3">
                  <div className="mt-0.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                  <span className="text-sm">{f}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {location.pathname === '/ai' && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-3">
              <Brain className="h-6 w-6 text-primary" />
              <h3 className="font-semibold">Powered by Grok (xAI)</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-модуль будет использовать Grok API от xAI для интеллектуального анализа данных, 
              генерации контента и автоматизации бизнес-процессов. Доступно на платном тарифе.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
