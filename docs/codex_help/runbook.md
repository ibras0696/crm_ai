# Runbook (Эксплуатация/Дебаг)

Дата: 2026-02-22

## 1) Поднять dev

```bash
docker compose -f docker-compose.yml -f secrets.yml up -d --build
```

Полезное:
- Frontend: `http://localhost:5173`
- API: `http://localhost:8000`
- Docs: `http://localhost:8000/api/docs`
- Health: `http://localhost:8000/api/health`
- Readiness: `http://localhost:8000/api/readiness`
- Metrics: `http://localhost:8000/metrics`
- RabbitMQ: `http://localhost:15672`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`

## 2) Контейнеры и логи

```bash
docker compose -f docker-compose.yml -f secrets.yml ps
docker compose -f docker-compose.yml -f secrets.yml logs -f api
docker compose -f docker-compose.yml -f secrets.yml logs -f celery_worker
```

Если менялись переменные окружения в `secrets.yml`, нужен recreate:
```bash
docker compose -f docker-compose.yml -f secrets.yml up -d --force-recreate api celery_worker celery_beat
```

## 3) Миграции/seed

Dev стек использует сервис `bootstrap`:
- берет advisory lock в Postgres
- применяет alembic миграции
- делает upsert тарифов

Если bootstrap упал:
```bash
docker compose -f docker-compose.yml -f secrets.yml logs -f bootstrap
```

## 4) Частые 500/422

1. 422:
- чаще всего невалидный payload (поля/типы).
- смотри ответ API: `error.code` / `error.message`.

2. 500:
- смотри `docker logs api` и stacktrace.
- экспорт файлов: важно корректно формировать `Content-Disposition` (кириллица).
- schedule recurrence: RRULE строка может быть длинной, колонка должна быть `text`.

## 5) Invite / права доступа

Invite flow и Access Rules: `docs/codex_help/invites_and_access_review.md`

Ключевое:
- invite token не возвращается по API (нужна доставка по email/ссылке).
- access rules должны быть интегрированы в модули, иначе это “мертвый” функционал.

