# Codex Working Notes

Дата: 2026-02-19

## Непереговорные правила разработки
- Никаких костылей и временных "быстрых" правок.
- Любое изменение делать через существующую архитектуру: `routes -> service/repository -> uow -> db`.
- Не ломать tenant-изоляцию: все данные и выборки в контексте `org_id`.
- Не обходить RBAC-проверки и `CurrentUser`-зависимости.
- Схему БД менять только через Alembic миграции.
- Для сложных изменений сначала читать код модуля, потом править.

## Текущая архитектура (факт)
- Монорепо: `backend/` (FastAPI + SQLAlchemy async), `frontend/` (React + TS + Vite).
- Вход backend: `backend/src/main.py`.
- Конфиг env: `backend/src/config.py`.
- Единый формат API-ответа: `ApiResponse` (`ok/data/error/meta`) в `backend/src/common/schemas.py`.
- Транзакционный паттерн: `UnitOfWork` в `backend/src/infrastructure/uow.py`.
- Front API-клиент: `frontend/src/lib/api.ts`.

## Критичные технические особенности
- На startup backend запускает `alembic upgrade head` и сидит планы (см. `backend/src/main.py`).
- Rate-limit middleware in-memory (по IP), это важно для поведения в dev/prod.
- `access.check_access` по умолчанию разрешает доступ, если правило не найдено (backward compatibility).
- Celery сейчас сконфигурирован на Redis broker/backend (`backend/src/infrastructure/celery_app.py`), хотя в compose также поднят RabbitMQ.
- Таблицы/записи хранят данные в JSONB (динамическая схема), надо аккуратно держать совместимость полей.
- Frontend работает через `/api` proxy (Vite) и refresh-flow в axios interceptor.

## Быстрые команды (рабочий минимум)
- Поднять dev: `make up`
- Остановить: `make down`
- Миграции: `make migrate`
- Тесты backend: `make test`
- Линт backend: `make lint`

## Чеклист перед любым изменением
- Проверить существующие тесты модуля в `backend/tests/`.
- Проверить, не нарушается ли `org_id`-scope.
- Проверить роли доступа (owner/admin/manager/employee/readonly).
- Если затронута БД: добавить миграцию + проверить startup-сценарий.
- Если затронут API-контракт: сверить типы в `frontend/src/lib/api.ts`.
