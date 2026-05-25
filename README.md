# CRM AI

Мультитенантная CRM-платформа с модулями: auth/org, tables, docs, knowledge, chat, reports, AI, schedule, billing, superadmin.

## 1. Архитектура (кратко)

- Backend: FastAPI (`backend/src`), PostgreSQL, Redis, RabbitMQ, Celery, MinIO, OnlyOffice.
- Frontend: React + TypeScript + Vite (`frontend/src`).
- API: REST `/api/v1/*` + WebSocket `/api/v1/ws/notifications`.
- Контуры: dev/prod docker-compose, мониторинг через Prometheus/Grafana.

Подробный анализ модулей, API-контрактов и схем логики:
- [docs/PROJECT_ANALYSIS_BACKEND_FRONTEND_API.md](docs/PROJECT_ANALYSIS_BACKEND_FRONTEND_API.md)

ТЗ по task tracker:
- [docs/task_trek/TZ_TASK_TRACKER_PRODUCTION.md](docs/task_trek/TZ_TASK_TRACKER_PRODUCTION.md)

## 2. Структура репозитория

- `backend/` — FastAPI backend + Alembic + tests
- `frontend/` — React frontend
- `scripts/` — утилиты запуска/бэкапа/инициализации
- `monitoring/` — Prometheus/Grafana конфиги
- `nginx/` — ingress-конфигурация
- `docs/` — проектная документация

## 3. Быстрый старт (dev)

1. Скопировать `secrets.yml.example` в `secrets.yml`.
2. Заполнить локальные значения (без реальных production секретов).
3. Запустить стек:

```bash
make init
make up
```

Остановка:

```bash
make down
```

## 4. Основные URL (dev)

- frontend: `http://localhost:5173`
- api: `http://localhost:8000`
- swagger: `http://localhost:8000/api/docs`
- health: `http://localhost:8000/api/health`
- readiness: `http://localhost:8000/api/readiness`

## 5. Ключевые команды

```bash
make ps
make logs
make logs-api
make migrate
make test
make lint
```

Frontend локальные проверки:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

Backend локальные проверки:

```bash
cd backend
ruff check src/ tests/
pytest -v --tb=short
```

## 6. API-контракты

Базовые префиксы:
- `/api/v1/auth`
- `/api/v1/orgs`
- `/api/v1/tables`
- `/api/v1/docs`
- `/api/v1/chat`
- `/api/v1/reports`, `/api/v1/reports/v2`
- `/api/v1/ai`
- `/api/v1/billing`
- `/api/v1/superadmin`
- `/api/v1/ws/notifications`

Все доменные карты endpoints и backend/frontend соответствие:
- [docs/PROJECT_ANALYSIS_BACKEND_FRONTEND_API.md](docs/PROJECT_ANALYSIS_BACKEND_FRONTEND_API.md)

## 7. Безопасность и секреты

- `secrets.yml` — только для локальной разработки.
- В production использовать env и `*_FILE` переменные.
- Не коммитить реальные ключи, токены и пароли.
- Для `auth/superadmin` используются отдельные cookie-контуры.

## 8. CI/CD

Пайплайн: `.github/workflows/ci.yml`

Проверяет:
- policy pinning зависимостей
- compose smoke
- backend lint + migration
- frontend typecheck/lint/build
- docker image build
- deploy (main branch)

## 9. i18n rollout (frontend)

- `VITE_I18N_ENABLED` — глобальный toggle (`true/false`)
- `VITE_I18N_ROLLOUT_PERCENT` — процент rollout (`0..100`)

Пример:

```bash
VITE_I18N_ENABLED=true
VITE_I18N_ROLLOUT_PERCENT=25
```
