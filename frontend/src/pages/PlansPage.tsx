import { Check, X, Zap, Users, Database, Bot, Shield, BarChart2, Lock, RefreshCw } from 'lucide-react'

const FEATURES = [
  {
    category: 'Данные',
    icon: Database,
    rows: [
      { label: 'Участников в организации', free: '10',       team: 'Без ограничений' },
      { label: 'Таблиц',                   free: '10',       team: 'Без ограничений' },
      { label: 'Записей на таблицу',       free: '10 000',   team: 'Без ограничений' },
      { label: 'Хранилище файлов',         free: '500 МБ',   team: 'Без ограничений' },
    ],
  },
  {
    category: 'Функции',
    icon: Zap,
    rows: [
      { label: 'Поиск и фильтрация',       free: true,  team: true },
      { label: 'Сортировка по столбцам',   free: true,  team: true },
      { label: 'Экспорт в CSV',            free: true,  team: true },
      { label: 'Расписание и события',     free: true,  team: true },
      { label: 'Кастомные поля',           free: true,  team: true },
      { label: 'База знаний',              free: true,  team: true },
      { label: 'Уведомления',              free: true,  team: true },
    ],
  },
  {
    category: 'AI агент',
    icon: Bot,
    rows: [
      { label: 'AI агент (чат с данными)', free: false, team: true },
      { label: 'Умный поиск по данным',    free: false, team: true },
    ],
  },
  {
    category: 'Безопасность',
    icon: Shield,
    rows: [
      { label: 'SSL шифрование',           free: true,  team: true },
      { label: 'Аудит действий',           free: true,  team: true },
    ],
  },
]

const PLANS = [
  {
    key: 'free',
    name: 'Бесплатный',
    price: 0,
    desc: 'Для личного использования и небольших команд',
    color: 'text-muted-foreground',
    border: 'border-border',
    bg: 'bg-card',
    badge: '',
    icon: null,
  },
  {
    key: 'team',
    name: 'Команда',
    price: 1490,
    desc: 'Для команд с расширенными возможностями и AI агентом',
    color: 'text-blue-500',
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/5',
    badge: 'Популярный',
    icon: Users,
  },
]

function CellValue({ value }: { value: string | boolean }) {
  if (value === true)  return <Check className="h-4 w-4 text-emerald-500 mx-auto" />
  if (value === false) return <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
  return <span className="text-sm text-center block">{value}</span>
}

export default function PlansPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart2 className="h-6 w-6 text-primary" /> Тарифные планы
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Сравнение возможностей бесплатного и платного тарифов
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        {PLANS.map(plan => (
          <div key={plan.key} className={`rounded-2xl border-2 ${plan.border} ${plan.bg} p-5 relative`}>
            {plan.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold text-white bg-blue-500">
                {plan.badge}
              </div>
            )}
            <div className="flex items-center gap-2 mb-2">
              {plan.icon && <plan.icon className={`h-4 w-4 ${plan.color}`} />}
              <span className={`font-bold text-base ${plan.color}`}>{plan.name}</span>
            </div>
            <p className="text-2xl font-bold mb-0.5">
              {plan.price === 0 ? 'Бесплатно' : `${plan.price.toLocaleString('ru')} ₽`}
            </p>
            {plan.price > 0 && <p className="text-xs text-muted-foreground mb-2">в месяц</p>}
            <p className="text-xs text-muted-foreground mt-2">{plan.desc}</p>
          </div>
        ))}
      </div>

      {/* Feature comparison table */}
      {FEATURES.map(section => {
        const Icon = section.icon
        return (
          <div key={section.category} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-secondary/20 flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{section.category}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground font-medium w-2/3">Функция</th>
                    {PLANS.map(p => (
                      <th key={p.key} className={`px-4 py-2.5 text-center text-xs font-semibold ${p.color} w-[16%]`}>
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, i) => (
                    <tr key={i} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}>
                      <td className="px-4 py-2.5 text-sm">{row.label}</td>
                      <td className="px-4 py-2.5 text-center"><CellValue value={row.free} /></td>
                      <td className="px-4 py-2.5 text-center"><CellValue value={row.team} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {/* Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { icon: RefreshCw, title: 'Смена тарифа', text: 'Вы можете перейти на тариф «Команда» в любой момент. Переход на бесплатный — в конце расчётного периода.' },
          { icon: Lock, title: 'Ваши данные', text: 'При смене тарифа все данные сохраняются. При превышении лимитов новые записи блокируются, существующие остаются.' },
        ].map(item => (
          <div key={item.title} className="rounded-xl border border-border bg-card p-4 flex gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <item.icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-sm mb-0.5">{item.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
