# Architecture Snapshot

Дата: 2026-02-19

## Backend модули (ключевые)
- `auth`: регистрация, логин, refresh/logout, JWT.
- `org`: организация, участники, приглашения, переключение org.
- `tables`: таблицы, колонки, записи, фильтрация, views.
- `knowledge`: база знаний (страницы).
- `reports`: агрегаты по данным организации.
- `billing`: планы, usage, платежи YooKassa, webhook.
- `ai`: чат через OpenAI-compatible API + лог usage.
- `schedule`: события календаря.
- `access`: object-level правила доступа.
- `files`: MinIO/S3 загрузка и выдача файлов.
- `notifications`, `audit`, `superadmin`.

## Frontend (факт)
- Роутинг: `frontend/src/App.tsx`.
- Авторизация и профиль: `frontend/src/contexts/AuthContext.tsx`.
- API-контракты: `frontend/src/lib/api.ts`.
- Vite proxy на backend через `/api`: `frontend/vite.config.ts`.

## Риски и что держать под контролем
- Миграции запускаются автоматически на startup API: любое изменение схемы должно быть безопасным к повторному запуску.
- В модуле доступа fallback = allow, поэтому ужесточение правил нужно делать осознанно и с тестами.
- Есть расхождение инфраструктуры очередей: RabbitMQ поднят, но Celery использует Redis.
- Много модулей завязано на org-context из токена; изменения токенов/refresh-flow затрагивают почти весь продукт.
- При изменении API нужно сразу синхронизировать TS-типы на фронте.

## Минимальный порядок работы над задачей
1. Локализовать модуль и связанные тесты.
2. Проверить org-scope + RBAC + API envelope.
3. Внести изменения в backend.
4. Сверить frontend API-типы/вызовы.
5. Прогнать релевантные тесты.
