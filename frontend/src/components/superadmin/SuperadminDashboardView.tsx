import { BarChart3, Users, Database, HardDrive, Bot, FileText } from 'lucide-react'

import type { SuperadminDashboard } from '@/lib/api'
import { PLAN_LABELS, formatBytes } from './constants'

type Props = {
  dashboard: SuperadminDashboard
}

export function SuperadminDashboardView({ dashboard }: Props) {
  const totalOrgs = Math.max(1, dashboard.totals.orgs || 1)
  const cards = [
    { label: 'Организаций', value: dashboard.totals.orgs, icon: BarChart3 },
    { label: 'Пользователей', value: dashboard.totals.users, icon: Users },
    { label: 'Таблиц', value: dashboard.totals.tables, icon: Database },
    { label: 'Записей', value: dashboard.totals.records, icon: FileText },
    { label: 'Файлов', value: dashboard.totals.files, icon: HardDrive },
    { label: 'AI токенов', value: dashboard.totals.ai_tokens, icon: Bot },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <c.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold">{Number(c.value || 0).toLocaleString('ru-RU')}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold mb-4">Организации по тарифам</h3>
          {dashboard.orgs_by_plan.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          ) : (
            <div className="space-y-3">
              {dashboard.orgs_by_plan.map((p) => (
                <div key={p.plan} className="flex items-center gap-3">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-secondary/50 border border-border">
                    {PLAN_LABELS[p.plan] || p.plan}
                  </span>
                  <div className="flex-1 bg-secondary/50 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{ width: `${Math.min(100, (p.count / totalOrgs) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold w-10 text-right">{p.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold mb-4">Регистрации (30 дней)</h3>
          {dashboard.registrations_timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {(() => {
                const max = Math.max(...dashboard.registrations_timeline.map((r) => r.count), 1)
                return dashboard.registrations_timeline.slice(-30).map((r, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full rounded-t bg-primary/60 hover:bg-primary"
                      style={{ height: `${Math.max(4, (r.count / max) * 100)}%` }}
                    />
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-popover border border-border rounded px-1.5 py-0.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100">
                      {r.date}: {r.count}
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
          <div className="mt-3 text-xs text-muted-foreground">
            Хранилище: {formatBytes(dashboard.totals.storage_bytes || 0)}
          </div>
        </div>
      </div>
    </div>
  )
}

