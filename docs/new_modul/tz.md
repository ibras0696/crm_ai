Вывод: делаем модуль **Docs/Files** строго в твоих паттернах: **router/handler → service → repository (через UoW)** + инфраструктурные адаптеры (**S3, AV, OnlyOffice/Collabora, PDF-stamp, AI**). Файл — это **версионируемый объект в S3**, БД — только метаданные/права/квоты. ✅

---

# ТЗ (v2): Модуль “Docs/Files” с учетом паттернов проекта

## 1) Цель модуля 🎯

Добавить в CRM модуль, который:

* хранит документы (TXT/PDF/DOCX) в **S3**,
* отображает в дереве папок глубиной **не более 2**,
* поддерживает upload/download,
* поддерживает редактирование:

  * TXT — в приложении,
  * DOCX — через **OnlyOffice/Collabora**,
  * PDF — просмотр + аннотации + **ручная подпись** (stamp в новый PDF),
* генерирует документы через **AI** (TXT/DOCX/PDF),
* учитывает тарифные квоты (Free 500MB, Team 10GB, Business 100GB) и показывает usage,
* обеспечивает безопасность (AV-скан, allow-list типов, защита от уязвимых файлов),
* покрытие тестами backend ≥ **80%**.

---

## 2) Обязательные паттерны и правила реализации 🧱

### 2.1 Слои (как в проекте)

* **API слой (FastAPI routers/handlers)**: только валидация входа/выхода, auth, вызов use-case.
* **Application/Service слой**: бизнес-логика (квоты, статусы, правила дерева, версии, доступы).
* **Domain слой**: сущности/enum/инварианты (FileStatus, FileType, ограничения глубины).
* **Infrastructure слой**: адаптеры интеграций (S3, AV, OnlyOffice/Collabora, AI, PDF stamping).
* **Repository слой**: доступ к БД (CRUD + выборки), без commit.
* **UoW**: единая транзакция на юзкейс. Commit/rollback только в UoW.

### 2.2 Нефункциональные стандарты

* SQLAlchemy async, Alembic миграции (никаких `create_all`).
* Без блокирующих операций в event loop (скан/конверсия/генерация — только Celery).
* Валидации типов: **magic bytes** + mime, не доверять расширению.
* Все операции редактирования → **новая версия**, не перезаписывать один и тот же S3 key.

---

## 3) Границы модуля (что входит/не входит) 📦

### Входит

* Папки (глубина ≤ 2)
* Файлы + версии
* Presigned upload/download
* AV-скан gating (до скана файл недоступен)
* TXT редактор
* DOCX редактор через OnlyOffice/Collabora
* PDF подпись (stamp) через worker
* AI генерация файлов
* Квоты/usage по тарифу
* RBAC (минимум viewer/editor/admin)

### Не входит (чтобы не утонуть)

* Криптографическая подпись сертификатами (PKI/eIDAS)
* Конвертер “любой формат”
* Полноценный коллаборативный режим (можно позже)

---

## 4) Данные и инварианты (БД = метаданные) 🗃️

### 4.1 Сущности

1. **folders**

* `id, org_id, name, parent_id null`
* инвариант: глубина ≤ 2

2. **files**

* `id, org_id, folder_id, type (TXT/PDF/DOCX), title, status, current_version_id`
* `status`: `DRAFT/UPLOADING/SCANNING/READY/BLOCKED/DELETED`

3. **file_versions**

* `id, file_id, s3_key, size_bytes, sha256, mime, created_by, created_at`
* опционально: `meta_json` (для PDF: список подписей/аннотаций)

4. **org_storage_usage**

* `org_id, used_bytes, reserved_bytes, updated_at`

5. (опционально) **file_locks**

* `file_id, locked_by, locked_until` (для DOCX редактирования)

6. **audit_events** (рекомендовано)

* кто/что/когда: upload, download, edit, sign, delete, ai_generate.

### 4.2 Ограничения на уровне БД (обязательно)

* Ограничение глубины папок (constraint/trigger): запрет `parent_id`, у которого `parent_id` уже не null.
* Уникальность имени папки в пределах одного parent+org (по желанию).
* FK и soft delete правила.

---

## 5) Квоты и тарифы 💾

### 5.1 Тарифные лимиты

* Free: 500MB
* Team: 10GB
* Business: 100GB

### 5.2 Логика учета (инвариант)

* `used_bytes` = сумма **размеров current_version** по файлам организации (или поддерживаем инкрементально).
* `reserved_bytes` используется при `init-upload`, чтобы параллельные загрузки не пробивали лимит.
* Юзкейс `init-upload` блокирует строку usage `SELECT ... FOR UPDATE` внутри UoW.

### 5.3 Конфиг ограничения размера файла

* `MAX_UPLOAD_BYTES_GLOBAL`
* `MAX_UPLOAD_BYTES_BY_PLAN` (опционально)
* Валидация на `init-upload` и повторно на `finish-upload`.

---

## 6) S3 хранение и ключи 🔐

* Bucket **private**
* Ключ: `org/{org_id}/files/{file_id}/v/{version_id}`
* Никогда не обновлять объект “на месте” (иначе нет аудита/отката).
* Доступ к файлам только через **presigned URLs** с коротким TTL.

---

## 7) Безопасность (AV + allow-list + gating) 🛡️

### 7.1 Обязательное

* Allow-list: только TXT/PDF/DOCX.
* Проверка magic bytes на backend (инфра адаптер).
* **ClamAV** (или эквивалент) как отдельный сервис.
* До скана файл в `SCANNING` и недоступен для download/open.
* При угрозе: `BLOCKED` (доступ запрещен, можно удалить и посмотреть причину админам).

### 7.2 Запреты (жестко)

* DOCM / макросы
* архивы, exe, “двойные расширения”
* доверие `Content-Type` от клиента — запрещено

---

## 8) Редактирование по типам ✍️

### 8.1 TXT

* фронт редактирует текст
* backend `save-text` → создает новую версию (S3) → статус READY → usage обновлен

### 8.2 DOCX

Интеграция через инфраструктурный адаптер **DocumentEditorProvider**:

* Реализация A: OnlyOffice
* Реализация B: Collabora
  Юзкейс:
* `open-docx` возвращает конфиг/URL для web-редактора + токен
* редактор по callback “save” отправляет файл/ссылку → backend создает **новую версию** → READY → ставит AV-скан (как для любого входящего файла)

Опционально:

* lock на время редактирования

### 8.3 PDF + ручная подпись

* фронт: PDF.js, подпись рисуется на canvas
* backend: `pdf/sign` создает job → Celery `pdf_stamp_sign`
* worker: берет исходную версию + подпись (png/вектор) + координаты → генерит новый PDF → новая версия → AV-скан → READY

---

## 9) AI генерация 🤖

Адаптер **AiDocumentGenerator** (у тебя уже есть AI модуль — подключаемся через него).
Endpoint: `ai/generate`

* вход: тип (TXT/DOCX/PDF), тема, структура, язык, шаблон (опционально)
* выход: `file_id`, `job_id`, статус

Worker:

* генерирует контент
* собирает файл:

  * TXT: plain
  * DOCX: python-docx по шаблону стилей
  * PDF: HTML→PDF по шаблону (предпочтительно)
* кладет в S3 как новую версию
* запускает AV-скан (даже для AI)

---

## 10) API контракты (в стиле проекта) 🔌

Базовый префикс: `/api/v1/docs/...`

### Folders

* `POST /docs/folders` — создать папку
* `PATCH /docs/folders/{id}` — переименовать/переместить (с проверкой глубины)
* `DELETE /docs/folders/{id}` — удалить (политика: либо запрет если не пустая, либо каскад soft-delete)

### Tree

* `GET /docs/tree` — дерево папок + файлы (глубина ≤ 2)

### Upload/Download

* `POST /docs/files/init-upload` — квота+presigned PUT
* `POST /docs/files/finish-upload` — фиксация + скан
* `GET /docs/files/{id}` — метаданные/статус/usage
* `GET /docs/files/{id}/download` — presigned GET (только READY)

### Edit

* `POST /docs/files/{id}/save-text`
* `POST /docs/files/{id}/open-docx`
* `POST /docs/files/{id}/pdf/sign`

### AI

* `POST /docs/files/ai/generate`

### Usage

* `GET /docs/usage` — used/limit/percent (+ breakdown optional)

---

## 11) Celery задачи (инфра) ⚙️

* `scan_version(version_id)` → READY/BLOCKED
* `pdf_stamp_sign(version_id, payload)` → new_version + scan
* `ai_generate(job_id)` → new_version + scan
* (опционально) `cleanup_deleted()` → удаление S3 объектов по retention

---

## 12) Тестирование ≥ 80% ✅

### 12.1 Что тестируем обязательно (service-слой)

* квоты + reserved_bytes, параллельные init-upload (гонки)
* запрет глубины папок > 2 (и на DB, и на сервисе)
* статусы жизненного цикла (UPLOADING/SCANNING/READY/BLOCKED)
* RBAC доступы
* валидация типа (magic bytes) + size limit
* версионирование: каждый save/edit/sign → новая версия

### 12.2 Интеграционные тесты

* MinIO (test container) для presigned upload/download
* Postgres + Alembic миграции
* Celery: eager режим для unit, отдельный воркер для integration (по CI решению)
* AV: мок адаптера (чтобы CI не тянул сигнатуры)

Критерии приемки:

* Нельзя скачать/открыть файл до окончания скана
* Нельзя загрузить сверх квоты даже параллельно
* DOCX сохраняется из редактора в S3 как новая версия
* PDF подпись создает новый PDF и отображается
* usage совпадает с суммой размеров актуальных версий

---

## 13) Интеграция в структуру проекта (чтобы “по паттернам”) 🧩

Рекомендуемая структура модуля:

* `src/api/v1/docs/routers.py` (handlers)
* `src/application/docs/services/*.py` (use-cases)
* `src/domain/docs/entities.py` + `enums.py` + `errors.py`
* `src/infrastructure/docs/storage_s3.py` (StorageProvider)
* `src/infrastructure/docs/antivirus.py` (AntivirusProvider)
* `src/infrastructure/docs/doc_editor_onlyoffice.py` / `doc_editor_collabora.py`
* `src/infrastructure/docs/pdf_stamper.py`
* `src/infrastructure/docs/ai_generator.py`
* `src/infrastructure/docs/tasks.py` (celery tasks)
* `src/infrastructure/db/repositories/docs_*_repo.py`
* `src/infrastructure/db/uow.py` (общий UoW проекта используется)

Интерфейсы (обязательные абстракции):

* `StorageProvider`
* `AntivirusProvider`
* `DocumentEditorProvider`
* `AiDocumentGenerator`

---

## 14) Анти-паттерны (запрещено) ⚠️

* Самописный DOCX/PDF редактор
* Перезапись одного S3 key без версий
* Публичный bucket
* Отдача файла до AV-скана
* Проверка типа только по расширению/Content-Type

---

## 15) MVP план (без воды) 🚀

**Sprint 1 (ядро):**

* DB схемы + миграции
* folders/tree
* init/finish upload + S3 + reserved/used
* AV gating + statuses
* download presigned
* usage endpoint
* тесты на квоты/дерево/статусы/RBAC

**Sprint 2 (редактирование/AI):**

* TXT editor save
* PDF sign (stamp worker)
* OnlyOffice/Collabora open+save callback
* AI generate pipeline
* метрики/аудит события

---

Если ты скажешь **какой DOCX-редактор выбираем для MVP (OnlyOffice или Collabora)** — я зафиксирую это в ТЗ “как стандарт” и добавлю точный контракт callback’а/токенов и список контейнеров в prod compose без расплывчатости.
