# Project Architecture

## Что где лежит

```text
backend/      FastAPI, бизнес-логика, БД, Celery, интеграции
frontend/     React + Vite
monitoring/   Prometheus и Grafana
nginx/        production reverse proxy
scripts/      служебные команды
docs/         короткая живая документация
```

## Backend

Основной путь: `backend/src`

Главные слои:
- `main.py`, `router.py` — запуск приложения и подключение модулей
- `config.py` — настройки
- `common/` — общие ошибки, enum, схемы ответа
- `infrastructure/` — database, redis, celery, logging, metrics
- `modules/` — бизнес-модули

Основные модули:
- `auth`
- `org`
- `tables`
- `knowledge`
- `files`
- `docs`
- `billing`
- `ai`
- `notifications`
- `superadmin`

Типичный модуль:
- `routes.py` — HTTP
- `schemas.py` — pydantic
- `service.py` / `services/` — бизнес-логика
- `repository.py` — доступ к БД
- `tests/` — тесты модуля

## Frontend

Основной путь: `frontend/src`

Главные зоны:
- `pages/` — страницы
- `components/` — переиспользуемые части UI
- `contexts/` — auth и прочие глобальные состояния
- `lib/api/` — HTTP-клиенты

## Runtime

Основные сервисы:
- `api`
- `frontend`
- `db`
- `redis`
- `rabbitmq`
- `celery_worker`
- `celery_beat`
- `minio`
- `onlyoffice`

Опционально для мониторинга:
- `prometheus`
- `grafana`
- `node-exporter`

## Как идёт запрос

1. Браузер вызывает frontend
2. frontend идёт в `/api/v1/...`
3. backend middleware добавляет технический контекст и проверки
4. endpoint вызывает service
5. service работает с БД, Redis, MinIO, RabbitMQ
6. ответ уходит в `ApiResponse`

API-контракты: [api_contracts.md](api_contracts.md)
