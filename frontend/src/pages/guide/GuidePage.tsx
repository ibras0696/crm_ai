import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  Bot,
  Calendar,
  CheckCircle2,
  CreditCard,
  Database,
  FileText,
  FolderKanban,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Search,
  Shield,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type RouteRef = {
  label: string
  to?: string
}

type Capability = {
  id: string
  title: string
  subtitle: string
  icon: LucideIcon
  roles: string[]
  features: string[]
  workflow: string[]
  where: RouteRef[]
  notes: string[]
}

type Scenario = {
  title: string
  goal: string
  steps: string[]
}

type FaqItem = {
  q: string
  a: string
}

const CHECKLIST_STORAGE_KEY = 'crm.guide.quickstart.v2'

const QUICK_START_STEPS = [
  'Зарегистрируйте организацию и завершите вход владельцем.',
  'Добавьте участников в раздел Команда и назначьте роли.',
  'Проверьте доступы: owner/admin/manager/employee на тестовом сценарии.',
  'Создайте базовые таблицы процесса: Лиды, Сделки, Задачи.',
  'Сделайте 1-2 сохраненных представления (например: “Мои сделки”, “Просроченные”).',
  'Подготовьте в Документах папки и шаблоны КП/договоров.',
  'Создайте страницу onboarding в Базе знаний.',
  'Подключите расписание для планерок и дедлайнов.',
  'Соберите первый дашборд KPI в Аналитике.',
  'Проверьте AI-агента на сценариях “создай документ” и “построй отчет”.',
  'Проверьте лимиты и статус подписки в Биллинге.',
]

const PLATFORM_FLOW = [
  'Пользователь проходит авторизацию и попадает в организацию.',
  'Роли и ACL определяют, какие разделы и действия ему доступны.',
  'Операционные данные хранятся в Таблицах (ядро CRM).',
  'Документы и База знаний используют данные процесса для шаблонов и регламентов.',
  'Чат и Расписание дают ежедневный операционный контур команды.',
  'Аналитика строится на данных таблиц и показывает KPI.',
  'AI-агент ускоряет действия: создание таблиц/документов/событий/дашбордов.',
  'Биллинг управляет лимитами, а Админ/Аудит фиксируют контроль и безопасность.',
]

const CAPABILITIES: Capability[] = [
  {
    id: 'auth',
    title: 'Аутентификация И Онбординг',
    subtitle: 'Регистрация, вход, приглашения, восстановление доступа.',
    icon: KeyRound,
    roles: ['Все пользователи'],
    features: [
      'Регистрация новой организации и первого владельца.',
      'Логин по email/паролю и обновление сессий.',
      'Приглашение сотрудников и принятие invite-токена.',
      'Восстановление и сброс пароля.',
      'Публичные страницы для юридического контента и лендинга.',
    ],
    workflow: [
      'Пользователь создает аккаунт или принимает приглашение.',
      'Система валидирует токен, роль и принадлежность к org.',
      'После входа пользователь получает доступ в AppLayout.',
      'При проблемах доступа используются recovery-механизмы.',
    ],
    where: [
      { label: 'Вход', to: '/login' },
      { label: 'Регистрация', to: '/register' },
      { label: 'Принятие инвайта', to: '/auth/accept-invite' },
      { label: 'Сброс пароля', to: '/auth/forgot-password' },
    ],
    notes: [
      'Убедитесь, что у owner включен безопасный пароль и актуальный email.',
      'Если сотрудник не может зайти, сначала проверьте invite-статус и роль.',
    ],
  },
  {
    id: 'team',
    title: 'Организация И Команда',
    subtitle: 'Участники, роли, базовые настройки рабочей организации.',
    icon: Users,
    roles: ['Owner', 'Admin'],
    features: [
      'Просмотр состава команды и ролей.',
      'Добавление участников через инвайты.',
      'Управление ролями и организационными параметрами.',
      'Настройки профиля и параметров организации.',
    ],
    workflow: [
      'Owner/Admin формирует команду и назначает роли.',
      'Каждая роль получает свой уровень доступа в модулях.',
      'Изменения прав сразу влияют на доступ к данным и действиям.',
    ],
    where: [
      { label: 'Команда', to: '/members' },
      { label: 'Настройки', to: '/settings' },
    ],
    notes: [
      'Роли назначайте по принципу минимально необходимого доступа.',
      'Периодически проводите ревизию ролей после кадровых изменений.',
    ],
  },
  {
    id: 'access',
    title: 'RBAC/ACL И Безопасность',
    subtitle: 'Контроль действий пользователей и изоляция данных по tenant.',
    icon: Shield,
    roles: ['Owner', 'Admin', 'Security'],
    features: [
      'Проверка прав по ресурсам и операциям.',
      'Тенант-изоляция данных организации.',
      'Безопасные cookies/сессии, JWT-контуры.',
      'Ограничения доступа к критичным операциям.',
    ],
    workflow: [
      'Каждый запрос проверяется по текущей роли и политике.',
      'Доступ к ресурсам разрешается только в рамках org_id пользователя.',
      'Несоответствия прав отклоняются до выполнения бизнес-операции.',
    ],
    where: [
      { label: 'Админ-панель', to: '/admin' },
      { label: 'Журнал аудита', to: '/audit' },
    ],
    notes: [
      'Не выдавайте owner/admin без необходимости.',
      'Проверяйте права после внедрения новых модулей и интеграций.',
    ],
  },
  {
    id: 'dashboard',
    title: 'Главная Панель',
    subtitle: 'Сводная точка контроля состояния организации и ресурсов.',
    icon: LayoutDashboard,
    roles: ['Owner', 'Admin', 'Manager'],
    features: [
      'Сводные карточки по команде, таблицам, файлам и подписке.',
      'Быстрые переходы к ключевым разделам.',
      'Оперативный контроль статуса текущего контура.',
    ],
    workflow: [
      'Панель читает агрегаты из модулей и биллинга.',
      'Показывает состояние ресурсов и дает быстрый drill-down.',
      'Используется как ежедневная стартовая точка руководителя.',
    ],
    where: [{ label: 'Главная', to: '/dashboard' }],
    notes: ['Используйте панель как “утренний чек” перед началом дня.'],
  },
  {
    id: 'tables',
    title: 'Таблицы И Записи',
    subtitle: 'Ядро CRM-данных: структуры, поля, записи, массовые операции.',
    icon: Database,
    roles: ['Owner', 'Admin', 'Manager', 'Employee (по правам)'],
    features: [
      'Создание таблиц и колонок под бизнес-процесс.',
      'Работа с записями, редактирование и массовые действия.',
      'Серверная фильтрация/сортировка/пагинация.',
      'Импорт/экспорт данных, views и рабочие представления.',
      'Продвинутые функции: relation/lookup/rollup/formulas/history (по roadmap/реализации).',
    ],
    workflow: [
      'Определяете сущности (например: Сделки/Контакты).',
      'Создаете поля и правила отображения.',
      'Команда заполняет и обновляет записи в ежедневной работе.',
      'На этих данных строятся документы, аналитика и AI-действия.',
    ],
    where: [
      { label: 'Список таблиц', to: '/tables' },
      { label: 'Карточка таблицы', to: '/tables/:tableId' },
    ],
    notes: [
      'Сначала проектируйте структуру данных, потом масштабируйте импорт.',
      'Для больших объемов всегда используйте серверные запросы и сохраненные views.',
    ],
  },
  {
    id: 'docs',
    title: 'Документы',
    subtitle: 'Файлы, папки, генерация через AI, редактор и версионный контур.',
    icon: FileText,
    roles: ['Owner', 'Admin', 'Manager', 'Employee (по правам)'],
    features: [
      'Хранение документов в иерархии папок.',
      'Создание через AI (DOCX/PDF/TXT в рамках доступного контура).',
      'Интеграция редактора и callbacks для обновлений.',
      'Загрузка файлов, безопасность контента и ограничения MIME/size.',
    ],
    workflow: [
      'Пользователь формирует задачу на документ (вручную или через AI).',
      'Сервис ставит генерацию в очередь и сохраняет мета-информацию.',
      'После генерации файл доступен в дереве документов и для дальнейшего редактирования.',
    ],
    where: [{ label: 'Документы', to: '/docs' }],
    notes: [
      'Для типовых документов создайте стандартизованные шаблоны.',
      'Если AI-генерация в очереди, отслеживайте статус job, не дублируйте запросы.',
    ],
  },
  {
    id: 'knowledge',
    title: 'База Знаний',
    subtitle: 'Регламенты, SOP, инструкции, onboarding и внутренние стандарты.',
    icon: BookOpen,
    roles: ['Owner', 'Admin', 'Manager', 'Employee (read/write по правам)'],
    features: [
      'Страницы знаний и иерархия контента.',
      'Редактирование и структурирование рабочих инструкций.',
      'Использование как внутреннего источника истины для команды.',
    ],
    workflow: [
      'Команда фиксирует процессы в статье, а не в личных чатах.',
      'Новые сотрудники проходят onboarding по готовым страницам.',
      'AI и операторы используют статьи как reference-контур.',
    ],
    where: [{ label: 'База знаний', to: '/knowledge' }],
    notes: [
      'Каждый ключевой процесс должен иметь страницу в KB.',
      'Обновляйте страницы при каждом изменении рабочего регламента.',
    ],
  },
  {
    id: 'chat',
    title: 'Командный Чат',
    subtitle: 'Оперативная коммуникация, вложения и рабочая синхронизация.',
    icon: MessageSquare,
    roles: ['Owner', 'Admin', 'Manager', 'Employee'],
    features: [
      'Личные и групповые чаты.',
      'Сообщения, статусы чтения, typing-presence.',
      'Вложения и контроль очистки orphan-файлов.',
    ],
    workflow: [
      'Создаются рабочие каналы по функциям или проектам.',
      'Команда ведет коммуникацию и прикладывает артефакты задачи.',
      'Система хранит историю для операционной прозрачности.',
    ],
    where: [{ label: 'Чат', to: '/chat' }],
    notes: [
      'Фиксируйте решения в Базе знаний, чат используйте для операционной коммуникации.',
    ],
  },
  {
    id: 'schedule',
    title: 'Расписание',
    subtitle: 'События, повторения, напоминания и календарное планирование.',
    icon: Calendar,
    roles: ['Owner', 'Admin', 'Manager', 'Employee'],
    features: [
      'Создание событий и регулярных повторений.',
      'Поддержка напоминаний и цветовой маркировки.',
      'Календарное управление рабочим ритмом команды.',
    ],
    workflow: [
      'Руководитель/сотрудник создает событие со сроком.',
      'Система хранит расписание и напоминания.',
      'Команда получает единый таймлайн ключевых активностей.',
    ],
    where: [{ label: 'Расписание', to: '/schedule' }],
    notes: ['Планерки и review встречи сразу заносите как recurring events.'],
  },
  {
    id: 'analytics',
    title: 'Аналитика И Дашборды',
    subtitle: 'KPI, воронка, метрики производительности и контроль динамики.',
    icon: BarChart3,
    roles: ['Owner', 'Admin', 'Manager'],
    features: [
      'Конструктор дашбордов с виджетами.',
      'Визуализация метрик по таблицам и фильтрам.',
      'Сохранение аналитического представления для регулярного мониторинга.',
    ],
    workflow: [
      'Выбираете таблицу-источник и задаете метрики.',
      'Настраиваете фильтры периода/ответственного/статуса.',
      'Используете дашборд как основу еженедельного review.',
    ],
    where: [{ label: 'Аналитика v2', to: '/reports-v2' }],
    notes: [
      'Не перегружайте один дашборд десятками виджетов: лучше 2-3 целевых экрана.',
    ],
  },
  {
    id: 'ai',
    title: 'AI Агент',
    subtitle: 'Управляемые действия AI по модулям: документы, таблицы, расписание, аналитика.',
    icon: Bot,
    roles: ['Owner', 'Admin', 'Manager', 'Employee (по политике)'],
    features: [
      'Чат с контекстом таблиц/KB/расписания.',
      'Action-модель с контролируемыми командами (`crm_action`).',
      'UI-intent и fallback-логика для предсказуемых действий.',
      'Лимиты токенов, usage-статистика и billing-интеграция.',
      'Идемпотентность запросов по `request_id` для защиты от дублей.',
    ],
    workflow: [
      'Пользователь формулирует задачу и при необходимости выбирает intent.',
      'Система строит контекст, проверяет лимиты и вызывает провайдера.',
      'Если модель вернула валидное действие, оно исполняется в рамках прав.',
      'Результат сохраняется в истории чата и логах использования.',
    ],
    where: [{ label: 'AI Агент', to: '/ai' }],
    notes: [
      'Для действий пишите явно: что создать, где, и какой ожидаемый результат.',
      'Если AI “заявил выполнено”, но action невалиден, система не должна молча применять изменения.',
    ],
  },
  {
    id: 'billing',
    title: 'Биллинг И Лимиты',
    subtitle: 'Подписки, токены, lifecycle подписки и финансовый контроль.',
    icon: CreditCard,
    roles: ['Owner', 'Admin'],
    features: [
      'Управление подпиской и тарифом.',
      'Контроль лимитов по участникам/таблицам/ресурсам.',
      'Токен-кошелек AI и расход по usage.',
      'Webhook/payment status контур с идемпотентностью платежей.',
    ],
    workflow: [
      'Организация выбирает план и оплачивает подписку.',
      'Система отражает статус периода и применяет лимиты.',
      'При изменении статуса подписки пересчитываются доступные возможности.',
    ],
    where: [
      { label: 'Биллинг', to: '/billing' },
      { label: 'Тарифы', to: '/plans' },
    ],
    notes: [
      'Следите за предупреждениями до expiry, чтобы избежать деградации процессов.',
      'Платежные события должны проходить через идемпотентную обработку.',
    ],
  },
  {
    id: 'admin',
    title: 'Админ-Панель И Аудит',
    subtitle: 'Контроль изменений, безопасность и операционная дисциплина.',
    icon: Wrench,
    roles: ['Owner', 'Admin'],
    features: [
      'Системные настройки рабочего контура.',
      'Просмотр аудита действий.',
      'Контроль критичных операций и правил доступа.',
    ],
    workflow: [
      'Администратор настраивает политики и проверяет события.',
      'Журнал аудита используется для расследований и прозрачности.',
      'Критичные изменения проводятся по согласованной процедуре.',
    ],
    where: [
      { label: 'Админ-панель', to: '/admin' },
      { label: 'Журнал', to: '/audit' },
    ],
    notes: [
      'Все массовые изменения фиксируйте через audit-ready процесс.',
    ],
  },
  {
    id: 'superadmin',
    title: 'Суперадмин Контур',
    subtitle: 'Кросс-организационное управление платформой и runtime-конфигами.',
    icon: UserCog,
    roles: ['Superadmin'],
    features: [
      'Управление организациями и пользователями верхнего уровня.',
      'Глобальные настройки AI-провайдера и runtime-параметров.',
      'Платформенный аудит и контроль эксплуатационных операций.',
    ],
    workflow: [
      'Суперадмин наблюдает платформу на уровне всех tenant.',
      'При необходимости меняет глобальные параметры и политики.',
      'Проверяет здоровье и консистентность ключевых модулей.',
    ],
    where: [{ label: 'Суперадмин', to: '/superadmin' }],
    notes: [
      'Доступ к суперадмину должен быть ограничен и логироваться отдельно.',
    ],
  },
  {
    id: 'integration',
    title: 'Инфраструктура И Интеграции',
    subtitle: 'Compose-окружение, storage, очереди и фоновые задачи.',
    icon: FolderKanban,
    roles: ['DevOps', 'Owner', 'Tech Admin'],
    features: [
      'Backend: FastAPI + SQLAlchemy + Alembic + Celery.',
      'Frontend: React + TypeScript + Vite.',
      'Инфра: PostgreSQL, Redis, RabbitMQ, MinIO, OnlyOffice.',
      'Локальный запуск через Docker Compose и make-команды.',
    ],
    workflow: [
      'Сервисы поднимаются compose-стеком.',
      'API/worker взаимодействуют через DB, cache и очередь задач.',
      'Файлы хранятся в S3-совместимом хранилище, документы обрабатываются отдельным контуром.',
    ],
    where: [
      { label: 'README проекта' },
      { label: 'docker-compose + make scripts' },
    ],
    notes: [
      'Прод-конфиг должен идти через env и secrets, не через hardcoded значения.',
      'Перед релизом проверяйте миграции, health/readiness и тесты.',
    ],
  },
]

const SCENARIOS: Scenario[] = [
  {
    title: 'Запуск Отдела Продаж',
    goal: 'С нуля собрать рабочий CRM-контур для лидов и сделок.',
    steps: [
      'Создать таблицы: Лиды, Сделки, Активности.',
      'Подключить шаблоны КП в Документах.',
      'Сделать weekly dashboard по воронке в Аналитике.',
      'Назначить роли manager/employee и закрепить ответственность.',
    ],
  },
  {
    title: 'Онбординг Нового Сотрудника',
    goal: 'Сократить время адаптации и ошибки в первые недели.',
    steps: [
      'Создать статью onboarding в Базе знаний.',
      'Выдать доступы по роли и добавить в рабочие чаты.',
      'Назначить задачи onboarding в таблице.',
      'Проверить прогресс на планерках через Расписание.',
    ],
  },
  {
    title: 'Переход На Управление По KPI',
    goal: 'Управлять командой через метрики, а не через субъективные оценки.',
    steps: [
      'Определить ключевые KPI и источники данных в таблицах.',
      'Собрать дашборд руководителя.',
      'Зафиксировать регулярный review в календаре.',
      'Привязать решения к цифрам и зафиксировать в KB.',
    ],
  },
  {
    title: 'Контроль Качества Документооборота',
    goal: 'Снизить хаос в файлах и ускорить выпуск документов.',
    steps: [
      'Создать структуру папок и правила именования.',
      'Вынести шаблоны в единый стандарт.',
      'Использовать AI только с явным prompt и проверкой результата.',
      'Фиксировать важные версии и причины изменений.',
    ],
  },
]

const FAQ: FaqItem[] = [
  {
    q: 'С чего реально начинать внедрение?',
    a: 'С ролей доступа и структуры таблиц. Это база, от которой зависят все остальные модули.',
  },
  {
    q: 'Почему у сотрудника не виден нужный раздел?',
    a: 'Проверьте роль, ACL-права и принадлежность к организации. Обычно проблема в политике доступа.',
  },
  {
    q: 'Где лучше хранить регламенты: в чате или в базе знаний?',
    a: 'Только в Базе знаний. Чат — для оперативки, KB — для стабильных правил процесса.',
  },
  {
    q: 'Как избежать дублей и случайных изменений через AI?',
    a: 'Используйте явные формулировки, проверяйте action-preview и работайте с idempotency request_id.',
  },
  {
    q: 'Как понять, что пора повышать тариф?',
    a: 'Следите за лимитами в биллинге: участники, таблицы, токены AI, объем файлов.',
  },
  {
    q: 'Кто отвечает за безопасность и аудит?',
    a: 'Owner/Admin: контроль ролей, аудит критичных действий и регламент изменений.',
  },
]

function loadChecklistState(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CHECKLIST_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, boolean>
  } catch {
    return {}
  }
}

function persistChecklistState(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

function renderRoute(route: RouteRef) {
  if (!route.to) {
    return <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">{route.label}</span>
  }
  return (
    <Link to={route.to} className="rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-secondary">
      {route.label}
    </Link>
  )
}

export default function GuidePage() {
  const [search, setSearch] = useState('')
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setChecklistState(loadChecklistState())
  }, [])

  const completedSteps = QUICK_START_STEPS.reduce((acc, _step, index) => (
    checklistState[String(index)] ? acc + 1 : acc
  ), 0)

  const progress = Math.round((completedSteps / Math.max(1, QUICK_START_STEPS.length)) * 100)

  const filteredCapabilities = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return CAPABILITIES
    return CAPABILITIES.filter((cap) => {
      const haystack = [
        cap.title,
        cap.subtitle,
        ...cap.roles,
        ...cap.features,
        ...cap.workflow,
        ...cap.notes,
        ...cap.where.map((w) => w.label),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [search])

  const toggleStep = (index: number) => {
    setChecklistState((prev) => {
      const key = String(index)
      const next = { ...prev, [key]: !prev[key] }
      persistChecklistState(next)
      return next
    })
  }

  const resetChecklist = () => {
    setChecklistState({})
    persistChecklistState({})
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <CardTitle className="text-2xl">Полное Руководство По Платформе</CardTitle>
              <CardDescription className="mt-1 text-sm">
                Подробное описание всех возможностей CRM: что умеет каждый раздел, как он работает, кто им пользуется
                и где это находится в интерфейсе.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Полный охват модулей</Badge>
              <Badge variant="outline">Owner/Admin/Manager/Employee</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
              <a href="#guide-start" className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/40">Быстрый старт</a>
              <a href="#guide-flow" className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/40">Как всё связано</a>
              <a href="#guide-capabilities" className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/40">Все возможности</a>
              <a href="#guide-scenarios" className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/40">Сценарии</a>
              <a href="#guide-faq" className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary/40">FAQ</a>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Поиск по возможностям, ролям, шагам и разделам..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <section id="guide-start">
        <Card className="border-border/60">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-xl">Быстрый Старт Внедрения</CardTitle>
                <CardDescription>Чеклист, чтобы запустить платформу без хаоса и пропущенных шагов.</CardDescription>
              </div>
              <Badge variant="secondary">{completedSteps}/{QUICK_START_STEPS.length}</Badge>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {QUICK_START_STEPS.map((step, index) => {
              const checked = checklistState[String(index)] === true
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => toggleStep(index)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                    checked ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-secondary/30',
                  )}
                >
                  <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', checked ? 'text-primary' : 'text-muted-foreground')} />
                  <span className={cn('text-sm', checked && 'line-through text-muted-foreground')}>{step}</span>
                </button>
              )
            })}
            <div className="pt-2">
              <Button variant="ghost" size="sm" onClick={resetChecklist}>Сбросить чеклист</Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section id="guide-flow">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-xl">Как Платформа Работает Целиком</CardTitle>
            <CardDescription>Сквозной поток от входа пользователя до управленческих решений.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {PLATFORM_FLOW.map((step, index) => (
              <div key={step} className="flex gap-3 rounded-lg border border-border px-3 py-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {index + 1}
                </span>
                <p className="text-sm text-muted-foreground">{step}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section id="guide-capabilities" className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Полное Описание Возможностей</h2>
          <p className="text-sm text-muted-foreground">
            Здесь по каждому разделу: функционал, принцип работы, точки входа в интерфейсе и рабочие нюансы.
          </p>
        </div>

        {filteredCapabilities.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              По вашему запросу ничего не найдено. Попробуйте: таблицы, AI, документы, биллинг, роли.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredCapabilities.map((capability, index) => (
              <details
                key={capability.id}
                open={index === 0}
                className="rounded-xl border border-border bg-card group"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-lg bg-secondary p-2">
                      <capability.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{capability.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{capability.subtitle}</p>
                    </div>
                  </div>
                  <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>

                <div className="space-y-4 border-t border-border px-4 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {capability.roles.map((role) => (
                      <Badge key={role} variant="secondary" className="text-[11px]">{role}</Badge>
                    ))}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div>
                      <p className="mb-1 text-sm font-semibold">Что умеет</p>
                      <div className="space-y-1.5">
                        {capability.features.map((feature) => (
                          <p key={feature} className="text-sm text-muted-foreground">• {feature}</p>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1 text-sm font-semibold">Как работает</p>
                      <div className="space-y-1.5">
                        {capability.workflow.map((step, stepIndex) => (
                          <p key={step} className="text-sm text-muted-foreground">
                            {stepIndex + 1}. {step}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-semibold">Где в интерфейсе</p>
                    <div className="flex flex-wrap gap-1.5">
                      {capability.where.map((route) => (
                        <span key={`${capability.id}-${route.label}`}>{renderRoute(route)}</span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-semibold">Важные нюансы</p>
                    <div className="space-y-1.5">
                      {capability.notes.map((note) => (
                        <p key={note} className="text-sm text-muted-foreground">• {note}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section id="guide-scenarios" className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold">Типовые Сценарии Использования</h2>
          <p className="text-sm text-muted-foreground">Готовые контуры, которые чаще всего внедряют команды.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {SCENARIOS.map((scenario) => (
            <Card key={scenario.title} className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base">{scenario.title}</CardTitle>
                <CardDescription>{scenario.goal}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {scenario.steps.map((step) => (
                  <p key={step} className="text-sm text-muted-foreground">• {step}</p>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="guide-faq">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-xl">FAQ И Диагностика</CardTitle>
            <CardDescription>Быстрые ответы на частые вопросы при работе по всей платформе.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-lg border border-border px-3 py-2 group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                  <span>{item.q}</span>
                  <HelpCircle className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
