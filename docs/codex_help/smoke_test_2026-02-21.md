# Смоук-тест (2026-02-21)

Цель: быстро проверить, что dev-стек поднимается и ключевые API-ручки работают без 500/422, а мониторинг реально собирает метрики.

## Стенд

- `docker compose up -d --build`
- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

## Проверено (API)

1. Health/Readiness/Metrics
- `GET /api/health` -> 200
- `GET /api/readiness` -> 200
- `GET /metrics` -> 200
- В `/metrics` есть как минимум `process_cpu_seconds_total` и `http_requests_total` (HTTP-инструментация включена).

2. Auth + Org
- `POST /api/v1/auth/register` -> ok
- `POST /api/v1/auth/login` -> ok (выдает access/refresh)
- `GET /api/v1/auth/me` -> ok
- `GET /api/v1/orgs/current` -> ok

3. Таблицы
- `POST /api/v1/tables/` -> ok (создание таблицы)
- `POST /api/v1/tables/{table_id}/columns` -> ok (создание колонки)
- `POST /api/v1/tables/{table_id}/records/` -> ok (создание записи)
- `GET /api/v1/tables/{table_id}/records/?limit=...&offset=...` -> ok (`data.total` и `data.records[]` заполнены)
- `PATCH /api/v1/tables/{table_id}/records/{record_id}` -> ok
- `POST /api/v1/tables/{table_id}/records/{record_id}/move` -> ok
- Экспорт:
  - `GET /api/v1/tables/{table_id}/export/csv` -> ok (файл скачивается)
  - `GET /api/v1/tables/{table_id}/export/xlsx` -> ok (файл скачивается)

4. Расписание
- `POST /api/v1/schedule/events` -> ok (включая `recurrence="daily"`)
- `GET /api/v1/schedule/events?start=...&end=...` -> ok

Нюанс: сейчас `recurrence` не "разворачивается" в несколько событий в диапазоне, возвращается 1 исходное событие. Это функциональный гэп, не падение.

5. Доступы (RBAC rules)
- `GET /api/v1/access/rules` -> ok

6. Billing
- `GET /api/v1/billing/plans` -> ok (возвращает список)

## Проверено (Monitoring)

1. Prometheus targets
- `api:8000/metrics` -> up
- `node-exporter:9100/metrics` -> up
- `localhost:9090/metrics` -> up

2. Grafana
- `GET /api/health` -> ok

## AI (важно)

`GET /api/v1/ai/status` возвращает:
- `enabled`: флаг `ENABLE_AI`
- `configured`: есть ли `OPENAI_BEARER_TOKEN` или `OPENAI_API_KEY`

Если токен не задан, `POST /api/v1/ai/chat` отвечает:
- `AI_NOT_CONFIGURED`

Важно: чтобы токен реально попадал в контейнер, он должен быть в переменных окружения (root `.env` docker-compose или в окружении шелла) и сервисы должны быть пересозданы (`docker compose up -d --force-recreate api celery_worker celery_beat`).

## Что осталось по багам/фичам (по итогам теста)

1. Расписание: корректная поддержка повторов (`recurrence`) в выдаче по диапазону (expansion occurrences).
2. AI: без токена не проверяется логика "создать таблицу/колонки/записи" через провайдера (нужен валидный `OPENAI_BEARER_TOKEN`).

