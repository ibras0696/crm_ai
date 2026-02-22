# Backend: Рефактор структуры, тестов и админки (рабочие заметки Codex)

## Цели (без костылей)
- Разнести ответственность по слоям: `routes` (HTTP) / `schemas` (валидация) / `service` (бизнес-логика) / `repository` (SQLAlchemy запросы).
- Тесты рядом с модулем: `src/modules/<module>/tests/*`.
- Общие фикстуры и тесты инфраструктуры: на уровне `backend/` (общий `conftest.py`) + `backend/tests/*` только для infrastructure/common/middleware/integration.
- Довести покрытие ключевых модулей до 60-80% (постепенно, без ломки).

## План работ (таски)

### 1) Структура тестов
- [ ] Перенести общий `conftest` в `backend/conftest.py`, чтобы он работал для тестов в `src/modules/**/tests`.
- [ ] Обновить `backend/pyproject.toml`: `testpaths = ["tests", "src/modules"]`.
- [ ] Перенести тесты модулей:
  - [ ] `auth`: регистрация/логин/refresh/logout.
  - [ ] `org`: инвайты/accept/resend/rate-limit.
  - [ ] `tables`: таблицы/колонки/записи/export/import.
  - [ ] `ai`: лимиты/статус/история/валидация экшенов.
  - [ ] `access`: deny-by-default после появления правил.
  - [ ] `schedule`: диапазоны + recurrence.
- [ ] Оставить в `backend/tests` только:
  - [ ] health/readiness/metrics
  - [ ] middleware/common/infrastructure
  - [ ] интеграционные сценарии, пересекающие несколько модулей

### 2) Рефактор “все в одном файле”
- [ ] `ai`: разнести `routes.py` на несколько endpoint-файлов (`chat/status/context/sessions/...`) и оставить агрегатор.
- [ ] `tables`: вынести export/import в отдельный файл/сервис (без изменения API контрактов).
- [ ] `superadmin`: разнести “дашборд/орг/юзеры/таблицы/ai” по отдельным сервисам/репозиториям.

### 3) Покрытие 60-80% (ключевые модули)
- [ ] Добавить измерение покрытия (`pytest-cov`) и целевые метрики по модулям.
- [ ] Приоритет тестов:
  - [ ] access (403/200)
  - [ ] invites (resend + rate-limit)
  - [ ] ai limits (daily/rpm/per-request)
  - [ ] exports (csv/xlsx)
  - [ ] superadmin auth + dashboard endpoints

### 4) Суперадминка (feature-идеи)
- [ ] Общая аналитика:
  - orgs/users/tables/records/files/storage
  - ai usage (requests/tokens, top org/users)
  - billing: планы/подписки/конверсия
- [ ] “Как Django admin”:
  - список таблиц БД (моделей) + просмотр строк + фильтры (без произвольного SQL)
  - просмотр пользовательских таблиц (Tables module) по всем org

### 5) Модуль документов (Word/PDF) (epic)
- [ ] Хранилище:
  - папки (дерево) + документы + версии (S3/MinIO)
  - права доступа через Access Rules
- [ ] Конструктор:
  - шаблоны DOCX (python-docx) и генерация PDF (reportlab) или конвертация через безопасный пайплайн
- [ ] Подпись в PDF:
  - базовая: изображение подписи + позиционирование по страницам
  - продвинутая: крипто-подпись (требует отдельного согласования, библиотек и политики ключей)

## Принятые решения
- `conftest.py` будет на уровне `backend/`, чтобы фикстуры работали из `src/modules/**/tests` без дублирования.
- Интеграционные сценарии (которые пересекают модули) остаются в `backend/tests/integration`.

