Вывод: разобью на **6 спринтов** с чек-листами (BE/FE/infra) и отдельным блоком **“тестирование + отладка”** в каждом. Предполагаю **DOCX = OnlyOffice**, PDF = **PDF.js + stamp**. ✅

---

# План спринтов (Fullstack) 📌

## Общий DoD для каждого спринта (обязателен) 🧪

* [ ] Все задачи спринта закрыты
* [ ] **Backend**: pytest (unit+integration по спринту), без flaky
* [ ] **Frontend**: базовые тесты (Vitest) + ручной прогон сценариев
* [ ] Логи/метрики не ломаются, ошибки читаемые (correlation_id)
* [ ] Отладка: воспроизвести 2–3 негативных кейса (см. ниже) и зафиксировать фиксы

---

## Sprint 1 — Ядро: сущности + дерево + S3 upload/download (без AV) 🧱

**Цель:** минимально работающий “Docs”: папки (≤2) + файлы + presigned upload/download + usage/reserved.

### Backend ✅

* [ ] Alembic миграции: `folders`, `files`, `file_versions`, `org_storage_usage`
* [ ] DB-ограничение: глубина папок ≤ 2 (constraint/trigger)
* [ ] Domain: `FileType`, `FileStatus`, ошибки (QuotaExceeded, InvalidDepth, InvalidType)
* [ ] Repositories + Services через UoW (без commit в repo)
* [ ] API:

  * [ ] `GET /docs/tree`
  * [ ] `POST/PATCH/DELETE /docs/folders`
  * [ ] `POST /docs/files/init-upload` (reserved_bytes, квота, presigned PUT)
  * [ ] `POST /docs/files/finish-upload` (создать version, status=READY пока без скана)
  * [ ] `GET /docs/files/{id}`
  * [ ] `GET /docs/files/{id}/download` (presigned GET)
  * [ ] `GET /docs/usage`
* [ ] StorageProvider (S3/MinIO): presigned PUT/GET, key scheme `org/.../v/...`

### Frontend ✅

* [ ] UI раздел “Документы”
* [ ] Дерево папок (2 уровня): создать/переименовать/удалить
* [ ] Список файлов в папке: имя, тип, размер, дата
* [ ] Upload flow:

  * [ ] выбрать файл → запрос `init-upload`
  * [ ] PUT в S3 по presigned
  * [ ] `finish-upload`
* [ ] Download кнопка (через presigned GET)
* [ ] Usage: прогресс-бар “занято/лимит”

### Тестирование + отладка 🧪

* [ ] BE unit: квоты + reserved_bytes (в т.ч. параллельные init-upload)
* [ ] BE unit: запрет глубины папок >2
* [ ] BE integration: MinIO upload/download happy-path
* [ ] FE: ручной чек-лист:

  * [ ] параллельно 2 загрузки → не пробить квоту
  * [ ] загрузка файла > max size → ошибка
  * [ ] попытка создать 3-й уровень папок → ошибка

---

## Sprint 2 — Безопасность: AV-скан + gating + строгие типы 🛡️

**Цель:** файл нельзя открыть/скачать до скана. Allow-list типов + magic bytes.

### Backend ✅

* [ ] Добавить статусный пайплайн: `UPLOADING → SCANNING → READY/BLOCKED`
* [ ] AntivirusProvider (ClamAV) + Celery task `scan_version(version_id)`
* [ ] `finish-upload` теперь ставит `SCANNING` и отправляет задачу в Celery
* [ ] Запрет download/open если `status != READY`
* [ ] Валидация типа:

  * [ ] allow-list (TXT/PDF/DOCX)
  * [ ] проверка magic bytes (не верим Content-Type/расширению)
* [ ] Audit event: upload_started/upload_finished/scan_result
* [ ] Метрики: `file_scan_total{result}`, `uploads_total{status}`

### Frontend ✅

* [ ] UI статусы файла: UPLOADING/SCANNING/READY/BLOCKED
* [ ] Поллинг/рефреш статуса после finish-upload
* [ ] Сообщение пользователю: “Файл на проверке”, “Заблокирован (обратитесь к администратору)”

### Тестирование + отладка 🧪

* [ ] BE: тест “до скана download запрещен”
* [ ] BE: тест “поддельный mime/расширение” → reject
* [ ] BE: мок AntivirusProvider в CI (без тяжелых сигнатур)
* [ ] FE: негативный кейс: загрузить “pdf”, который не pdf → показать ошибку

---

## Sprint 3 — TXT редактор + версионирование + аудит/метрики 📄

**Цель:** полноценное редактирование TXT, новая версия на каждое сохранение.

### Backend ✅

* [ ] Endpoint: `POST /docs/files/{id}/save-text`
* [ ] Каждое сохранение → новая запись в `file_versions`, обновление `current_version_id`
* [ ] Пересчет usage (used_bytes) инкрементально (без full scan)
* [ ] Audit: text_saved, version_created
* [ ] Rate limiting на save-text (защита от спама)

### Frontend ✅

* [ ] Встроенный редактор TXT (Monaco/TipTap по выбору)
* [ ] Кнопки: Save, “история версий” (минимум список версий read-only)
* [ ] UX: предупреждение при уходе со страницы с несохраненными изменениями

### Тестирование + отладка 🧪

* [ ] BE unit: versioning (каждый save → новая версия)
* [ ] BE: usage корректно меняется
* [ ] FE: тест “несохраненные изменения” (хотя бы ручной)
* [ ] Регресс: upload/download не сломались

---

## Sprint 4 — PDF: просмотр + подпись (stamp) + новая версия ✍️

**Цель:** PDF.js viewer + “ручная подпись” → backend stamp → новая версия PDF.

### Backend ✅

* [ ] Endpoint: `POST /docs/files/{id}/pdf/sign`

  * payload: page, x/y, width/height, image(stroke/png), author
* [ ] Celery task: `pdf_stamp_sign(version_id, payload)` → создает новый PDF → новая версия → AV-скан
* [ ] Хранение подписи: либо в `meta_json` версии, либо отдельная таблица `pdf_annotations` (на твой вкус)

### Frontend ✅

* [ ] PDF.js просмотр
* [ ] UI подписи: canvas (нарисовать), разместить на странице
* [ ] “Сохранить подпись” → запрос на backend → статус SCANNING/READY
* [ ] Просмотр результата после готовности (обновить ссылку)

### Тестирование + отладка 🧪

* [ ] BE integration: stamp создает новую версию + проходит через scan
* [ ] FE: ручной прогон: подпись на 1-й и 5-й странице, разные координаты
* [ ] Негатив: подпись на BLOCKED/SCANNING → запрет

---

## Sprint 5 — DOCX: OnlyOffice интеграция (редактирование + save callback) 🧩

**Цель:** открыть DOCX в OnlyOffice, сохранить обратно как новую версию в S3.

### Backend ✅

* [ ] DocumentEditorProvider: OnlyOffice
* [ ] Endpoint: `POST /docs/files/{id}/open-docx` → возвращает config/token/url
* [ ] Callback endpoint: `POST /docs/integrations/onlyoffice/callback`

  * проверка подписи/токена
  * получение обновленного файла → новая версия в S3 → AV-скан
* [ ] Опционально: lock (file_locks) на время редактирования

### Frontend ✅

* [ ] Кнопка “Открыть в редакторе” (iframe/redirect)
* [ ] Обработка “файл сохранен” (refresh статуса/версии)
* [ ] UI: если файл не READY → не открывать

### Тестирование + отладка 🧪

* [ ] BE: контрактные тесты callback (моки payload OnlyOffice)
* [ ] Smoke test: реальный DOCX — поправить текст — сохранить — новая версия
* [ ] Негатив: поддельный callback без подписи → 401/403

---

## Sprint 6 — AI генерация + полировка квот/ретеншн + hardening 🤖

**Цель:** AI создает TXT/DOCX/PDF, всё проходит через версии и AV. Финальная стабилизация.

### Backend ✅

* [ ] `POST /docs/files/ai/generate` (type, prompt, template)
* [ ] Celery: `ai_generate(job_id)` → create file/version → AV-скан
* [ ] Ограничения: rpm/per-user, tokens/day per org (под твой существующий AI модуль)
* [ ] Опционально: retention для удаленных/старых версий + cleanup task
* [ ] Финальные метрики и алерты (ошибки генерации, scan failures)

### Frontend ✅

* [ ] UI “Создать документ через AI” (тип + шаблон)
* [ ] Прогресс/статус job
* [ ] После READY: открыть/скачать/редактировать по типу

### Тестирование + отладка 🧪

* [ ] E2E сценарий (минимум ручной, лучше Playwright):

  * [ ] AI → DOCX → открыть в OnlyOffice → сохранить → скачать
* [ ] Нагрузочный смоук: 20 upload init/finish подряд без падений
* [ ] Проверка квот на всех путях (upload/edit/ai)

---

# Важные риски (чтобы не словить боль) ⚠️

* **Без reserved_bytes** квоты пробиваются параллельными загрузками (гонки).
* **Без статуса SCANNING** ты отдашь вирусный файл пользователю.
* **Перезапись одного S3 key** убивает аудит/откат и делает баги “невоспроизводимыми”.
* **OnlyOffice callback без строгой валидации** = дырка.

