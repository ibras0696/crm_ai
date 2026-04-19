export type LandingLocale = 'ru' | 'en'

export interface LandingNavItem {
  label: string
  href: string
}

export interface LandingFooterSection {
  title: string
  items: Array<{ label: string; to: string }>
}

export interface LandingContent {
  cursor: {
    label: string
    names: string[]
  }
  header: {
    nav: LandingNavItem[]
    login: string
    start: string
    languageLabel: string
  }
  hero: {
    badge: string
    titleLead: string
    titleAccent: string
    description: string
    cta: string
  }
  showcase: {
    title: string
    tabs: {
      tables: string
      ai: string
      docs: string
      kb: string
      dash: string
      chat: string
      soon: string
    }
    searchPlaceholder: string
    tables: {
      title: string
      addDeal: string
      headers: string[]
      rows: Array<{
        project: string
        status: string
        value: string
        priority: string
      }>
      managerLabel: string
    }
    ai: {
      title: string
      subtitle: string
      question: string
      answer: string
      inputPlaceholder: string
      insightTitle: string
      insightText: string
      recentTasks: string
    }
    docs: {
      title: string
      pdfExport: string
      save: string
      documentTitle: string
      documentBody: string
      dropTitle: string
      sideA: string
      sideB: string
    }
    knowledge: {
      navTitle: string
      navItems: string[]
      title: string
      badgePrimary: string
      badgeSecondary: string
      lead: string
      stageOneTitle: string
      stageOneText: string
      stageTwoTitle: string
      stageTwoText: string
    }
    analytics: {
      title: string
      periodCurrentMonth: string
      periodQuarter: string
      stats: Array<{ label: string; value: string; delta: string }>
      deltaSuffix: string
      teamActivity: string
      leadDistribution: string
      reach: string
      weekdays: string[]
    }
    chat: {
      title: string
      description: string
      releaseBadge: string
    }
  }
  modules: {
    badge: string
    title: string
    subtitle: string
    cards: Array<{
      title: string
      desc: string
    }>
  }
  ecosystem: {
    title: string
    subtitle: string
    cards: Array<{
      title: string
      desc: string
    }>
  }
  cta: {
    title: string
    subtitle: string
    button: string
  }
  footer: {
    tagline: string
    sections: LandingFooterSection[]
    copyrights: string
    systemOnline: string
    globalNodes: string
    trustedBy: string
  }
}

export const LANDING_CONTENT: Record<LandingLocale, LandingContent> = {
  ru: {
    cursor: {
      label: 'Стиль курсора',
      names: [
        'Мягкое свечение',
        'Шлейф',
        'Орбиты',
        'Сканер',
        'Поток данных',
        'Пульсация',
        'Искры',
        'Границы',
        'Неон',
        'Частицы',
      ],
    },
    header: {
      nav: [
        { label: 'Возможности', href: '#features' },
        { label: 'Как это выглядит', href: '#demo' },
        { label: 'Начать', href: '#cta' },
      ],
      login: 'Вход',
      start: 'Старт',
      languageLabel: 'Язык',
    },
    hero: {
      badge: 'Платформа 2026: Новая Эра CRM',
      titleLead: 'Будущее вашего бизнеса',
      titleAccent: 'CRM AI',
      description:
        'Интеллектуальная экосистема, которая не просто хранит данные, а развивает ваш бизнес с помощью ИИ.',
      cta: 'Создать воркспейс',
    },
    showcase: {
      title: 'Весь бизнес в одном интерфейсе',
      tabs: {
        tables: 'Таблицы',
        ai: 'AI Интеллект',
        docs: 'Редактор',
        kb: 'База знаний',
        dash: 'Аналитика',
        chat: 'Чат',
        soon: 'Скоро',
      },
      searchPlaceholder: 'Поиск по всей системе...',
      tables: {
        title: 'Сделки: Департамент Продаж',
        addDeal: 'Сделка',
        headers: ['Проект', 'Статус', 'Ценность', 'Приоритет', 'Владелец'],
        rows: [
          { project: 'Внедрение AI-платформы', status: 'В работе', value: '2,400,000 ₽', priority: 'Высокий' },
          { project: 'Разработка MVP CRM', status: 'Проверка', value: '850,000 ₽', priority: 'Средний' },
          { project: 'Дизайн-система v2', status: 'Оплачено', value: '450,000 ₽', priority: 'Низкий' },
          { project: 'Консалтинг по ИИ', status: 'Лид', value: '120,000 ₽', priority: 'Высокий' },
        ],
        managerLabel: 'Менеджер',
      },
      ai: {
        title: 'AI Intelligence',
        subtitle: 'Анализируй данные разговором',
        question: 'Какая средняя конверсия лидов из телеграма за прошлый месяц?',
        answer: 'Средняя конверсия составила 24.5%. Это на 12% выше, чем в декабре.',
        inputPlaceholder: 'Задай любой вопрос...',
        insightTitle: 'Smart Insight',
        insightText: 'Ваш CRM показатель "LTV" вырос на 8% благодаря ИИ-рекомендациям.',
        recentTasks: 'Recent Tasks Auto-Completed',
      },
      docs: {
        title: 'Редактор Документов',
        pdfExport: 'PDF Экспорт',
        save: 'Сохранить',
        documentTitle: 'Договор №124-Б',
        documentBody:
          'Настоящее соглашение заключено между py it platform и вашим ООО "Успешный успех". Мы обязуемся предоставлять безупречный софт, а вы — радоваться прибыли.',
        dropTitle: 'Перетащите сюда печать или подпись',
        sideA: 'Сторона А (Signature)',
        sideB: 'Сторона Б (Stamp)',
      },
      knowledge: {
        navTitle: 'Навигация по базе',
        navItems: ['Процессы продаж', 'Маркетинг 2026', 'Онбординг', 'Безопасность'],
        title: 'Процессы продаж: Инструкция',
        badgePrimary: 'Sales',
        badgeSecondary: 'Confidential',
        lead: 'Этот документ описывает пайплайны взаимодействия с крупным энтерпрайз-сектором через нашу платформу.',
        stageOneTitle: 'Этап 1: Скоринг',
        stageOneText: 'Используйте AI для оценки потенциала сделки на основе открытых данных.',
        stageTwoTitle: 'Этап 2: Презентация',
        stageTwoText: 'Создайте кастомный дашборд прямо в этом документе.',
      },
      analytics: {
        title: 'Аналитический центр',
        periodCurrentMonth: 'За текущий месяц',
        periodQuarter: 'За квартал',
        stats: [
          { label: 'Выручка', value: '₽ 12.4M', delta: '+14%' },
          { label: 'Активных Сделок', value: '184', delta: '+8%' },
          { label: 'Средний Чек', value: '₽ 680K', delta: '-2%' },
          { label: 'Индекс Счастья', value: '9.4', delta: '+0.2' },
        ],
        deltaSuffix: 'vs last mo.',
        teamActivity: 'Активность команды',
        leadDistribution: 'Распределение лидов',
        reach: 'Reach',
        weekdays: ['Пн', 'Ср', 'Пт', 'Вс'],
      },
      chat: {
        title: 'Корпоративный Мессенджер',
        description:
          'Мгновенная связь с командой, приватные каналы и треды. Полная синхронизация с вашими задачами и CRM.',
        releaseBadge: 'В разработке — Релиз в Апреле',
      },
    },
    modules: {
      badge: 'Premium Features',
      title: 'Всё под рукой',
      subtitle: 'Бескомпромиссная модульность для современных команд.',
      cards: [
        {
          title: 'Смарт Таблицы',
          desc: 'Гибкая структура данных, связи между таблицами, поддержка различных видов (Канбан, Сетка).',
        },
        {
          title: 'База знаний',
          desc: 'Корпоративная вики с блочным редактором и древовидной структурой страниц.',
        },
        {
          title: 'Расписание',
          desc: 'Планировщик задач и событий организации с контролем дедлайнов.',
        },
        {
          title: 'Документооборот',
          desc: 'Создание, редактирование DOCX и подпись PDF-файлов прямо в браузере.',
        },
        {
          title: 'AI Ассистент',
          desc: 'Умный помощник для анализа данных и автоматизации задач.',
        },
        {
          title: 'Аналитика',
          desc: 'Визуализация данных и выгрузка аналитики по всем модулям системы.',
        },
      ],
    },
    ecosystem: {
      title: 'Интеллектуальная экосистема',
      subtitle:
        'Единая платформа, объединяющая базу знаний, аналитику и встроенные AI-инструменты для эффективного управления процессами.',
      cards: [
        {
          title: 'База Знаний',
          desc: 'Единое пространство для всех документов компании с умным поиском.',
        },
        {
          title: 'Редактор Word',
          desc: 'Встроенный полноценный редактор документов с поддержкой совместной работы.',
        },
        {
          title: 'Дашборды',
          desc: 'Интерактивная аналитика и визуализация ключевых показателей в реальном времени.',
        },
        {
          title: 'ИИ Чат (Скоро)',
          desc: 'Персональный ассистент, знающий весь контекст вашего бизнеса и задач.',
        },
      ],
    },
    cta: {
      title: 'Начни новую главу своего бизнеса',
      subtitle: 'Присоединяйся к элите, которая выбирает интеллект и скорость. Бесплатно на 14 дней.',
      button: 'Создать аккаунт сейчас',
    },
    footer: {
      sections: [
        {
          title: 'Продукт',
          items: [
            { label: 'Функции', to: '/product/features' },
            { label: 'Интеграции', to: '/product/integrations' },
            { label: 'Безопасность', to: '/product/security' },
            { label: 'Цены', to: '/product/pricing' },
          ],
        },
        {
          title: 'Компания',
          items: [
            { label: 'О нас', to: '/company/about' },
            { label: 'Контакты', to: '/company/contacts' },
            { label: 'Партнёрам', to: '/company/partners' },
            { label: 'Блог', to: '/company/blog' },
            { label: 'Карьера', to: '/company/careers' },
          ],
        },
        {
          title: 'Правовая информация',
          items: [
            { label: 'Оферта', to: '/legal/offer' },
            { label: 'Политика конфиденциальности', to: '/legal/privacy-policy' },
            { label: 'Cookie', to: '/legal/cookies' },
            { label: 'Обработка данных', to: '/legal/data-processing' },
          ],
        },
      ],
      tagline: 'Инструменты завтрашнего дня, доступные уже сегодня.',
      copyrights: '© 2026 CRM AI PLATFORM. ALL RIGHTS RESERVED.',
      systemOnline: 'System Online',
      globalNodes: 'Global Nodes: 12',
      trustedBy: 'Trusted by 400+ Teams',
    },
  },
  en: {
    cursor: {
      label: 'Cursor Style',
      names: [
        'Subtle Aura',
        'Trail',
        'Orbiting',
        'Scanner',
        'Data Stream',
        'Pulse Ring',
        'Sparkles',
        'Bounds',
        'Neon Aura',
        'Particles',
      ],
    },
    header: {
      nav: [
        { label: 'Features', href: '#features' },
        { label: 'Product Demo', href: '#demo' },
        { label: 'Get Started', href: '#cta' },
      ],
      login: 'Login',
      start: 'Start',
      languageLabel: 'Language',
    },
    hero: {
      badge: 'Platform 2026: The New Era of CRM',
      titleLead: 'The future of your business',
      titleAccent: 'CRM AI',
      description:
        'An intelligent ecosystem that does not just store data, but actively grows your business with AI.',
      cta: 'Create workspace',
    },
    showcase: {
      title: 'Your whole business in one interface',
      tabs: {
        tables: 'Tables',
        ai: 'AI Intelligence',
        docs: 'Editor',
        kb: 'Knowledge Base',
        dash: 'Analytics',
        chat: 'Chat',
        soon: 'Soon',
      },
      searchPlaceholder: 'Search across the whole system...',
      tables: {
        title: 'Deals: Sales Department',
        addDeal: 'Deal',
        headers: ['Project', 'Status', 'Value', 'Priority', 'Owner'],
        rows: [
          { project: 'AI platform implementation', status: 'In progress', value: '2,400,000 ₽', priority: 'High' },
          { project: 'CRM MVP development', status: 'Review', value: '850,000 ₽', priority: 'Medium' },
          { project: 'Design system v2', status: 'Paid', value: '450,000 ₽', priority: 'Low' },
          { project: 'AI consulting', status: 'Lead', value: '120,000 ₽', priority: 'High' },
        ],
        managerLabel: 'Manager',
      },
      ai: {
        title: 'AI Intelligence',
        subtitle: 'Analyze your data by conversation',
        question: 'What is the average Telegram lead conversion rate for last month?',
        answer: 'Average conversion reached 24.5%. That is 12% higher than in December.',
        inputPlaceholder: 'Ask any question...',
        insightTitle: 'Smart Insight',
        insightText: 'Your CRM "LTV" metric increased by 8% thanks to AI recommendations.',
        recentTasks: 'Recent Tasks Auto-Completed',
      },
      docs: {
        title: 'Document Editor',
        pdfExport: 'PDF Export',
        save: 'Save',
        documentTitle: 'Agreement #124-B',
        documentBody:
          'This agreement is made between py it platform and your company "Successful Success". We commit to delivering flawless software, while you enjoy the growth.',
        dropTitle: 'Drag stamp or signature here',
        sideA: 'Party A (Signature)',
        sideB: 'Party B (Stamp)',
      },
      knowledge: {
        navTitle: 'Knowledge Navigation',
        navItems: ['Sales Processes', 'Marketing 2026', 'Onboarding', 'Security'],
        title: 'Sales Processes: Guide',
        badgePrimary: 'Sales',
        badgeSecondary: 'Confidential',
        lead: 'This document describes enterprise interaction pipelines through our platform.',
        stageOneTitle: 'Stage 1: Scoring',
        stageOneText: 'Use AI to estimate deal potential from open data.',
        stageTwoTitle: 'Stage 2: Presentation',
        stageTwoText: 'Build a custom dashboard directly inside this document.',
      },
      analytics: {
        title: 'Analytics Center',
        periodCurrentMonth: 'Current month',
        periodQuarter: 'Quarter',
        stats: [
          { label: 'Revenue', value: '₽ 12.4M', delta: '+14%' },
          { label: 'Active Deals', value: '184', delta: '+8%' },
          { label: 'Average Check', value: '₽ 680K', delta: '-2%' },
          { label: 'Happiness Index', value: '9.4', delta: '+0.2' },
        ],
        deltaSuffix: 'vs last mo.',
        teamActivity: 'Team activity',
        leadDistribution: 'Lead distribution',
        reach: 'Reach',
        weekdays: ['Mon', 'Wed', 'Fri', 'Sun'],
      },
      chat: {
        title: 'Corporate Messenger',
        description:
          'Instant team communication, private channels, and threads. Fully synchronized with your tasks and CRM.',
        releaseBadge: 'In development - release in April',
      },
    },
    modules: {
      badge: 'Premium Features',
      title: 'Everything at your fingertips',
      subtitle: 'Uncompromising modularity for modern teams.',
      cards: [
        {
          title: 'Smart Tables',
          desc: 'Flexible data model, relations between tables, support for multiple views (Kanban, Grid).',
        },
        {
          title: 'Knowledge Base',
          desc: 'Corporate wiki with block editor and tree-structured pages.',
        },
        {
          title: 'Schedule',
          desc: 'Organization planner for tasks and events with deadline control.',
        },
        {
          title: 'Document Flow',
          desc: 'Create, edit DOCX, and sign PDF files directly in browser.',
        },
        {
          title: 'AI Assistant',
          desc: 'Smart assistant for data analysis and workflow automation.',
        },
        {
          title: 'Analytics',
          desc: 'Visualize data and export analytics across all system modules.',
        },
      ],
    },
    ecosystem: {
      title: 'Intelligent ecosystem',
      subtitle:
        'A single platform that unites knowledge base, analytics, and built-in AI tools for efficient process management.',
      cards: [
        {
          title: 'Knowledge Base',
          desc: 'One space for all company documents with smart search.',
        },
        {
          title: 'Word Editor',
          desc: 'Built-in full document editor with collaborative workflow support.',
        },
        {
          title: 'Dashboards',
          desc: 'Interactive analytics and real-time KPI visualization.',
        },
        {
          title: 'AI Chat (Soon)',
          desc: 'Personal assistant that understands the full context of your business and tasks.',
        },
      ],
    },
    cta: {
      title: 'Start a new chapter of your business',
      subtitle: 'Join teams that choose intelligence and speed. Free for 14 days.',
      button: 'Create account now',
    },
    footer: {
      sections: [
        {
          title: 'Product',
          items: [
            { label: 'Features', to: '/product/features' },
            { label: 'Integrations', to: '/product/integrations' },
            { label: 'Security', to: '/product/security' },
            { label: 'Pricing', to: '/product/pricing' },
          ],
        },
        {
          title: 'Company',
          items: [
            { label: 'About', to: '/company/about' },
            { label: 'Contacts', to: '/company/contacts' },
            { label: 'Partners', to: '/company/partners' },
            { label: 'Blog', to: '/company/blog' },
            { label: 'Careers', to: '/company/careers' },
          ],
        },
        {
          title: 'Legal',
          items: [
            { label: 'Offer', to: '/legal/offer' },
            { label: 'Privacy Policy', to: '/legal/privacy-policy' },
            { label: 'Cookie', to: '/legal/cookies' },
            { label: 'Data Processing', to: '/legal/data-processing' },
          ],
        },
      ],
      tagline: 'Tomorrow’s tools, available today.',
      copyrights: '© 2026 CRM AI PLATFORM. ALL RIGHTS RESERVED.',
      systemOnline: 'System Online',
      globalNodes: 'Global Nodes: 12',
      trustedBy: 'Trusted by 400+ Teams',
    },
  },
}
