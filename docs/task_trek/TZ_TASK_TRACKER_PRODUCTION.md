# ТЗ Task Tracker (Production-ready) для CRM AI

Версия: 1.0  
Дата: 26 мая 2026  
Контур: `crm.py-it.ru`  
Модуль: `Task Tracker` (Kanban + Task Details + Task Create)

## 1. Что проанализировано

Исходники:
- `docs/task_trek/tz.md`
- `docs/task_trek/tz_componetns.md`
- `docs/task_trek/ChatGPT Image 25 мая 2026 г., 23_42_05 (1).png`
- `docs/task_trek/ChatGPT Image 25 мая 2026 г., 23_42_05 (2).png`
- `docs/task_trek/ChatGPT Image 25 мая 2026 г., 23_59_04 (1).png`
- `docs/task_trek/ChatGPT Image 25 мая 2026 г., 23_59_04 (2).png`

Вывод по макетам:
- Поддерживаются 2 темы: light/dark, единый layout CRM.
- Основной экран: Kanban + KPI + фильтры + правая панель задачи без ухода со страницы.
- Экран задачи: обзор, чек-лист, подзадачи, комментарии, файлы, активность + мета-блок справа.
- Экран создания: большая форма + правая колонка планирования/шаблонов.
- UI рассчитан на высокую плотность данных и быстрые операции без лишней навигации.

## 2. Цели и границы

Цели:
- Дать управляемый task-flow внутри CRM, без внешних сервисов.
- Обеспечить масштабируемость по объему задач, комментариев, вложений, активности.
- Обеспечить безопасную многопользовательскую работу с ролями и аудитом.
- Обеспечить стабильный UX при высокой нагрузке.

Вне MVP:
- Полноценные BI-отчеты.
- Автоматизации уровня workflow-engine (сложные правила/скрипты).
- Offline-first.

## 3. Пользовательские роли и доступ

Роли:
- `admin`
- `manager`
- `member`
- `viewer`

Матрица доступа:
- `admin`: полный доступ, включая удаление/архив, права, шаблоны, восстановление.
- `manager`: создание/редактирование/назначение/изменение статусов задач команды.
- `member`: работа с доступными задачами, комментарии, чек-листы, вложения.
- `viewer`: чтение + комментарии (по политике компании).

Обязательные правила:
- Любое действие проверяется на уровне backend (не только UI).
- Массовые операции требуют отдельного permission.
- Удаление задачи по умолчанию soft-delete (архив), hard-delete только `admin`.

## 4. Функциональные требования

## 4.1 Экран доски (Kanban)

Обязательно:
- Колонки: `backlog`, `todo`, `in_progress`, `review`, `done`, `cancelled`.
- Drag-and-drop карточки с оптимистичным UI и rollback при 409/403/5xx.
- Правая панель задачи открывается поверх контекста доски.
- Поиск: `id`, `title`, `description`, `project`, `tags`.
- Фильтры: проект, исполнитель, приоритет, дедлайн, статус, теги.
- KPI-карточки: просрочено, сегодня, в работе, завершено.

Для больших объемов:
- Пагинация в колонках курсором.
- Виртуализация карточек (по колонкам).
- Отложенная подгрузка тяжелых данных карточки (минимальный payload на доске).

## 4.2 Экран задачи

Обязательно:
- Хлебные крошки: `Task Tracker / Sprint / TASK-ID`.
- Вкладки: обзор, комментарии, подзадачи, файлы, активность.
- Быстрые действия: редактировать, поделиться, история, еще.
- Блоки: описание, прогресс, чек-лист, зависимости, связанные задачи.

Поведение:
- Быстрые inline-операции: отметить пункт чек-листа, сменить статус подзадачи.
- Конфликт обновлений через `version`/`updated_at` (optimistic locking).
- При блокирующей зависимости закрытие задачи запрещено с понятной ошибкой.

## 4.3 Экран создания задачи

Обязательно:
- Поля: title, project, status, priority, assignee/reporter, deadline (по политике).
- Поддержка: checklist, subtasks, attachments, tags, relations.
- Кнопки: создать, сохранить черновик, отмена.
- Autosave черновика с дебаунсом.

Валидации:
- `title`: 3..150.
- Дата начала <= дедлайн.
- Оценка времени >= 0.
- Ограничения файлов по MIME/размеру.

## 4.4 Комментарии и вложения

Комментарии:
- CRUD с правами.
- `@mentions`, ссылки на задачи (`TASK-123`).
- Идемпотентная отправка через `client_message_id`-аналог для комментариев.

Вложения:
- Загрузка через pre-signed URL (MinIO/S3-совместимо).
- Антивирусная проверка на этапе finalize.
- TTL для download-url, выдача только авторизованным пользователям.

## 5. Контракты API (минимум)

Базовый префикс:
- `/api/v1/task-tracker`

Ключевые endpoints:
- `GET /boards/{board_id}/tasks?cursor=&limit=&filters=...`
- `PATCH /tasks/{task_id}/status`
- `GET /tasks/{task_id}`
- `POST /tasks`
- `PATCH /tasks/{task_id}`
- `POST /tasks/{task_id}/archive`
- `GET|POST /tasks/{task_id}/comments`
- `PATCH|DELETE /comments/{comment_id}`
- `GET|POST|PATCH|DELETE /tasks/{task_id}/checklist...`
- `POST /tasks/{task_id}/attachments/presign`
- `POST /tasks/{task_id}/attachments/finalize`
- `GET /tasks/{task_id}/activity?cursor=...`

Технические требования к API:
- Cursor-pagination вместо offset для длинных списков.
- Идемпотентность критичных POST (`Idempotency-Key`).
- ETag/If-Match для обновлений задачи.
- Единый формат ошибок (`code`, `message`, `details`, `trace_id`).

## 6. Модель данных (ядро)

Сущности:
- `task`
- `task_checklist_item`
- `task_comment`
- `task_attachment`
- `task_relation`
- `task_activity_log`
- `task_watcher`
- `task_tag`
- `task_draft`

Ключевые поля задачи:
- `id`, `tenant_id`, `project_id`, `board_id`, `sprint_id`
- `title`, `short_description`, `description`
- `status`, `priority`, `assignee_id`, `reporter_id`
- `start_date`, `deadline`, `estimated_hours`, `actual_hours`
- `progress_percent`, `is_draft`, `is_archived`
- `version`, `created_at`, `updated_at`, `archived_at`

Индексы (обязательно):
- `(tenant_id, board_id, status, updated_at desc)`
- `(tenant_id, assignee_id, status, deadline)`
- `(tenant_id, project_id, status)`
- GIN/FTS индекс по `title + description` для поиска.
- `(tenant_id, task_id, created_at)` для comments/activity.

## 7. Нефункциональные требования (NFR)

Производительность:
- P95 загрузки доски (первый экран): <= 1.5s.
- P95 смены статуса карточки: <= 350ms (без учета long-poll retries).
- P95 открытия задачи: <= 800ms.

Надежность:
- SLO API task-tracker: 99.9%/30д.
- Error rate 5xx: < 0.5%.
- Потеря данных по чек-листам/комментариям: 0 (транзакционно).

Масштаб:
- 100k+ задач на tenant.
- 1k+ задач в одной доске.
- 10k+ комментариев в крупных задачах.
- 100+ одновременных активных пользователей на доску.

## 8. Безопасность

Обязательно:
- Tenant isolation в каждом запросе (`tenant_id` в контексте авторизации).
- RBAC + object-level checks.
- Audit-log неизменяемый (append-only).
- Rate limit на создание комментариев/вложений/массовые операции.
- Защита от XSS в rich text (sanitize whitelist).
- CSRF защита для cookie-based auth.
- Проверка MIME + сигнатуры файла, запрет исполняемых форматов.
- Шифрование at-rest для файлов и бэкапов.

Рекомендации:
- Secret scanning в CI.
- Периодические permission-audit сценарии.
- Security headers (CSP, X-Frame-Options, etc.).

## 9. Стабильность и отказоустойчивость

Стратегии:
- Retry policy для idempotent GET/POST finalize (с jitter).
- Circuit breaker на интеграции с object storage/notification.
- Graceful degradation:
- если файл-сервис недоступен, создание задачи доступно без вложения.
- если activity-service деградирован, задача открывается без блока активности.
- Outbox pattern для событий уведомлений.
- Dead-letter queue для неуспешных async-задач.

Данные:
- Soft-delete и возможность восстановления.
- Миграции только вперед (forward-only), rollback через fix migration.
- Ежедневный backup + проверка restore минимум раз в неделю.

## 10. Наблюдаемость и эксплуатация

Метрики:
- `task_board_load_ms`, `task_open_ms`, `task_status_change_ms`
- `task_api_5xx_rate`, `task_api_4xx_rate`
- `attachment_upload_fail_rate`
- `comment_post_fail_rate`
- `db_slow_query_count`

Логи:
- Структурированные JSON-логи.
- Поля: `timestamp`, `level`, `tenant_id`, `user_id`, `trace_id`, `endpoint`, `latency_ms`.

Алерты:
- 5xx > 2% за 5 мин.
- P95 board load > 2.5s за 10 мин.
- рост ошибок загрузки вложений > 3% за 10 мин.

## 11. Архитектурный подход

Backend (FastAPI):
- `routes.py` (тонкие контроллеры)
- `schemas.py` (Pydantic)
- `service.py` (бизнес-логика)
- `repository.py` (SQL/ORM)
- `events.py` (outbox/events)

Frontend (React):
- `pages/task-tracker/*`
- `components/board/*`, `components/task/*`, `components/create/*`
- `hooks/useTaskBoard.ts`, `hooks/useTaskDetails.ts`, `hooks/useTaskCreate.ts`
- `lib/api/taskTrackerClient.ts`

Ограничение размеров:
- Не допускать файлы > 600 строк для новых модулей.

## 12. Работа с большим объемом данных

UI:
- Виртуализация списков карточек/комментариев.
- Инкрементальная подгрузка по курсору.
- Декомпозиция payload: `task_card_light` и `task_full`.
- Debounce поиска (300-400ms), cancel предыдущих запросов.

Backend/DB:
- Cursor queries по индексам.
- Предвычисленные счетчики KPI (материализация/кеш с TTL 30-60с).
- Партицирование activity/comment таблиц при достижении порога.
- Async-обработка тяжелых операций (thumbnail, virus scan, notifications).

## 13. План спринтов

## Sprint 0. Подготовка

Цель:
- Зафиксировать контракт и архитектуру, убрать монолиты UI.

Сделать:
- ADR для Task Tracker (решения по API, pagination, RBAC, attachments).
- Декомпозиция frontend модулей по hooks/components/services.
- Согласование схемы ролей и policy matrix.

Чеклист:
- [ ] Документы ADR и API contract согласованы.
- [ ] Новые frontend-файлы <= 600 строк.
- [ ] Локально: `npm run lint`, `npx tsc --noEmit`, `npm run build`.

## Sprint 1. Core Backend

Цель:
- Надежный CRUD задач и атомарные операции статусов/чек-листов.

Сделать:
- Task/Checklist/Comment/Activity API.
- Optimistic locking (`version`).
- Soft archive + object permissions.
- Cursor pagination для comments/activity/board.

Чеклист:
- [ ] Backend tests покрывают CRUD + permissions + conflicts.
- [ ] Нет lost updates при параллельных PATCH.
- [ ] `ruff` и `pytest` проходят.

## Sprint 2. Kanban + Task Details

Цель:
- Рабочая доска и карточка задачи без деградации UX.

Сделать:
- Kanban columns + DnD + rollback.
- Правая панель деталей и вкладки.
- Фильтры и поиск с серверной пагинацией.

Чеклист:
- [ ] Нет дублей карточек при фильтрации/подгрузке.
- [ ] Стабильный скролл при длинных колонках.
- [ ] Frontend lint/tsc/build проходят.

## Sprint 3. Create Flow + Drafts + Templates

Цель:
- Быстрое и безопасное создание сложных задач.

Сделать:
- Экран создания, autosave draft, шаблоны.
- До-валидации полей + backend валидации.
- Создание чек-листа/подзадач/relations в одной транзакции.

Чеклист:
- [ ] Черновик восстанавливается после перезагрузки.
- [ ] Транзакционная целостность create-flow.
- [ ] UX-сценарии “Cancel with unsaved changes” работают.

## Sprint 4. Attachments + Security Hardening

Цель:
- Безопасная работа с вложениями и защитой данных.

Сделать:
- Presign/finalize pipeline.
- MIME/signature validation, AV scan, URL TTL.
- RBAC hardening + rate limits + audit coverage.

Чеклист:
- [ ] Нельзя скачать файл без прав.
- [ ] Загрузка вредоносного файла блокируется.
- [ ] Критичные действия аудируются.

## Sprint 5. Performance + Scale

Цель:
- Устойчивость при больших досках и long-tail данных.

Сделать:
- Виртуализация, курсоры, кеш KPI.
- Индексы и оптимизация slow queries.
- Нагрузочные сценарии (board open, dnd burst, comment storm).

Чеклист:
- [ ] P95/SLO соответствуют NFR.
- [ ] Нет деградации UX на 1k+ карточках.
- [ ] Профилирование подтверждает улучшения.

## Sprint 6. Prod Rollout

Цель:
- Безопасный запуск на `crm.py-it.ru`.

Сделать:
- Feature flag rollout (internal -> limited tenants -> 100%).
- Dashboards + alerts + smoke scripts.
- Runbook rollback и post-release monitoring 48ч.

Чеклист:
- [ ] Метрики/алерты включены.
- [ ] Rollback-план оттестирован.
- [ ] Нет критических регрессий по auth/files/task.

## 14. Definition of Done (Global)

- [ ] Архитектура модульная, без файлов > 1000 строк.
- [ ] Все новые критичные сценарии покрыты автотестами.
- [ ] CI зеленый по backend и frontend зонам.
- [ ] Документация API/ADR/Runbook обновлена.
- [ ] Наблюдаемость и rollback готовы к прод-эксплуатации.

## 15. Минимальный тест-план

Backend:
- Unit: service/repository/policy.
- Integration: CRUD + permissions + conflicts + pagination.
- Contract: schema-response consistency.

Frontend:
- Unit: hooks/selectors/formatters.
- Integration: board/task/create flows.
- E2E: create -> move -> comment -> attach -> archive.

Нагрузка:
- 200 RPS mixed read/write на board/task APIs.
- Burst: 50 одновременных DnD status updates.
- 500 параллельных upload finalize (малые файлы).

## 16. Риски и меры

Риск:
- Рост latency из-за тяжелых joins.
Мера:
- Денормализация card-view + индексы + курсоры.

Риск:
- Конфликты прав между ролями и tenant policies.
Мера:
- Единый policy engine + integration tests matrix.

Риск:
- Перегрузка UI при длинных колонках.
Мера:
- Виртуализация + lazy fragments + skeletons.

Риск:
- Инциденты по вложениям.
Мера:
- presign/finalize, AV scan, TTL links, audit trail.

