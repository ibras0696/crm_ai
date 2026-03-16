# Platform Hardening Sprint Plan

## Context

Этот план закрывает три текущих класса риска:

1. Runtime-проблемы в background tasks и диагностике ошибок
2. Хрупкость локального и будущего staging/prod запуска из-за портов и окружения
3. Регрессии на стыках модулей и размытая конфигурационная модель

Принципы реализации:

- не лечить симптомы точечными патчами
- не дублировать retry/logging/config логику по модулям
- выносить общие решения в инфраструктурный слой
- избегать слабых и хрупких решений вида `if env == ...`, random-port hacks и `try/except Exception` как основного механизма стабильности

## Sprint 1. Runtime Hardening

### Цель

Убрать реальные runtime-дефекты в background flow и сделать ошибки задач диагностируемыми.

### Что делаем

- Исправляем `BaseTaskWithRetry.on_failure`
  - убираем конфликтные ключи `args`, `msg`, `exc_info` и подобные из `extra`
  - вводим безопасный формат structured logging для Celery task failures
- Выносим общий helper для safe logging фоновых задач
- Проверяем и стабилизируем fail-path для:
  - billing lifecycle
  - docs cleanup и docs AI jobs
  - notifications email
  - schedule reminders
- Добавляем регрессионные тесты именно на падение задач и retry/failure path

### Что получаем до

- worker жив, но при падении задачи лог может развалиться
- сложно понять, что именно упало, с каким контекстом и почему

### Что получаем после

- любая упавшая задача пишет корректный структурированный лог
- видно `task_name`, `task_id`, безопасные args/kwargs/meta, exception и stacktrace
- расследование проблем в billing/docs/notifications становится быстрым и предсказуемым

### Definition of Done

- падение любой critical Celery task больше не ломает логирование
- есть тест на `on_failure`
- есть единый helper/utility, а не дублирование логики по task-модулям

## Sprint 2. Compose and Environment Isolation

### Цель

Сделать dev/staging окружения предсказуемыми и независимыми от соседних compose-проектов на машине.

### Что делаем

- Убираем обязательную публикацию всех внутренних сервисов на хост по умолчанию
- Делим сервисы на:
  - internal-only
  - externally published
- Для dev по умолчанию публикуем только то, что реально нужно пользователю:
  - `api`
  - `frontend`
  - опционально `grafana`
  - опционально `minio console`
- Для `db`, `rabbitmq`, `redis`, `minio` делаем публикацию host ports опциональной, а не обязательной
- Выносим host-port конфигурацию в единый env слой
- Вводим профили:
  - `dev`
  - `dev-exposed`
  - `infra-debug`

### Что получаем до

- любой другой локальный проект может сломать запуск
- стек зависит от того, свободны ли `5432`, `5672`, `15672`, `9000`
- dev ergonomics хрупкая

### Что получаем после

- проект поднимается стабильно даже рядом с другими compose-стеками
- внешние порты включаются осознанно, а не всегда
- окружение становится воспроизводимым и менее хрупким

### Definition of Done

- базовый dev-стек стартует без обязательного bind внутренних infra ports на host
- опубликованные порты управляются через единый env/config контракт
- нет shell-hack логики с поиском случайных свободных портов

## Sprint 3. Config and Secret Architecture

### Цель

Разделить app config, runtime config и secrets так, чтобы модель была пригодна для production.

### Что делаем

- Формализуем типы конфигурации:
  - app config
  - credentials/secrets
  - runtime mutable settings из БД
- Вводим единый typed settings слой
- Фиксируем, что хранится:
  - в env
  - в БД
  - только в secret storage
- Оставляем `secrets.yml` только как local dev override
- Готовим production-ready стратегию secret management:
  - Docker secrets
  - Vault
  - cloud secret manager
  - или другой один официальный способ

### Что получаем до

- dev-модель удобна, но operational model ещё размыта
- есть риск утащить локальные паттерны в staging/prod

### Что получаем после

- понятно, где живёт каждая настройка и каждый секрет
- проще ротация, аудит и деплой
- ниже риск утечек и конфигурационной путаницы

### Definition of Done

- есть документированный config contract
- `secrets.yml` больше не выглядит как operational source of truth
- runtime-sensitive значения не размазаны по коду и compose-файлам

## Sprint 4. Integration Contracts Between Modules

### Цель

Закрыть главный архитектурный риск проекта: регрессии на стыках модулей.

### Что делаем

- Формализуем публичные контракты между модулями:
  - AI <-> billing
  - docs <-> storage / onlyoffice / antivirus
  - notifications <-> SMTP / retry policy
  - superadmin <-> runtime config
  - billing <-> notifications
- Для каждого стыка описываем:
  - входной контракт
  - ошибки
  - retry semantics
  - idempotency expectations
  - observability
- Добавляем integration/contract tests на critical flows:
  - payment -> subscription state -> reminders -> downgrade -> trim
  - docs upload -> scan -> versioning -> retention cleanup
  - SMTP temporary fail vs permanent fail
  - AI blocked/unblocked by billing state and token state
- Убираем скрытые зависимости между сервисами и внутренними моделями соседних модулей

### Что получаем до

- изменение одного модуля может сломать другой неочевидно
- большая часть риска уже не в фичах, а в стыках между ними

### Что получаем после

- изменения становятся безопаснее
- регрессии ловятся на contract/integration уровне
- скорость разработки растёт без роста хрупкости

### Definition of Done

- для critical межмодульных flows есть integration tests
- модули используют публичные контракты, а не внутренности друг друга
- критические стыки документированы и наблюдаемы

## Priority

### P0

- починка Celery fail logging
- compose isolation
- integration tests для billing/docs/notifications critical flows

### P1

- новая config/secret architecture
- operational observability и alerting для critical background jobs

### P2

- дальнейшее снижение связности модулей
- cleanup remaining infra rough edges

## Recommended Execution Order

Практический порядок выполнения:

1. Sprint 1 + Sprint 2
2. Sprint 4
3. Sprint 3

Причина:

- сначала надо стабилизировать runtime и окружение
- потом зафиксировать межмодульные контракты
- затем довести config/secrets до production-grade модели

## Visual Outcome

### До

- проект мощный, но чувствительный к окружению
- background failures диагностируются неровно
- локальный запуск зависит от портовой среды хоста
- регрессии чаще всего рождаются на стыках модулей
- конфигурация удобна для dev, но ещё не operational-grade

### После

- фоновые задачи диагностируются корректно и предсказуемо
- dev/staging среды поднимаются стабильно
- конфигурация и секреты разделены по ролям
- межмодульные контракты формализованы и покрыты тестами
- путь к production становится инженерно понятным, а не ситуативным

## Anti-Patterns We Explicitly Avoid

- random-port hacks как основной способ решения конфликтов
- копипаст retry/logging/config логики по модулям
- размазывание secret access по бизнес-сервисам
- стабилизация системы через broad `except Exception` и `|| true`

