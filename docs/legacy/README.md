# CRM Платформа — Мульти-инструментальная SaaS (Airtable + Notion + Расписание + AI)

Продакшн-уровня мультитенантная SaaS-платформа с конструктором таблиц, базой знаний, расписанием, отчётами и платным AI-агентом на базе Grok (xAI).

## Архитектура

```
crm_chechen/
├── backend/              # Python 3.12, FastAPI, SQLAlchemy 2 async
│   ├── src/
│   │   ├── common/       # Общие схемы, исключения, перечисления, базовая модель
│   │   ├── config.py     # Настройки (pydantic-settings)
│   │   ├── infrastructure/  # БД, Redis, Celery, UoW, логирование
│   │   ├── middleware/    # Correlation-ID, обработчик ошибок
│   │   ├── modules/
│   │   │   ├── auth/     # Пользователи, JWT, регистрация/вход/обновление токенов
│   │   │   ├── org/      # Организации, участники, приглашения, подписки
│   │   │   ├── audit/    # Журнал аудита
│   │   │   ├── notifications/  # Уведомления (CRUD, mark read)
│   │   │   ├── files/    # Файлы/вложения (MinIO S3)
│   │   │   └── tables/   # Таблицы, колонки, записи (JSONB)
│   │   └── main.py       # Фабрика FastAPI приложения
│   ├── alembic/          # Миграции БД
│   ├── tests/            # pytest (авторизация, организации, RBAC)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/             # React 18, TypeScript, Vite, TailwindCSS, shadcn/ui
│   ├── src/
│   │   ├── components/   # UI-компоненты (Button, Input, Card, Sidebar, Header)
│   │   ├── contexts/     # AuthContext, ThemeContext
│   │   ├── lib/          # API-клиент, утилиты
│   │   ├── pages/        # Лендинг, Вход, Регистрация, Главная, Команда, Настройки, Журнал, модули
│   │   └── App.tsx       # Роутер
│   └── package.json
├── docker-compose.yml    # PostgreSQL 16 + pgvector, Redis 7, MinIO, API, Frontend
├── ASSUMPTIONS.md
└── README.md
```

## Быстрый старт

### Требования
- Docker и Docker Compose
- Node.js 18+ (для локальной разработки фронтенда)
- Python 3.12+ (для локальной разработки бекенда без Docker)

### 1. Запуск инфраструктуры

```bash
docker-compose up -d db redis minio
```

### 2. Запуск бекенда локально (dev-режим)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env

# Запуск миграций
alembic upgrade head

# Запуск API-сервера
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Запуск фронтенда

```bash
cd frontend
npm install
npm run dev
```

Открыть http://localhost:5173

### 4. Или запустить всё через Docker

```bash
docker-compose up --build

### Secrets (опционально, рекомендовано для приватных деплоев)

Чтобы секреты не лежали в `.env`, можно хранить их в локальном override-файле для compose:

1. Скопируй `secrets.yml.example` -> `secrets.yml`
2. Заполни секреты в `secrets.yml` (файл игнорируется git)
3. Запускай compose с двумя файлами:

```bash
docker compose -f docker-compose.yml -f secrets.yml up -d
```

Для prod:

```bash
docker compose -f docker-compose.prod.yml -f secrets.yml up -d
```
```

## Документация API

- Swagger UI: http://localhost:8000/api/docs
- OpenAPI JSON: http://localhost:8000/api/openapi.json
- Проверка здоровья: http://localhost:8000/api/health

## API Эндпоинты

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/v1/auth/register` | Регистрация пользователя + создание организации |
| POST | `/api/v1/auth/login` | Вход |
| POST | `/api/v1/auth/refresh` | Обновление токенов |
| POST | `/api/v1/auth/logout` | Отзыв refresh-токена |
| GET | `/api/v1/auth/me` | Информация о текущем пользователе |
| PATCH | `/api/v1/auth/me` | Обновление профиля |
| GET | `/api/v1/orgs/current` | Текущая организация |
| PATCH | `/api/v1/orgs/current` | Обновление организации |
| GET | `/api/v1/orgs/my` | Организации пользователя |
| POST | `/api/v1/orgs/switch` | Переключение контекста организации |
| GET | `/api/v1/orgs/members` | Список участников |
| POST | `/api/v1/orgs/invites` | Создание приглашения (владелец/админ) |
| POST | `/api/v1/orgs/invites/accept` | Принятие приглашения |
| PUT | `/api/v1/orgs/members/{id}/role` | Изменение роли участника |
| DELETE | `/api/v1/orgs/members/{id}` | Удаление участника |
| GET | `/api/v1/audit/logs` | Журнал аудита (владелец/админ/чтение) |
| POST | `/api/v1/files/upload` | Загрузка файла (MinIO) |
| GET | `/api/v1/files/` | Список файлов организации |
| GET | `/api/v1/files/{id}/download` | Скачивание файла |
| DELETE | `/api/v1/files/{id}` | Удаление файла |
| GET | `/api/v1/notifications/` | Список уведомлений |
| GET | `/api/v1/notifications/unread-count` | Количество непрочитанных |
| POST | `/api/v1/notifications/{id}/read` | Отметить прочитанным |
| POST | `/api/v1/notifications/read-all` | Прочитать все |
| POST | `/api/v1/tables/` | Создание таблицы |
| GET | `/api/v1/tables/` | Список таблиц |
| GET | `/api/v1/tables/{id}` | Таблица с колонками |
| PATCH | `/api/v1/tables/{id}` | Обновление таблицы |
| DELETE | `/api/v1/tables/{id}` | Удаление таблицы |
| POST | `/api/v1/tables/{id}/columns` | Добавление колонки |
| PATCH | `/api/v1/tables/{id}/columns/{col_id}` | Обновление колонки |
| DELETE | `/api/v1/tables/{id}/columns/{col_id}` | Удаление колонки |
| POST | `/api/v1/tables/{id}/records/` | Создание записи (JSONB) |
| GET | `/api/v1/tables/{id}/records/` | Список записей |
| GET | `/api/v1/tables/{id}/records/{rec_id}` | Получение записи |
| PATCH | `/api/v1/tables/{id}/records/{rec_id}` | Обновление записи |
| DELETE | `/api/v1/tables/{id}/records/{rec_id}` | Удаление записи |
| POST | `/api/v1/tables/{id}/filter` | Фильтрация + сортировка записей |
| GET | `/api/v1/tables/{id}/export/csv` | Экспорт в CSV |
| POST | `/api/v1/tables/{id}/views/` | Создание вида (grid/kanban/calendar) |
| GET | `/api/v1/tables/{id}/views/` | Список видов |
| DELETE | `/api/v1/tables/{id}/views/{view_id}` | Удаление вида |
| POST | `/api/v1/knowledge/pages` | Создание страницы базы знаний |
| GET | `/api/v1/knowledge/pages` | Список страниц |
| GET | `/api/v1/knowledge/pages/{id}` | Получение страницы |
| PATCH | `/api/v1/knowledge/pages/{id}` | Обновление страницы |
| DELETE | `/api/v1/knowledge/pages/{id}` | Удаление страницы |
| GET | `/api/v1/reports/summary` | Сводный отчёт по организации |
| GET | `/api/v1/billing/plans` | Список тарифов |
| GET | `/api/v1/billing/usage` | Текущее потребление |
| POST | `/api/v1/billing/upgrade` | Обновление тарифа (placeholder) |
| POST | `/api/v1/ai/chat` | AI чат (Grok/OpenAI) |
| GET | `/api/v1/ai/status` | Статус AI конфигурации |
| POST | `/api/v1/schedule/events` | Создание события |
| GET | `/api/v1/schedule/events` | Список событий (с диапазоном дат) |
| GET | `/api/v1/schedule/events/{id}` | Получение события |
| PATCH | `/api/v1/schedule/events/{id}` | Обновление события |
| DELETE | `/api/v1/schedule/events/{id}` | Удаление события |

## Функциональность фронтенда

- **Лендинг** — презентация платформы без авторизации с примерами использования
- **Тема** — переключатель светлой/тёмной темы с сохранением в localStorage
- **Локализация** — весь интерфейс на русском языке
- **Мобильная адаптация** — бургер-меню, адаптивная верстка всех страниц
- **Главная** — дашборд с реальными данными из API (участники, план, модули, статус)
- **Команда** — список участников, приглашение по email, роли (RBAC)
- **Настройки** — редактирование профиля и организации через API
- **Журнал аудита** — реальные данные из `GET /audit/logs`
- **Уведомления** — реальные уведомления из API, mark read, mark all read
- **Файлы** — загрузка/скачивание/удаление через MinIO S3
- **Таблицы** — конструктор колонок (13 типов), inline-редактирование ячеек с автосохранением, фильтрация, экспорт CSV
- **База знаний** — создание/редактирование/удаление страниц документации (древовидная структура)
- **Отчёты** — сводная аналитика: кол-во таблиц, записей, полей по организации
- **Биллинг** — тарифы, текущее потребление, placeholder для платёжного шлюза
- **AI Агент** — чат с Grok/OpenAI, история сообщений, статус конфигурации
- **Расписание** — события CRUD, цвета, mark done, фильтр по датам

## Тестирование

```bash
cd backend
pytest -v --tb=short
```

## Технологический стек

- **Бекенд**: Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic, Redis
- **Фронтенд**: React 18, TypeScript, Vite, TailwindCSS, shadcn/ui, Recharts
- **БД**: PostgreSQL 16 + pgvector
- **Хранилище**: MinIO (S3-совместимое)
- **AI**: Grok API (xAI) — api.x.ai/v1
- **Биллинг**: ЮКасса (YooKassa)
- **Мониторинг**: Prometheus + Grafana
- **Очереди**: RabbitMQ
- **Балансировщик**: Nginx + Certbot SSL
- **CI/CD**: GitHub Actions
- **Инфраструктура**: Docker Compose (dev + prod)

## Деплой в продакшн

```bash
# 1. Скопировать и заполнить .env
cp .env.example backend/.env
# Заполнить реальные значения: DOMAIN, YOOKASSA_*, OPENAI_API_KEY, SMTP_*, SECRET_KEY

# 2. Получить SSL-сертификат (первый раз)
docker compose -f docker-compose.prod.yml up -d nginx
docker compose -f docker-compose.prod.yml run --rm certbot certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN

# 3. Запустить всё
docker compose -f docker-compose.prod.yml up -d --build

# 4. Бэкап
./scripts/backup.sh

# 5. Восстановление
./scripts/restore.sh backups/db_YYYYMMDD_HHMMSS.dump
```

## Мониторинг

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin / из GRAFANA_PASSWORD)
- **RabbitMQ**: http://localhost:15672
- **Health**: http://localhost:8000/api/health
- **Readiness**: http://localhost:8000/api/readiness
- **Metrics**: http://localhost:8000/metrics

## Безопасность

- Security headers (X-Content-Type-Options, X-Frame-Options, XSS-Protection, CSP)
- Rate limiting (120 req/min per IP)
- CORS с whitelist
- JWT с refresh-токенами
- Correlation-ID для трассировки запросов
- RBAC (Owner → Admin → Manager → Employee → Readonly)

## Дорожная карта

- [x] Авторизация + Мультитенантное ядро + RBAC
- [x] Файлы/Вложения + Уведомления + Журнал аудита
- [x] Таблицы: конструктор, inline-редактирование, date picker, CSV экспорт
- [x] База знаний: древовидная структура, поиск, редактор
- [x] Расписание: календарь день/месяц/год, повторы событий
- [x] Отчёты: графики (Recharts), KPI карточки, детализация
- [x] AI Агент: чат Grok, системный промпт, статистика токенов
- [x] Биллинг: ЮКасса, тарифы, webhook
- [x] Инфра: Nginx + SSL + Prometheus + Grafana + RabbitMQ
- [x] CI/CD: GitHub Actions (lint, test, build)
- [x] Безопасность: security headers, rate limiting, health checks
- [x] Бэкап/восстановление: скрипты для PostgreSQL + MinIO
