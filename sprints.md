

---

## Sprint 0 — Подготовка (1–3 дня) ⚙️

**Цель:** чтобы дальше не переписывать фундамент.

* Репозитории/монорепо, CI skeleton
* Docker Compose: api, db, redis, minio
* Базовая структура backend (layers: api/services/repos/uow), базовая структура frontend
* Линтеры/форматтеры, pre-commit
* Pytest каркас, фикстуры, тестовая БД

**DoD:** поднять проект одной командой, CI гоняет линтер+пустые тесты.

---

## Sprint 1 — Multi-tenant Core + Auth 🔐

**Цель:** пользователь регистрирует org и получает рабочий tenant.

* Регистрация/логин, refresh tokens, сессии (stateless JWT)
* Создание Organization при регистрации (Owner)
* Инвайты пользователей в org
* Базовые модели: org, user, membership, role (пока простые)
* API v1, единый error format, correlation-id

**DoD:** новый org создаётся, пользователь в нём owner, приглашённый заходит и видит только свой org. Тесты на auth/tenant-scope.

**Подводный камень:** если не зафиксировать tenant-scope сейчас — потом переписывание всех запросов.

---

## Sprint 2 — RBAC v1 + Audit log 🧾

**Цель:** безопасность и трассируемость на уровне продакшена.

* RBAC: роли (owner/admin/manager/employee/read-only)
* Permission checks в сервисном слое
* Audit log: кто/что/когда/откуда (actor, org, entity, action, diff/meta)
* Админка org-level: пользователи/роли/права

**DoD:** запрещённые действия реально блокируются; любые изменения ключевых сущностей пишутся в audit. Тесты на permissions + audit.

---

## Sprint 3 — Files/Attachments + Notifications base 📎

**Цель:** фундамент под знания, комментарии, отчёты.

* MinIO/S3 интеграция: upload/download, signed URLs
* Привязка файлов к сущностям (attachment linking)
* Notifications: in-app модель + email sender интерфейс (без сложной логики)
* Background jobs каркас (Celery/альтернатива) + Redis

**DoD:** файл можно прикрепить к сущности, всё в org-scope, есть job worker, уведомления пишутся в БД. Интеграционные тесты на S3/minio мок/локально.

---

## Sprint 4 — Tables: Schema Designer (метаданные) 🧩

**Цель:** конструктор таблиц как Airtable (без “Excel”).

* Сущности: table, field, field_type, constraints
* CRUD таблиц и полей
* Валидация схемы (права, типы, обязательность)
* Frontend: базовый UI “список таблиц → таблица → поля”

**DoD:** можно создать таблицу, добавить поля, видеть структуру. Тесты на схему и права.

---

## Sprint 5 — Records CRUD + JSONB storage + Pagination 📦

**Цель:** реальные данные в таблицах.

* Records: хранение `data JSONB`, strict validation по field schema
* CRUD записей, bulk create/update/delete
* Пагинация (желательно keyset), фильтр по базовым типам
* Индексы: org_id, table_id, created_at + GIN по JSONB (минимум)

**DoD:** 10k записей не “убивают” API на листинге; запреты RBAC работают. Нагрузочный мини-тест (хотя бы локальный сценарий).

**Подводный камень:** без индексов и keyset pagination таблицы “умрут” на раннем росте.

---

## Sprint 6 — Views v1 + Sorting/Filtering + Inline edit 🧱

**Цель:** продукт начинает ощущаться удобным.

* Views: сохранённые представления (filter/sort/visible columns)
* Inline editing ячеек, массовые операции
* Комментарии к записи + activity feed (минимум)
* Импорт/экспорт CSV (XLSX позже)

**DoD:** пользователь на фронте работает как в “простом Airtable”: открывает view, фильтрует, редактирует, видит историю действий.

---

# MVP-версия готова (после Sprint 6)

Дальше — то, что делает “сильный SaaS”, а не просто таблички.

---

## Sprint 7 — Knowledge Base v1 (версии + права) 📚

**Цель:** база знаний для сотрудников.

* Spaces/Pages/Revisions (версионирование)
* Draft/Publish, права на space/page
* Поиск v1 (Postgres FTS)
* UI: дерево страниц + редактор (минимум Markdown/blocks)

**DoD:** история версий работает, права работают, поиск находит.

---

## Sprint 8 — Reports v1 + Exports (PDF/PNG) 📊

**Цель:** управленческие отчёты.

* Агрегаты по таблицам/вьюхам (count/sum/avg, group by)
* Планировщик генерации отчётов (jobs)
* Экспорт PDF/PNG (matplotlib на бэке допустим)
* UI: конструктор отчёта + список отчётов

**DoD:** отчёт строится фоном, доступ по RBAC, экспорт скачивается.

---

## Sprint 9 — Billing core + Plans + Feature gating 💳

**Цель:** монетизация и платный доступ к AI.

* Plans/Subscriptions, статусы, лимиты
* Webhooks платежной системы (идемпотентность обязательно)
* Feature gates (AI выключен без плана)
* Admin org-level: тариф/лимиты/оплата/инвойсы (минимум)

**DoD:** без активного плана AI недоступен; платежный вебхук безопасно обрабатывается повторно.

**Подводный камень:** без идемпотентности вебхуков будут двойные списания/дубли.

---

## Sprint 10 — AI Agent v1 (paid) + Usage metering 🤖

**Цель:** платный AI в рамках прав и данных org.

* Usage accounting: tokens_in/out, cost, user/org, request_id
* Лимиты: budget/day/month + hard stop
* RAG по Knowledge Base (pgvector)
* Agent tools: поиск KB + генерация summary/инструкций
* Политики: AI наследует RBAC пользователя, audit trail “что читалось”

**DoD:** AI даёт ответы по KB, usage считается, лимиты режут, логируется.

---

## Sprint 11 — Scheduling v1 (смены/встречи/уведомления) 🗓️

**Цель:** управление людьми и событиями.

* Shifts (графики смен), назначение, статусы
* Встречи внутри системы (без Google синка на старте)
* Напоминания (email + in-app), timezone
* UI календаря (минимально)

**DoD:** можно назначить смену/встречу, уведомления приходят по расписанию.

---

## Sprint 12 — Hardening: HA/Perf/Observability/Security 🔥

**Цель:** “мощный и оптимизированный продукт”.

* Observability: метрики, Sentry, трассировка, алерты
* Perf: профилирование медленных эндпоинтов, индексы, кеширование
* DR/Backups: автоматические бэкапы + проверка восстановления
* Security review: rate limit, brute-force, OWASP, секреты, CSP
* Load test сценарии для таблиц/вьюх/отчетов

**DoD:** SLO/SLI (latency/error rate) определены, алерты настроены, есть проверенный restore, выдерживаются целевые нагрузки.

---

# Параллельные “дорожки” (чтобы не тормозить)

В каждом спринте обязательно:

* ✅ **Pytest**: минимум unit на services + интеграционные на репозитории/критичные API
* ✅ **Миграции Alembic**
* ✅ **Контроль качества в CI**
* ✅ **Security базовый**: org-scope, RBAC, audit (где применимо)

---

## Жёсткие границы (что НЕ делать до нужного этапа) 🚫

* Реалтайм коллаб (как Google Sheets) — **не раньше post-MVP**.
* “Excel 1:1” — **никогда**, только Airtable-стиль.
* Полный BI/OLAP — после появления реальных нагрузок и метрик.

---
