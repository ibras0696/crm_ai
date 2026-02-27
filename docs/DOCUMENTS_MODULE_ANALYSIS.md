# 📄 Анализ Модуля Документов CRM Platform

**Дата:** 27 февраля 2026  
**Версия:** 1.0

---

## 📋 Оглавление

1. [Текущая Архитектура](#текущая-архитектура)
2. [Как Это Работает](#как-это-работает)
3. [Плюсы и Минусы](#плюсы-и-минусы)
4. [Кастомный Редактор PDF/Word](#кастомный-редактор-pdfword)
5. [Рекомендации](#рекомендации)

---

## 🏗️ Текущая Архитектура

### Backend (FastAPI)

#### Модели Данных

**1. Folder** - Папки документов
```python
class Folder(BaseDBModel):
    org_id: UUID              # Организация
    created_by: UUID | None   # Создатель
    parent_id: UUID | None    # Родительская папка
    name: str                 # Название
    position: int             # Позиция для сортировки
```
- Глубина вложенности: **max 2 уровня**
- Cascade delete при удалении организации

**2. FileVersion** - Версии файлов
```python
class FileVersion(BaseDBModel):
    file_id: UUID             # Ссылка на файл
    s3_key: str               # Ключ в S3 (unique)
    s3_bucket: str            # Bucket S3
    size_bytes: int           # Размер
    sha256: str | None        # Хеш для проверки
    mime: str                 # MIME-тип
    meta_json: dict | None    # Метаданные (подписи, AI job)
    created_by: UUID | None   # Автор версии
```
- **Immutable** - версии не изменяются
- Каждое сохранение = новая версия

**3. OrgStorageUsage** - Квоты хранилища
```python
class OrgStorageUsage(BaseDBModel):
    org_id: UUID              # Организация (unique)
    used_bytes: int           # Занято (>= 0)
    reserved_bytes: int       # Зарезервировано (>= 0)
```
- Атомарные обновления с `FOR UPDATE`
- Резервирование места перед загрузкой

**4. DocsAIGenerationJob** - AI генерация
```python
class DocsAIGenerationJob(BaseDBModel):
    org_id: UUID
    user_id: UUID | None
    file_id: UUID | None
    file_type: str            # txt/pdf/docx
    status: str               # queued/running/scanning/ready/blocked/failed
    prompt: str               # AI промпт
    template: str | None      # Шаблон
    title: str | None
    language: str | None
    provider_model: str | None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    error_message: str | None
    task_id: str | None       # Celery task ID
    meta_json: dict | None
    started_at: datetime | None
    finished_at: datetime | None
```

#### Архитектура Backend

```
┌─────────────────────────────────────────────────────┐
│                   FastAPI Routes                     │
│  /docs/tree, /docs/folders, /docs/files/*           │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                  DocsService                         │
│  - create_folder, update_folder, delete_folder      │
│  - init_upload, finish_upload, abort_upload         │
│  - create_empty_file, move_file                     │
│  - get_text_content, save_text                      │
│  - request_pdf_sign, open_docx                      │
│  - request_ai_generate                              │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│               DocsRepository                         │
│  - SQL операции (CRUD)                              │
│  - Без commit (через UnitOfWork)                    │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
┌───────▼────────┐   ┌────────▼────────┐
│   PostgreSQL   │   │   MinIO (S3)    │
│   + pgvector   │   │   File Storage  │
└────────────────┘   └─────────────────┘
```

#### Pipeline Обработки Файлов

**1. Upload Flow:**
```
1. init_upload
   ├─ Проверка квоты
   ├─ Резервирование места (reserved_bytes)
   ├─ Создание File (status=UPLOADING)
   └─ Генерация presigned PUT URL

2. Client uploads to S3
   └─ Прямая загрузка в MinIO

3. finish_upload
   ├─ Создание FileVersion
   ├─ File.status = SCANNING
   ├─ Запуск Celery task: scan_version
   └─ Commit

4. scan_version (Celery)
   ├─ Скачивание из S3
   ├─ Magic bytes validation
   ├─ Antivirus scan (ClamAV)
   ├─ File.status = READY/BLOCKED
   ├─ Обновление used_bytes
   └─ Audit log
```

**2. TXT Editor Flow:**
```
1. get_text_content
   └─ Скачать текущую версию из S3

2. save_text
   ├─ Rate limiting (20 RPM)
   ├─ Создание новой версии в S3
   ├─ FileVersion (meta: replaced_ready_size)
   ├─ File.current_version_id = new
   ├─ Обновление used_bytes
   └─ Audit log
```

**3. PDF Signature Flow:**
```
1. request_pdf_sign
   ├─ File.status = SCANNING
   └─ Запуск Celery: pdf_stamp_sign

2. pdf_stamp_sign (Celery)
   ├─ Скачать source PDF из S3
   ├─ Декодировать PNG подписи (base64)
   ├─ PyPDF2: stamp_pdf_with_signature
   │  ├─ Создать страницу с подписью
   │  ├─ Merge с исходным PDF
   │  └─ Добавить metadata
   ├─ Antivirus scan
   ├─ Загрузить в S3 как новую версию
   ├─ File.status = READY/BLOCKED
   └─ Audit log
```

**4. DOCX Editor Flow (OnlyOffice):**
```
1. open_docx
   ├─ Проверка DOCS_ONLYOFFICE_ENABLED
   ├─ Генерация presigned GET URL (для OnlyOffice)
   ├─ Создание state token (JWT)
   │  └─ org_id, file_id, source_version_id, user_id
   ├─ Формирование OnlyOffice config
   │  ├─ documentType: "word"
   │  ├─ document.url: presigned URL
   │  ├─ editorConfig.callbackUrl + state token
   │  └─ JWT signature (если настроен)
   └─ Возврат config клиенту

2. Client opens OnlyOffice editor
   └─ Iframe с DocumentEditor

3. OnlyOffice callback (при сохранении)
   ├─ Проверка JWT signature
   ├─ Декодирование state token
   ├─ status=2 (сохранено)
   │  ├─ Скачать файл по url из callback
   │  ├─ Создать FileVersion
   │  ├─ File.status = SCANNING
   │  ├─ Запуск scan_version
   │  └─ Обновление used_bytes
   └─ Возврат {"error": 0}
```

**5. AI Generation Flow:**
```
1. request_ai_generate
   ├─ Проверка AI лимитов
   ├─ Резервирование места
   ├─ Создание File (status=UPLOADING)
   ├─ Создание DocsAIGenerationJob (status=queued)
   └─ Запуск Celery: ai_generate

2. ai_generate (Celery)
   ├─ Job.status = running
   ├─ AI provider call (OpenAI-compatible)
   │  └─ Генерация текста по prompt
   ├─ Рендеринг документа
   │  ├─ TXT: plain text
   │  ├─ DOCX: python-docx
   │  └─ PDF: ReportLab
   ├─ Загрузка в S3
   ├─ Создание FileVersion
   ├─ File.status = SCANNING
   ├─ Job.status = scanning
   ├─ Запуск scan_version
   └─ Списание AI токенов
```

### Frontend (React + TypeScript)

#### Компоненты

**1. DocsPage.tsx** - Главная страница
- **State Management:**
  - `folders`, `files` - дерево документов
  - `usage` - квоты хранилища
  - `selectedFolderId` - текущая папка
  - `editorFile`, `editorContent` - TXT редактор
  - `pdfSignerFile` - PDF подпись
  - `docxEditorFile`, `docxConfig` - DOCX редактор
  - `aiJobs` - AI генерация

- **Функционал:**
  - Drag & Drop файлов между папками
  - Polling статусов (SCANNING → READY/BLOCKED)
  - Unsaved changes warning
  - Rate limiting визуализация

**2. DocxEditorPanel.tsx** - OnlyOffice редактор
```tsx
<DocumentEditor
  id={`onlyoffice-${file.id}`}
  documentServerUrl={documentServerUrl}
  config={config}
  height="720px"
  width="100%"
/>
```
- Polling статуса файла (4s interval)
- Автообновление после callback

**3. PdfSignerPanel.tsx** - PDF подпись
- Canvas для рисования подписи
- Base64 encoding PNG
- Координаты и размеры подписи

#### API Client

```typescript
docsApi = {
  getTree: () => GET /docs/tree
  createFolder: (payload) => POST /docs/folders
  updateFolder: (id, payload) => PATCH /docs/folders/{id}
  deleteFolder: (id) => DELETE /docs/folders/{id}
  
  initUpload: (payload) => POST /docs/files/init-upload
  finishUpload: (payload) => POST /docs/files/finish-upload
  abortUpload: (id) => POST /docs/files/{id}/abort-upload
  createEmptyFile: (payload) => POST /docs/files/create-empty
  moveFile: (id, payload) => PATCH /docs/files/{id}
  
  getFile: (id) => GET /docs/files/{id}
  getFileText: (id) => GET /docs/files/{id}/text
  saveFileText: (id, payload) => POST /docs/files/{id}/save-text
  listFileVersions: (id) => GET /docs/files/{id}/versions
  
  signPdf: (id, payload) => POST /docs/files/{id}/pdf/sign
  openDocx: (id) => POST /docs/files/{id}/open-docx
  
  aiGenerate: (payload) => POST /docs/files/ai/generate
  getAIGenerationJob: (id) => GET /docs/files/ai/jobs/{id}
  
  getDownload: (id) => GET /docs/files/{id}/download
  getUsage: () => GET /docs/usage
}
```

---

## ⚙️ Как Это Работает

### 1. Загрузка Файла

```
User                 Frontend              Backend              MinIO        Celery
  │                     │                     │                   │            │
  │ Select file         │                     │                   │            │
  ├────────────────────>│                     │                   │            │
  │                     │ POST init-upload    │                   │            │
  │                     ├────────────────────>│                   │            │
  │                     │                     │ Reserve quota     │            │
  │                     │                     │ Create File       │            │
  │                     │                     │ Generate PUT URL  │            │
  │                     │<────────────────────┤                   │            │
  │                     │ {upload_url}        │                   │            │
  │                     │                     │                   │            │
  │                     │ PUT file            │                   │            │
  │                     ├─────────────────────┼──────────────────>│            │
  │                     │<────────────────────┼───────────────────┤            │
  │                     │                     │                   │            │
  │                     │ POST finish-upload  │                   │            │
  │                     ├────────────────────>│                   │            │
  │                     │                     │ Create version    │            │
  │                     │                     │ status=SCANNING   │            │
  │                     │                     ├───────────────────┼───────────>│
  │                     │                     │                   │ scan_version
  │                     │<────────────────────┤                   │            │
  │                     │ {file: SCANNING}    │                   │            │
  │                     │                     │                   │            │
  │ Poll status         │                     │                   │   Download │
  │<────────────────────┤                     │                   │<───────────┤
  │ SCANNING...         │                     │                   │   Validate │
  │                     │                     │                   │   AV scan  │
  │                     │                     │                   │   Update   │
  │                     │                     │                   ├───────────>│
  │                     │                     │<──────────────────┼────────────┤
  │                     │                     │ status=READY      │            │
  │ Poll status         │                     │                   │            │
  │ GET /files/{id}     │                     │                   │            │
  │────────────────────>├────────────────────>│                   │            │
  │<────────────────────┤<────────────────────┤                   │            │
  │ {file: READY}       │                     │                   │            │
```

### 2. TXT Редактор

```
User                 Frontend              Backend              MinIO
  │                     │                     │                   │
  │ Click "Edit TXT"    │                     │                   │
  ├────────────────────>│                     │                   │
  │                     │ GET /files/{id}/text│                   │
  │                     ├────────────────────>│                   │
  │                     │                     │ Get version       │
  │                     │                     ├──────────────────>│
  │                     │                     │<──────────────────┤
  │                     │<────────────────────┤                   │
  │                     │ {content: "..."}    │                   │
  │                     │                     │                   │
  │ Monaco Editor       │                     │                   │
  │<────────────────────┤                     │                   │
  │ Edit text...        │                     │                   │
  │                     │                     │                   │
  │ Click "Save"        │                     │                   │
  ├────────────────────>│                     │                   │
  │                     │ POST save-text      │                   │
  │                     ├────────────────────>│                   │
  │                     │                     │ Rate limit check  │
  │                     │                     │ Create new version│
  │                     │                     ├──────────────────>│
  │                     │                     │ Update file       │
  │                     │<────────────────────┤                   │
  │<────────────────────┤                     │                   │
  │ Saved!              │                     │                   │
```

### 3. DOCX Редактор (OnlyOffice)

```
User          Frontend         Backend         OnlyOffice       MinIO
  │              │                │                │              │
  │ Click "Edit" │                │                │              │
  ├─────────────>│                │                │              │
  │              │ POST open-docx │                │              │
  │              ├───────────────>│                │              │
  │              │                │ Generate URLs  │              │
  │              │                ├───────────────>│              │
  │              │                │ Create config  │              │
  │              │<───────────────┤                │              │
  │              │ {config, url}  │                │              │
  │              │                │                │              │
  │ OnlyOffice   │                │                │              │
  │ iframe       │                │                │              │
  │<─────────────┤                │                │              │
  │              │                │                │              │
  │              │                │<───────────────┤ GET file     │
  │              │                │                ├─────────────>│
  │              │                │                │<─────────────┤
  │              │                │                │              │
  │ Edit DOCX... │                │                │              │
  │              │                │                │              │
  │ Save (Ctrl+S)│                │                │              │
  │──────────────┼────────────────┼───────────────>│              │
  │              │                │                │ Save file    │
  │              │                │<───────────────┤              │
  │              │                │ POST callback  │              │
  │              │                │ {status: 2,    │              │
  │              │                │  url: "..."}   │              │
  │              │                │                │              │
  │              │                │ Download file  │              │
  │              │                ├───────────────>│              │
  │              │                │<───────────────┤              │
  │              │                │ Create version │              │
  │              │                │ status=SCANNING│              │
  │              │                │ Trigger scan   │              │
  │              │                │                │              │
  │ Poll status  │                │                │              │
  │<─────────────┤                │                │              │
  │ SCANNING...  │                │                │              │
  │ READY!       │                │                │              │
```

### 4. PDF Подпись

```
User          Frontend         Backend         Celery          MinIO
  │              │                │                │              │
  │ Draw sign    │                │                │              │
  ├─────────────>│                │                │              │
  │ Canvas       │                │                │              │
  │              │                │                │              │
  │ Click "Sign" │                │                │              │
  ├─────────────>│                │                │              │
  │              │ POST pdf/sign  │                │              │
  │              │ {page, x, y,   │                │              │
  │              │  width, height,│                │              │
  │              │  image: base64}│                │              │
  │              ├───────────────>│                │              │
  │              │                │ status=SCANNING│              │
  │              │                ├───────────────>│              │
  │              │                │ pdf_stamp_sign │              │
  │              │<───────────────┤                │              │
  │              │ {file: SCANNING│                │              │
  │              │                │                │ Download PDF │
  │              │                │                ├─────────────>│
  │              │                │                │<─────────────┤
  │              │                │                │ Decode PNG   │
  │              │                │                │ PyPDF2 stamp │
  │              │                │                │ AV scan      │
  │              │                │                │ Upload new   │
  │              │                │                ├─────────────>│
  │              │                │                │ Update file  │
  │              │                │<───────────────┤ status=READY │
  │ Poll status  │                │                │              │
  │<─────────────┤                │                │              │
  │ READY!       │                │                │              │
```

### 5. AI Генерация

```
User          Frontend         Backend         Celery          AI API       MinIO
  │              │                │                │              │            │
  │ Enter prompt │                │                │              │            │
  ├─────────────>│                │                │              │            │
  │ "Create..."  │                │                │              │            │
  │              │                │                │              │            │
  │ Click "Gen"  │                │                │              │            │
  ├─────────────>│                │                │              │            │
  │              │ POST ai/generate│               │              │            │
  │              ├───────────────>│                │              │            │
  │              │                │ Check limits   │              │            │
  │              │                │ Reserve quota  │              │            │
  │              │                │ Create File    │              │            │
  │              │                │ Create AI Job  │              │            │
  │              │                ├───────────────>│              │            │
  │              │                │ ai_generate    │              │            │
  │              │<───────────────┤                │              │            │
  │              │ {job_id, file} │                │              │            │
  │              │                │                │              │            │
  │ Poll job     │                │                │ Call AI      │            │
  │<─────────────┤                │                ├─────────────>│            │
  │ RUNNING...   │                │                │<─────────────┤            │
  │              │                │                │ {text: "..."} │           │
  │              │                │                │              │            │
  │              │                │                │ Render doc   │            │
  │              │                │                │ (DOCX/PDF)   │            │
  │              │                │                │              │            │
  │              │                │                │ Upload       │            │
  │              │                │                ├─────────────┼───────────>│
  │              │                │                │ Create ver   │            │
  │              │                │                │ Trigger scan │            │
  │              │                │<───────────────┤              │            │
  │ Poll job     │                │                │              │            │
  │ SCANNING...  │                │                │              │            │
  │ READY!       │                │                │              │            │
```

---

## ✅ Плюсы Текущей Реализации

### Backend

1. **✅ Версионирование**
   - Immutable versions
   - Полная история изменений
   - Возможность rollback

2. **✅ Безопасность**
   - Antivirus scanning (ClamAV)
   - Magic bytes validation
   - JWT signatures для OnlyOffice
   - Rate limiting для TXT сохранений

3. **✅ Квоты и Лимиты**
   - Резервирование места перед загрузкой
   - Атомарные обновления usage
   - Проверка лимитов по тарифу

4. **✅ Асинхронная Обработка**
   - Celery для тяжелых операций
   - Не блокирует API
   - Retry logic

5. **✅ Audit Trail**
   - Логирование всех операций
   - Метаданные в версиях
   - Tracking изменений

6. **✅ AI Integration**
   - Генерация документов
   - Token tracking
   - Лимиты по организации/пользователю

### Frontend

1. **✅ UX**
   - Drag & Drop
   - Real-time polling
   - Unsaved changes warning
   - Progress indicators

2. **✅ Редакторы**
   - Monaco для TXT (syntax highlighting)
   - OnlyOffice для DOCX (полнофункциональный)
   - Canvas для PDF подписи

3. **✅ Организация**
   - Папки с вложенностью
   - Сортировка
   - Фильтрация по папкам

---

## ❌ Минусы Текущей Реализации

### Backend

1. **❌ OnlyOffice Зависимость**
   - Требует отдельный сервер
   - Сложная настройка
   - Лицензирование (Community vs Enterprise)
   - Callback URL должен быть доступен для OnlyOffice

2. **❌ Ограниченная Функциональность PDF**
   - Только подпись (stamp)
   - Нет редактирования текста
   - Нет аннотаций/комментариев
   - Нет форм

3. **❌ TXT Редактор Простой**
   - Только plain text
   - Нет Markdown preview
   - Нет collaborative editing

4. **❌ Нет Real-time Collaboration**
   - Только polling
   - Нет WebSockets
   - Конфликты при одновременном редактировании

5. **❌ Производительность**
   - Скачивание всего файла для scan
   - Нет streaming для больших файлов
   - Нет CDN для статики

6. **❌ Масштабируемость**
   - OnlyOffice - single point of failure
   - Celery workers могут быть bottleneck
   - MinIO не кластеризован

### Frontend

1. **❌ OnlyOffice Iframe**
   - Ограниченная кастомизация UI
   - Зависимость от внешнего сервера
   - Сложная отладка

2. **❌ Polling Overhead**
   - Много запросов
   - Задержка обновлений
   - Нагрузка на сервер

3. **❌ Нет Offline Support**
   - Требует постоянное соединение
   - Нет Service Worker

4. **❌ Мобильная Версия**
   - OnlyOffice плохо работает на мобильных
   - Canvas подпись неудобна на touch

---

## 🎨 Кастомный Редактор PDF/Word

### Можем Ли Мы Сделать?

**Ответ: ДА, но с разной сложностью**

### Вариант 1: Кастомный PDF Редактор ⭐⭐⭐⭐

**Технологии:**
- **PDF.js** (Mozilla) - рендеринг PDF
- **PDF-lib** - создание/редактирование PDF
- **Fabric.js** - canvas для аннотаций
- **React PDF Viewer** - готовый компонент

**Функционал:**
```typescript
// Что можем реализовать:
✅ Просмотр PDF
✅ Аннотации (текст, фигуры, стрелки)
✅ Подписи (рисование, изображения)
✅ Комментарии
✅ Highlight текста
✅ Формы (заполнение)
✅ Штампы
✅ Редактирование метаданных
✅ Объединение PDF
✅ Разделение страниц
✅ Поворот страниц
✅ Watermarks

❌ Редактирование текста (очень сложно)
❌ OCR (требует отдельный сервис)
```

**Архитектура:**

```typescript
// Frontend
import { Viewer, Worker } from '@react-pdf-viewer/core'
import { PDFDocument } from 'pdf-lib'
import { fabric } from 'fabric'

interface CustomPDFEditor {
  // Просмотр
  viewer: PDFViewer
  currentPage: number
  zoom: number
  
  // Аннотации
  annotations: Annotation[]
  addText(text: string, x: number, y: number): void
  addShape(type: 'rect' | 'circle', coords: Coords): void
  addSignature(image: string, coords: Coords): void
  
  // Редактирование
  rotatePage(page: number, degrees: number): void
  deletePage(page: number): void
  mergePDF(otherPdf: ArrayBuffer): void
  
  // Сохранение
  save(): Promise<ArrayBuffer>
}
```

**Backend:**
```python
# PDF обработка
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from PIL import Image

class PDFProcessor:
    def add_annotations(self, pdf: bytes, annotations: list) -> bytes:
        """Добавить аннотации к PDF"""
        
    def add_signature(self, pdf: bytes, signature: bytes, coords: dict) -> bytes:
        """Добавить подпись"""
        
    def merge_pdfs(self, pdfs: list[bytes]) -> bytes:
        """Объединить PDF"""
        
    def split_pdf(self, pdf: bytes, pages: list[int]) -> list[bytes]:
        """Разделить PDF"""
        
    def add_watermark(self, pdf: bytes, text: str) -> bytes:
        """Добавить watermark"""
```

**Пример Реализации:**

```tsx
// components/PDFEditor.tsx
import { useState } from 'react'
import { Viewer, Worker } from '@react-pdf-viewer/core'
import { toolbarPlugin } from '@react-pdf-viewer/toolbar'
import { PDFDocument } from 'pdf-lib'

export function PDFEditor({ fileUrl, onSave }) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  
  const toolbarPluginInstance = toolbarPlugin()
  
  const loadPDF = async () => {
    const response = await fetch(fileUrl)
    const arrayBuffer = await response.arrayBuffer()
    const doc = await PDFDocument.load(arrayBuffer)
    setPdfDoc(doc)
  }
  
  const addTextAnnotation = async (text: string, page: number, x: number, y: number) => {
    if (!pdfDoc) return
    
    const pages = pdfDoc.getPages()
    const targetPage = pages[page]
    
    targetPage.drawText(text, {
      x,
      y,
      size: 12,
      color: rgb(0, 0, 0),
    })
    
    setAnnotations([...annotations, { type: 'text', text, page, x, y }])
  }
  
  const addSignature = async (imageBase64: string, page: number, coords: Coords) => {
    if (!pdfDoc) return
    
    const pngImage = await pdfDoc.embedPng(imageBase64)
    const pages = pdfDoc.getPages()
    const targetPage = pages[page]
    
    targetPage.drawImage(pngImage, {
      x: coords.x,
      y: coords.y,
      width: coords.width,
      height: coords.height,
    })
  }
  
  const savePDF = async () => {
    if (!pdfDoc) return
    
    const pdfBytes = await pdfDoc.save()
    await onSave(pdfBytes)
  }
  
  return (
    <div className="pdf-editor">
      <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
        <div className="toolbar">
          <button onClick={() => addTextAnnotation('Sample', 0, 100, 100)}>
            Add Text
          </button>
          <button onClick={savePDF}>Save</button>
        </div>
        
        <Viewer
          fileUrl={fileUrl}
          plugins={[toolbarPluginInstance]}
        />
      </Worker>
      
      {/* Canvas overlay для рисования */}
      <AnnotationCanvas
        annotations={annotations}
        onAdd={(annotation) => setAnnotations([...annotations, annotation])}
      />
    </div>
  )
}
```

**Сложность:** ⭐⭐⭐ (Средняя)  
**Время:** 2-3 недели  
**Стоимость:** Бесплатно (open-source библиотеки)

---

### Вариант 2: Кастомный Word Редактор ⭐⭐⭐⭐⭐

**Проблема:** Word (.docx) - это сложный XML формат (OOXML)

**Технологии:**

**A. Простой Редактор (Rich Text):**
```typescript
// Используем готовые редакторы
import { Editor } from '@tinymce/tinymce-react'
import { CKEditor } from '@ckeditor/ckeditor5-react'
import Quill from 'quill'

// Экспорт в DOCX
import { Document, Packer, Paragraph, TextRun } from 'docx'
```

**Функционал:**
```
✅ Форматирование текста (bold, italic, underline)
✅ Списки (ordered, unordered)
✅ Заголовки (H1-H6)
✅ Изображения
✅ Таблицы (простые)
✅ Ссылки
✅ Цвета текста/фона

❌ Сложные таблицы
❌ Колонки
❌ Колонтитулы
❌ Оглавление
❌ Стили документа
❌ Track Changes
❌ Комментарии
❌ Формулы
```

**B. Полноценный Редактор (как OnlyOffice):**

**Сложность:** ⭐⭐⭐⭐⭐⭐ (Очень высокая)

**Почему сложно:**
1. OOXML спецификация - 5000+ страниц
2. Совместимость с MS Word
3. Рендеринг сложных элементов
4. Performance для больших документов
5. Collaborative editing
6. Track changes
7. Комментарии и ревизии

**Альтернативы OnlyOffice:**

| Решение | Тип | Плюсы | Минусы | Стоимость |
|---------|-----|-------|--------|-----------|
| **OnlyOffice** | Self-hosted | Полный функционал | Сложная настройка | Free (Community) |
| **Collabora Online** | Self-hosted | LibreOffice-based | Требует ресурсов | €€€ |
| **Google Docs API** | Cloud | Отличный UX | Vendor lock-in | $ |
| **Microsoft Office Online** | Cloud | Нативная совместимость | Дорого | $$$ |
| **CKEditor 5** | Library | Легкий, гибкий | Ограниченный DOCX | Free/€€ |
| **TinyMCE** | Library | Популярный | Ограниченный DOCX | Free/€€ |
| **Quill** | Library | Простой API | Базовый функционал | Free |

**Рекомендация для Word:**

```typescript
// Гибридный подход
interface WordEditorStrategy {
  // Для простых документов
  simpleEditor: CKEditor | TinyMCE
  exportFormat: 'docx' // через docx.js
  
  // Для сложных документов
  advancedEditor: OnlyOffice | Collabora
  
  // Автоматический выбор
  selectEditor(doc: Document): Editor {
    if (doc.hasComplexFeatures()) {
      return this.advancedEditor
    }
    return this.simpleEditor
  }
}
```

**Пример Simple Word Editor:**

```tsx
// components/SimpleWordEditor.tsx
import { CKEditor } from '@ckeditor/ckeditor5-react'
import ClassicEditor from '@ckeditor/ckeditor5-build-classic'
import { Document, Packer, Paragraph, TextRun } from 'docx'

export function SimpleWordEditor({ initialContent, onSave }) {
  const [content, setContent] = useState(initialContent)
  
  const exportToDocx = async () => {
    // Конвертация HTML в DOCX
    const doc = new Document({
      sections: [{
        properties: {},
        children: parseHTMLToDocx(content),
      }],
    })
    
    const blob = await Packer.toBlob(doc)
    await onSave(blob)
  }
  
  const parseHTMLToDocx = (html: string): Paragraph[] => {
    // Парсинг HTML в DOCX структуру
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    
    const paragraphs: Paragraph[] = []
    
    doc.body.childNodes.forEach(node => {
      if (node.nodeName === 'P') {
        paragraphs.push(new Paragraph({
          children: [new TextRun(node.textContent || '')],
        }))
      }
      // ... обработка других элементов
    })
    
    return paragraphs
  }
  
  return (
    <div className="word-editor">
      <div className="toolbar">
        <button onClick={exportToDocx}>Save as DOCX</button>
      </div>
      
      <CKEditor
        editor={ClassicEditor}
        data={content}
        onChange={(event, editor) => {
          setContent(editor.getData())
        }}
        config={{
          toolbar: [
            'heading', '|',
            'bold', 'italic', 'underline', '|',
            'bulletedList', 'numberedList', '|',
            'insertTable', 'imageUpload', '|',
            'undo', 'redo'
          ],
        }}
      />
    </div>
  )
}
```

**Сложность Simple:** ⭐⭐⭐ (Средняя)  
**Время:** 1-2 недели  
**Стоимость:** Free (CKEditor) или €€ (Premium features)

---

## 🏆 Рекомендации

### Краткосрочные (1-2 месяца)

#### 1. Улучшить PDF Редактор ⭐⭐⭐⭐

**Заменить простую подпись на полноценный редактор:**

```typescript
// Новый PDFEditor
import { PDFViewer } from '@/components/pdf/PDFViewer'
import { AnnotationToolbar } from '@/components/pdf/AnnotationToolbar'

<PDFEditor
  fileUrl={pdfUrl}
  features={[
    'signature',      // Подпись (текущая)
    'text',           // Текстовые аннотации
    'highlight',      // Выделение
    'shapes',         // Фигуры
    'comments',       // Комментарии
    'stamps',         // Штампы
  ]}
  onSave={handleSave}
/>
```

**Библиотеки:**
- `@react-pdf-viewer/core` - просмотр
- `pdf-lib` - редактирование
- `fabric.js` - canvas аннотации

**Преимущества:**
- ✅ Полный контроль над UI
- ✅ Нет зависимости от внешних серверов
- ✅ Работает offline
- ✅ Легко кастомизировать

**Недостатки:**
- ❌ Нельзя редактировать текст PDF
- ❌ Нет OCR

#### 2. Добавить Simple Word Editor для Базовых Документов ⭐⭐⭐

**Использовать CKEditor 5:**

```typescript
<CKEditor
  editor={ClassicEditor}
  config={{
    toolbar: {
      items: [
        'heading', 'bold', 'italic', 'underline',
        'bulletedList', 'numberedList',
        'insertTable', 'imageUpload',
        'link', 'blockQuote',
      ]
    },
    image: {
      upload: {
        types: ['jpeg', 'png', 'gif', 'bmp', 'webp'],
      }
    },
  }}
/>
```

**Экспорт в DOCX:**
```typescript
import { Document, Packer } from 'docx'

const exportToDocx = async (htmlContent: string) => {
  const doc = new Document({
    sections: [{
      children: convertHTMLToDocx(htmlContent),
    }],
  })
  
  return await Packer.toBlob(doc)
}
```

**Когда использовать:**
- Простые документы (письма, заметки)
- Без сложного форматирования
- Быстрое создание

#### 3. Оставить OnlyOffice для Сложных Документов ⭐⭐⭐⭐⭐

**Автоматический выбор редактора:**

```typescript
const selectEditor = (file: DocsFile) => {
  // Анализ документа
  const analysis = analyzeDocument(file)
  
  if (analysis.hasComplexFeatures) {
    // Таблицы, колонки, формулы, track changes
    return 'onlyoffice'
  }
  
  if (analysis.isSimple) {
    // Простой текст с базовым форматированием
    return 'ckeditor'
  }
  
  return 'onlyoffice' // По умолчанию
}
```

### Среднесрочные (3-6 месяцев)

#### 4. Real-time Collaboration ⭐⭐⭐⭐⭐

**WebSockets + CRDT:**

```typescript
// Backend
from fastapi import WebSocket
from ypy import YDoc
from ypy_websocket import WebsocketServer

@router.websocket("/docs/files/{file_id}/collaborate")
async def collaborate(websocket: WebSocket, file_id: str):
    # Y.js CRDT для collaborative editing
    ydoc = YDoc()
    # Sync changes между клиентами
```

**Frontend:**
```typescript
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const ydoc = new Y.Doc()
const provider = new WebsocketProvider(
  'ws://localhost:8000/docs/files/123/collaborate',
  'room-123',
  ydoc
)

// Интеграция с редактором
const ytext = ydoc.getText('content')
editor.on('change', () => {
  ytext.insert(0, editor.getContent())
})
```

**Библиотеки:**
- `Y.js` - CRDT
- `y-websocket` - WebSocket provider
- `y-monaco` - Monaco integration
- `y-prosemirror` - ProseMirror integration

#### 5. Версионирование с Diff ⭐⭐⭐⭐

**Visual Diff для документов:**

```typescript
import { diffWords, diffLines } from 'diff'

const showVersionDiff = (v1: string, v2: string) => {
  const diff = diffWords(v1, v2)
  
  return diff.map((part, index) => (
    <span
      key={index}
      className={
        part.added ? 'bg-green-200' :
        part.removed ? 'bg-red-200' :
        ''
      }
    >
      {part.value}
    </span>
  ))
}
```

#### 6. OCR для Сканированных PDF ⭐⭐⭐⭐

**Tesseract.js:**

```typescript
import Tesseract from 'tesseract.js'

const extractTextFromPDF = async (pdfFile: File) => {
  const { data: { text } } = await Tesseract.recognize(
    pdfFile,
    'rus+eng',
    {
      logger: m => console.log(m)
    }
  )
  
  return text
}
```

### Долгосрочные (6-12 месяцев)

#### 7. AI-Powered Features ⭐⭐⭐⭐⭐

**Умные функции:**

```typescript
// Автоматическое резюме
const summarizeDocument = async (content: string) => {
  const response = await aiApi.summarize({
    text: content,
    maxLength: 200,
  })
  return response.summary
}

// Перевод
const translateDocument = async (content: string, targetLang: string) => {
  return await aiApi.translate({
    text: content,
    from: 'auto',
    to: targetLang,
  })
}

// Проверка грамматики
const checkGrammar = async (content: string) => {
  return await aiApi.checkGrammar(content)
}

// Генерация на основе шаблона
const generateFromTemplate = async (template: string, data: object) => {
  return await aiApi.generate({
    template,
    data,
    format: 'docx',
  })
}
```

#### 8. Mobile App ⭐⭐⭐⭐⭐

**React Native:**

```typescript
// Мобильный редактор
import { DocumentPicker } from 'react-native-document-picker'
import { PDFView } from 'react-native-pdf'

const MobileDocEditor = () => {
  const pickDocument = async () => {
    const result = await DocumentPicker.pick({
      type: [DocumentPicker.types.pdf, DocumentPicker.types.doc],
    })
    
    // Upload to backend
    await uploadDocument(result)
  }
  
  return (
    <View>
      <Button onPress={pickDocument}>Upload Document</Button>
      <PDFView source={{ uri: pdfUrl }} />
    </View>
  )
}
```

---

## 📊 Сравнение Подходов

### PDF Редактор

| Подход | Сложность | Время | Функционал | Стоимость |
|--------|-----------|-------|------------|-----------|
| **Текущий (PyPDF2)** | ⭐ | 1 день | Только подпись | Free |
| **PDF.js + pdf-lib** | ⭐⭐⭐ | 2-3 недели | Аннотации, подписи, штампы | Free |
| **PSPDFKit** | ⭐⭐ | 1 неделя | Полный функционал | $$$$ |
| **Adobe PDF Embed API** | ⭐ | 3 дня | Просмотр + базовые аннотации | Free/$ |

**Рекомендация:** PDF.js + pdf-lib ⭐⭐⭐⭐⭐

### Word Редактор

| Подход | Сложность | Время | Функционал | Стоимость |
|--------|-----------|-------|------------|-----------|
| **Текущий (OnlyOffice)** | ⭐⭐⭐ | Настроен | Полный | Free |
| **CKEditor 5** | ⭐⭐ | 1-2 недели | Базовый | Free/€€ |
| **TinyMCE** | ⭐⭐ | 1-2 недели | Базовый | Free/€€ |
| **Quill** | ⭐ | 1 неделя | Минимальный | Free |
| **Collabora Online** | ⭐⭐⭐⭐ | 2-3 недели | Полный | €€€ |
| **Google Docs API** | ⭐⭐ | 1 неделя | Полный | $ |
| **Кастомный OOXML** | ⭐⭐⭐⭐⭐⭐ | 6+ месяцев | Полный | $$$$$ |

**Рекомендация:** Гибридный подход (CKEditor + OnlyOffice) ⭐⭐⭐⭐

---

## 🎯 План Внедрения

### Фаза 1: PDF Редактор (2-3 недели)

**Week 1:**
- [ ] Установить `@react-pdf-viewer/core`, `pdf-lib`, `fabric.js`
- [ ] Создать `PDFViewer` компонент
- [ ] Реализовать просмотр PDF

**Week 2:**
- [ ] Добавить `AnnotationToolbar`
- [ ] Реализовать текстовые аннотации
- [ ] Реализовать фигуры (rect, circle, arrow)
- [ ] Реализовать highlight

**Week 3:**
- [ ] Улучшить подпись (не только рисование, но и загрузка изображения)
- [ ] Добавить штампы
- [ ] Добавить комментарии
- [ ] Тестирование

**Backend:**
```python
# Обновить pdf_stamper.py
class PDFAnnotator:
    def add_text_annotation(self, pdf: bytes, text: str, coords: dict) -> bytes:
        """Добавить текстовую аннотацию"""
        
    def add_shape(self, pdf: bytes, shape_type: str, coords: dict) -> bytes:
        """Добавить фигуру"""
        
    def add_highlight(self, pdf: bytes, coords: dict, color: str) -> bytes:
        """Добавить выделение"""
```

### Фаза 2: Simple Word Editor (1-2 недели)

**Week 1:**
- [ ] Установить CKEditor 5
- [ ] Создать `SimpleWordEditor` компонент
- [ ] Настроить toolbar
- [ ] Реализовать базовое форматирование

**Week 2:**
- [ ] Добавить экспорт в DOCX (docx.js)
- [ ] Реализовать импорт из DOCX
- [ ] Добавить автосохранение
- [ ] Тестирование

**Backend:**
```python
# Добавить в service.py
async def convert_docx_to_html(self, file_id: UUID) -> str:
    """Конвертировать DOCX в HTML для simple editor"""
    
async def convert_html_to_docx(self, html: str) -> bytes:
    """Конвертировать HTML в DOCX"""
```

### Фаза 3: Автовыбор Редактора (1 неделя)

```typescript
// utils/editorSelector.ts
export const selectEditor = (file: DocsFile): EditorType => {
  if (file.type === 'pdf') {
    return 'custom-pdf'
  }
  
  if (file.type === 'docx') {
    // Анализ сложности документа
    const complexity = analyzeDocxComplexity(file)
    
    if (complexity === 'simple') {
      return 'ckeditor'
    }
    
    return 'onlyoffice'
  }
  
  if (file.type === 'txt') {
    return 'monaco'
  }
  
  return 'download-only'
}
```

### Фаза 4: Real-time Collaboration (4-6 недель)

**Week 1-2: Backend**
- [ ] Установить `ypy`, `ypy-websocket`
- [ ] Создать WebSocket endpoint
- [ ] Реализовать CRDT sync
- [ ] Тестирование

**Week 3-4: Frontend**
- [ ] Установить `yjs`, `y-websocket`
- [ ] Интегрировать с Monaco
- [ ] Интегрировать с CKEditor
- [ ] Добавить presence (кто онлайн)

**Week 5-6: Testing & Polish**
- [ ] Нагрузочное тестирование
- [ ] Conflict resolution
- [ ] UI/UX improvements

---

## 💰 Оценка Стоимости

### Разработка

| Задача | Время | Стоимость (при $50/час) |
|--------|-------|-------------------------|
| PDF Редактор | 3 недели | $6,000 |
| Simple Word Editor | 2 недели | $4,000 |
| Автовыбор | 1 неделя | $2,000 |
| Real-time Collaboration | 6 недель | $12,000 |
| **ИТОГО** | **12 недель** | **$24,000** |

### Инфраструктура

| Компонент | Стоимость/месяц |
|-----------|-----------------|
| OnlyOffice (Community) | $0 |
| CKEditor (Premium) | €99 |
| WebSocket сервер | $50 |
| CDN для PDF.js | $20 |
| **ИТОГО** | **~$170/месяц** |

---

## 🚀 Итоговые Рекомендации

### Что Делать Сейчас

1. **✅ Реализовать кастомный PDF редактор**
   - Заменить простую подпись
   - Добавить аннотации, highlight, комментарии
   - Библиотеки: PDF.js + pdf-lib + Fabric.js
   - **Время:** 2-3 недели
   - **ROI:** Высокий

2. **✅ Добавить Simple Word Editor**
   - CKEditor 5 для простых документов
   - Экспорт/импорт DOCX через docx.js
   - **Время:** 1-2 недели
   - **ROI:** Средний

3. **✅ Оставить OnlyOffice**
   - Для сложных документов
   - Автоматический выбор редактора
   - **Время:** 1 неделя (интеграция)
   - **ROI:** Высокий

### Что Делать Потом

4. **Real-time Collaboration**
   - Y.js + WebSockets
   - **Время:** 4-6 недель
   - **ROI:** Очень высокий

5. **AI Features**
   - Резюме, перевод, проверка грамматики
   - **Время:** 2-3 недели
   - **ROI:** Высокий

6. **Mobile App**
   - React Native
   - **Время:** 8-12 недель
   - **ROI:** Средний

---

**Вывод:** Кастомный PDF редактор - **ОБЯЗАТЕЛЬНО**. Simple Word Editor - **ЖЕЛАТЕЛЬНО**. OnlyOffice - **ОСТАВИТЬ** для сложных случаев.

**Общая оценка:** 6-8 недель разработки для полноценного решения.
