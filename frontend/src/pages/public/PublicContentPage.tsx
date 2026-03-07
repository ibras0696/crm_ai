import { Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'

import { publicPageContent } from '@/lib/publicPageContent'

export default function PublicContentPage() {
  const location = useLocation()
  const page = publicPageContent[location.pathname.slice(1)]

  if (!page) {
    return <Navigate to="/landing" replace />
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.16),transparent_30%),#020617] text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-10 md:px-8 md:py-16">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/landing"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            На главную
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-xs font-black uppercase tracking-[0.24em] text-cyan-300">
            <Sparkles className="h-3.5 w-3.5" />
            {page.eyebrow}
          </div>
        </div>

        <section className="grid gap-8 md:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <h1 className="max-w-4xl text-4xl font-black tracking-tight md:text-6xl">{page.title}</h1>
            <p className="max-w-3xl text-lg leading-8 text-white/70 md:text-xl">{page.description}</p>
          </div>
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Статус страницы</div>
            <p className="mt-4 text-sm leading-7 text-white/70">
              Здесь собрана основная информация о продукте. При необходимости страницу можно дополнить реальными
              контактами, юридическими данными, кейсами или более подробным описанием сервиса.
            </p>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          {page.sections.map((section) => (
            <article
              key={section.heading}
              className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_60px_-32px_rgba(56,189,248,0.35)] backdrop-blur"
            >
              <h2 className="text-lg font-black text-white">{section.heading}</h2>
              <p className="mt-4 text-sm leading-7 text-white/70">{section.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-gradient-to-r from-white/5 to-cyan-400/10 p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">Следующий шаг</div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/70">
                При необходимости любой раздел можно доработать отдельно: усилить тексты, добавить реальные контакты,
                реквизиты, кейсы, FAQ или точные условия использования сервиса.
              </p>
            </div>
            <Link
              to="/landing"
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-300"
            >
              Вернуться к лендингу
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
