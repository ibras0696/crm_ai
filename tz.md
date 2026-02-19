
---

# ТЗ: Multi-tool CRM / Ops SaaS Platform (Airtable+Notion+Scheduling+AI)

## 0) Цель продукта 🎯

Платформа для компаний (организаций) с:

* **конструктором таблиц** (учёт/операционка/CRM-процессы),
* **планированием** (графики сотрудников, встречи, напоминания),
* **базой знаний** (регламенты, обучение, контроль доступа),
* **платным AI-агентом**, который работает строго в рамках данных организации и прав пользователя.

---

## 1) Принципы и правила (production-уровень) ✅

### 1.1. Архитектурные правила

* **Multi-tenant (Organization-scoped)**: данные всегда привязаны к `org_id`.
* **RBAC обязателен**: роли/права на уровне модулей + объектов (таблица/запись/страница).
* **Audit log обязателен**: все изменения критичных сущностей логируются (кто/что/когда/откуда).
* **API stateless**: горизонтальное масштабирование без сессий на сервере.
* **Outbox pattern** для событий (уведомления, webhooks) — без потери событий при падениях.
* Все времена — **UTC** + хранение timezone у пользователя для отображения.
* **Idempotency** для операций импорта/интеграций/платежей/вебхуков.

### 1.2. Инженерные стандарты

* Python **3.12**, FastAPI, Pydantic v2, SQLAlchemy 2 async, Alembic.
* **Никаких `create_all()` в проде**, только миграции.
* Слои: `handlers/controllers` → `services` → `repositories` → `db`.
* Транзакции только через **Unit of Work** (одна точка коммита/роллбэка).
* Контракты: OpenAPI, версионирование `/api/v1`.
* Качество: ruff + mypy (поэтапно) + pytest обязательно.

---

## 2) Нефункциональные требования (NFR) 🧱

### 2.1. Масштабирование

* API и workers — **горизонтально масштабируемые** (несколько реплик).
* БД: PostgreSQL с репликацией (read replicas по необходимости), индексация и партиционирование при росте.
* Кэш/очереди: Redis (HA конфиг позже).

### 2.2. Отказоустойчивость и надежность

* Zero-downtime deploy (rolling).
* Backups: ежедневные + **PITR** (point-in-time recovery) для Postgres.
* S3/MinIO — с версионированием/ретеншном (по конфигу).
* Любые тяжелые операции: импорт, экспорт, отчеты, индексации — **только через background jobs**.

### 2.3. Производительность

* Пагинация везде, предпочтительно **keyset pagination** для больших списков.
* Индексы по `org_id`, `created_at`, и по используемым полям фильтрации.
* Защита от N+1; предзагрузки и батчи.
* Ограничения на размер ответов, стриминг выгрузок.

### 2.4. Безопасность

* OWASP, rate limiting, защита от brute force.
* Шифрование секретов (env/secret manager), токены с коротким TTL + refresh.
* Аудит доступа AI к данным (кто запросил, какие источники читались).

### 2.5. Наблюдаемость

* Structured logs (JSON), correlation id на запрос.
* Метрики Prometheus + алерты (ошибки, latency, очередь, DB).
* Sentry для ошибок.
* Трейсинг (OpenTelemetry) — желательно.

---

## 3) Роли и доступ 🔐

### Роли (минимум)

* **Owner**: биллинг, планы, управление org.
* **Admin**: управление пользователями, таблицами, политиками.
* **Manager**: доступ к операционке/графикам/отчетам по отделу.
* **Employee**: ограниченный доступ к таблицам/знаниям.
* **Auditor/Read-only**: просмотр без изменений.

### Политики доступа

* Уровни: org → module → object (таблица/страница/сущность) → action (read/write/delete/export).
* **AI наследует права пользователя** + дополнительные лимиты (только чтение по умолчанию, запись — отдельное разрешение).

---

## 4) Модули продукта 🧩

### 4.1. Core Platform (ядро)

* Аутентификация (email+пароль, позже SSO/OAuth).
* Организации, подразделения (optional), пользователи, роли, инвайты.
* Billing/Plans (минимум сущностей даже до интеграции платежей).
* Уведомления (in-app + email), шаблоны уведомлений.
* Audit log.
* Files (S3/MinIO) + attachment linking.
* Webhooks (исходящие) + подписи.

---

### 4.2. Конструктор таблиц (Airtable-like, не Excel) 📌

**Функции**

* Создание таблиц и полей (schema designer).
* Типы полей (MVP):

  * text, number, date/datetime, boolean
  * single/multi select
  * user (assignee)
  * reference (link to table)
  * file
  * formula (ограниченная) / computed (опционально)
* Записи: CRUD, массовые операции, импорт/экспорт CSV/XLSX.
* Views:

  * grid view (табличный)
  * фильтры, сортировки, группировки
  * сохраненные представления
* Комментарии к записи, упоминания, activity feed.

**Хранение данных (требование к масштабу)**

* Динамическая схема: `records.data JSONB` + строгая валидация по схеме полей.
* Индексация:

  * GIN по JSONB
  * дополнительные частичные индексы под популярные поля
* Для heavy-BI (в будущем): materialized views / агрегаты / выделенный индекс-слой.

---

### 4.3. Отчеты и графики 📊

* В UI: интерактивные графики (web chart lib).
* Экспорт: PDF/PNG отчеты на бэке.
* Конструктор отчетов:

  * выбор таблицы/вида
  * агрегации (count, sum, avg)
  * группировки по полям
  * расписание генерации отчета (cron-job)
* Доступ к отчетам по RBAC.

---

### 4.4. Scheduling (графики, встречи, контроль) 🗓️

* Графики смен:

  * смена (start/end), роль, сотрудник, статус
  * повторяющиеся смены (опционально позже)
* Встречи/задачи:

  * встречи внутри системы
  * интеграция Google Calendar (создание/обновление/отмена) — позже, но заложить интерфейсы
* Напоминания:

  * email + in-app
  * дедлайны/события
  * quiet hours, timezone

---

### 4.5. База знаний (Knowledge Base) 📚

* Пространства (Space) → страницы (Page) → ревизии (Revision).
* Права: на Space и Page.
* Версионирование и история изменений.
* Шаблоны страниц, публикация/черновик, отметка “актуально”.
* Поиск по базе знаний.

---

### 4.6. AI-агент (строго платный) 🤖💳

**Доступ**

* Только при активной подписке/плане, где включен AI.
* Лимиты: токены/день, бюджет/месяц, hard-stop.

**Функции**

* Q&A по базе знаний и данным таблиц (RAG).
* Генерация отчетов/резюме по данным (только из разрешенных источников).
* Помощь в онбординге сотрудника: ответы по регламентам.
* “Инструменты” агента (tools):

  * search KB
  * query table aggregates (без raw SQL от LLM)
  * generate report export
* Логи usage:

  * tokens_in/out, модель, стоимость, пользователь, org, цель.
* Политики безопасности:

  * запрет выдачи данных вне scope
  * redaction чувствительных полей (конфиг)
  * audit trail “какие документы/таблицы использованы”

**Векторный поиск**

* MVP: `pgvector` в Postgres.
* Позже: Qdrant/OpenSearch Vector, если нагрузка вырастет.

---

## 5) Стек (целевой) 🧰

### Backend

* Python 3.12, FastAPI
* SQLAlchemy 2 async + Alembic
* PostgreSQL (+ pgvector)
* Redis
* Background jobs: Celery (или более легкая очередь на старте, но под “мощный продукт” — Celery норм)
* S3/MinIO
* Nginx/Traefik как reverse proxy

### Frontend

* React + TypeScript
* Vite
* TanStack Query
* Data grid: TanStack Table + virtualization (или AG Grid при необходимости enterprise-фич)
* UI kit: shadcn/ui (или MUI, если нужен enterprise-набор)
* Charts: ECharts/Plotly (в UI)

### Infra/Observability

* Docker/Compose → затем Kubernetes (при росте)
* Prometheus+Grafana, Sentry, OpenTelemetry

---

## 6) API требования 🌐

* Версионирование: `/api/v1/...`
* REST + WebSocket (уведомления, live updates — поэтапно).
* Фильтрация/сортировка: единый DSL (без ad-hoc параметров).
* Идемпотентность: заголовок `Idempotency-Key` для платежей/импортов/интеграций.
* Rate limits per org/user.

---

## 7) Тестирование и качество (обязательно) 🧪

### Pytest стратегия

* Unit: services (бизнес-логика) — максимум покрытия.
* Integration: repositories + Postgres/Redis (через testcontainers или отдельный CI сервис).
* API tests: критичные эндпоинты (auth, RBAC, table CRUD, billing gates, AI usage).
* Contract tests для интеграций (webhooks/payments).
* Нагрузочные тесты (минимум сценарии на таблицы/фильтры/импорт).

### Quality gates в CI

* ruff (lint), formatting
* pytest + coverage threshold (поэтапно повышать)
* миграции: проверка применения Alembic
* security checks (deps scan)

---

## 8) Биллинг и планы 💰

* Plans: Free/Team/Business (примерно), **AI только в платных**.
* Subscription: статус, период, автопродление.
* Usage accounting:

  * AI tokens
  * (опционально) storage, seats, API calls
* Платежный провайдер: ЮKassa (RU) / Stripe (если глобально).
* Webhooks платежей: подписи, идемпотентность, повторная обработка.

---

## 9) MVP vs Full: границы 📦

### MVP (чтобы быстро получить мощное ядро)

1. Core: org/users/RBAC/audit/files/notifications
2. Tables: schema + records + views + import/export + comments
3. Reports: базовые агрегаты + экспорт
4. Knowledge base: версии + права + поиск
5. Billing gate + AI: usage + лимиты + RAG по KB (потом таблицы)

### Post-MVP (масштаб)

* Advanced automation rules (trigger→action)
* Real-time collaborative edits (сложно; отдельный этап)
* OpenSearch/ES, выделенные read-реплики
* Kubernetes, multi-region DR

---

## 10) Acceptance Criteria (критерии готовности) ✅

* Любой запрос к данным невозможен без `org_id` scope и RBAC.
* Любое изменение таблиц/записей/KB отражается в audit log.
* Импорт/экспорт и отчеты не блокируют API — только через jobs.
* AI недоступен без активного плана, usage пишется всегда, лимиты работают.
* CI не пропускает код без тестов на критичный функционал.

---
