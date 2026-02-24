# Project Architecture and File Structure

Документ отвечает на 3 вопроса:
- что где лежит;
- как запрос проходит по системе;
- какие сервисы за что отвечают.

## 1. Корневая структура

```text
crm_ai/
├── backend/                # FastAPI, бизнес-логика, БД, интеграции
├── frontend/               # React/Vite интерфейс
├── monitoring/             # Prometheus/Grafana provisioning
├── nginx/                  # Nginx конфиг для production
├── scripts/                # служебные скрипты (секреты, backup/restore)
├── docker-compose.yml      # dev окружение
├── docker-compose.prod.yml # production окружение
├── secrets.yml.example     # шаблон секретов
└── docs/                   # актуальная документация
```

## 2. Backend: как организован код

Путь: `backend/src`

- `main.py` - создание FastAPI app, middleware, health/readiness.
- `router.py` - подключение модулей под префиксом `/api/v1`.
- `config.py` - все env настройки и prod-валидация безопасности.
- `common/` - общие схемы (`ApiResponse`), ошибки, enum.
- `middleware/` - correlation id, лимит тела запроса, security headers, rate limit.
- `infrastructure/` - database/redis/celery/logging/metrics.
- `modules/` - бизнес-модули:
  - `auth`
  - `org`
  - `tables`
  - `knowledge`
  - `files`
  - `notifications`
  - `audit`
  - `reports`
  - `billing`
  - `ai`
  - `schedule`
  - `access`
  - `superadmin`

Типичный модуль содержит:
- `routes.py` - HTTP endpoints;
- `schemas.py` - pydantic модели;
- `service.py` или `services/` - бизнес-логика;
- `repository.py` или `repositories/` - работа с БД.

## 3. Frontend: как организован код

Путь: `frontend/src`

- `pages/` - экранные страницы.
- `components/` - переиспользуемые UI-компоненты.
- `contexts/` - глобальные контексты (auth и т.д.).
- `lib/api/` - API-клиенты.
  - `core/client.ts` - axios клиент, `withCredentials`, авто-refresh на 401.
  - `auth/*`, `superadmin/*` - специализированные клиенты.

## 4. Как работает запрос (поток)

1. Пользователь в браузере вызывает действие на frontend.
2. Frontend отправляет запрос в backend (`/api/v1/...`) с cookie-сессией.
3. Backend middleware добавляет correlation id, проверяет лимиты/безопасность.
4. Endpoint модуля вызывает service.
5. Service читает/пишет БД, Redis, S3, RabbitMQ по необходимости.
6. Backend возвращает `ApiResponse`.
7. Frontend отображает `data` или безопасную `error`.

## 5. Сервисы и роли (compose)

Основные сервисы:

- `api` - FastAPI backend.
- `frontend` - React приложение.
- `db` - PostgreSQL.
- `redis` - кэш/лимитеры/служебные данные.
- `rabbitmq` - брокер очередей.
- `celery_worker`, `celery_beat` - фоновые задачи.
- `minio` - объектное хранилище файлов.
- `prometheus`, `grafana`, `node-exporter` - мониторинг.
- `nginx` (prod) - входная точка HTTPS и reverse proxy.
- `certbot` (prod) - обновление сертификатов.

## 6. API: где смотреть контракты

- Живая схема: `/api/openapi.json`
- Swagger: `/api/docs`
- Маршруты собираются в `backend/src/router.py`

Подробности по endpoint-ам: [api_contracts.md](api_contracts.md)

## 7. Где править что

- Проблемы авторизации: `backend/src/modules/auth`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/lib/api/core/client.ts`
- Проблемы superadmin: `backend/src/modules/superadmin`, `frontend/src/components/superadmin`, `frontend/src/pages/superadmin`
- Проблемы таблиц/записей: `backend/src/modules/tables`, `frontend/src/pages/tables`
- Проблемы конфигов/секретов: `backend/src/config.py`, `secrets.yml.example`, `docker-compose*.yml`
- Проблемы мониторинга: `monitoring/`, `docker-compose*.yml`
