# API Contracts

Базовый префикс API: `/api/v1`  
Документация OpenAPI: `/api/openapi.json`  
Swagger UI: `/api/docs` (в production может быть выключен)

## 1. Формат ответа

Стандартный формат:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": null
}
```

Формат ошибки:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "field": "optional_field"
  }
}
```

## 2. Авторизация

Поддерживаются 2 варианта:

- `Authorization: Bearer <token>`
- `HttpOnly` cookie (основной вариант для фронта)

Cookie-конфиг управляется `AUTH_*` переменными.  
Frontend работает с `withCredentials=true` и refresh через `/api/v1/auth/refresh`.

## 3. Контракты по модулям

Ниже список основных endpoint-групп (источник истины: OpenAPI).

### Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

Примечание:
- login/register/refresh выставляют auth cookies.
- refresh/logout берут refresh token из cookie, если его нет в body.

### Organizations

- `GET /orgs/current`
- `DELETE /orgs/current`
- `GET /orgs/my`
- `POST /orgs/switch`
- `GET /orgs/members`
- `POST /orgs/invites`
- `POST /orgs/invites/accept`
- `POST /orgs/invites/{invite_id}/resend`
- `PUT /orgs/members/{membership_id}/role`
- `DELETE /orgs/members/{membership_id}`

### Tables and Records

- `POST /tables/`
- `GET /tables/`
- `GET /tables/{table_id}`
- `PATCH /tables/{table_id}`
- `DELETE /tables/{table_id}`
- `POST /tables/{table_id}/columns`
- `PATCH /tables/{table_id}/columns/{column_id}`
- `DELETE /tables/{table_id}/columns/{column_id}`
- `POST /tables/{table_id}/records/`
- `GET /tables/{table_id}/records/`
- `GET /tables/{table_id}/records/{record_id}`
- `PATCH /tables/{table_id}/records/{record_id}`
- `DELETE /tables/{table_id}/records/{record_id}`
- `POST /tables/{table_id}/records/{record_id}/move`
- `POST /tables/{table_id}/filter`
- `GET /tables/{table_id}/export/csv`
- `GET /tables/{table_id}/export/xlsx`
- `POST /tables/{table_id}/import/csv`

### Views/Folders

- `POST /tables/folders/`
- `GET /tables/folders/`
- `PATCH /tables/folders/{folder_id}`
- `DELETE /tables/folders/{folder_id}`
- `POST /tables/{table_id}/views/`
- `GET /tables/{table_id}/views/`
- `DELETE /tables/{table_id}/views/{view_id}`

### Files

- `POST /files/upload`
- `GET /files/`
- `GET /files/{file_id}/download`
- `DELETE /files/{file_id}`

### Notifications

- `GET /notifications/`
- `GET /notifications/unread-count`
- `POST /notifications/{notif_id}/read`
- `POST /notifications/read-all`

### Knowledge

- `POST /knowledge/pages`
- `GET /knowledge/pages`
- `GET /knowledge/pages/{page_id}`
- `PATCH /knowledge/pages/{page_id}`
- `DELETE /knowledge/pages/{page_id}`

### Reports

- `GET /reports/summary`
- `POST /reports/table-analytics`
- `GET /reports/timeline`
- `GET /reports/dashboards`
- `POST /reports/dashboards`
- `GET /reports/dashboards/{dashboard_id}`
- `PATCH /reports/dashboards/{dashboard_id}`
- `DELETE /reports/dashboards/{dashboard_id}`
- `POST /reports/dashboards/{dashboard_id}/widgets`
- `PATCH /reports/dashboards/{dashboard_id}/widgets/{widget_id}`
- `DELETE /reports/dashboards/{dashboard_id}/widgets/{widget_id}`
- `GET /reports/dashboards/{dashboard_id}/data`

### Billing

- `GET /billing/plans`
- `GET /billing/usage`
- `POST /billing/create-payment`
- `GET /billing/subscription`
- `POST /billing/cancel-subscription`
- `POST /billing/webhook/yookassa` (служебный, скрыт из schema)

### AI

- `POST /ai/chat`
- `GET /ai/status`
- `GET /ai/usage`
- `GET /ai/chats`
- `POST /ai/chats`
- `DELETE /ai/chats/{chat_id}`
- `GET /ai/chats/{chat_id}/messages`
- `POST /ai/context-estimate`
- `GET /ai/context-sources`

### Access Rules

- `GET /access/rules`
- `POST /access/rules`
- `PATCH /access/rules/{rule_id}`
- `DELETE /access/rules/{rule_id}`

### Superadmin

- Public:
  - `POST /superadmin/login`
- Protected:
  - `POST /superadmin/logout`
  - `GET /superadmin/dashboard`
  - `GET /superadmin/overview`
  - `GET /superadmin/orgs`
  - `GET /superadmin/orgs/{org_id}`
  - `GET /superadmin/orgs/{org_id}/members`
  - `GET /superadmin/users`
  - `GET /superadmin/tables`
  - `GET /superadmin/ai-usage`
  - `PATCH /superadmin/orgs/{org_id}/plan`
  - `PATCH /superadmin/orgs/{org_id}/ai-enabled`
  - `POST /superadmin/orgs/{org_id}/ai/reset-usage`
  - `GET /superadmin/ai-config`
  - `GET /superadmin/audit/logs`
  - `GET /superadmin/orgs/{org_id}/tables`
  - `GET /superadmin/orgs/{org_id}/tables/{table_id}`
  - `GET /superadmin/orgs/{org_id}/tables/{table_id}/records`
  - `GET /superadmin/orgs/{org_id}/tables/{table_id}/export/csv`
  - `GET /superadmin/orgs/{org_id}/tables/{table_id}/export/xlsx`

## 4. Health и технические endpoint

- `GET /api/health` - статус API + зависимостей.
- `GET /api/readiness` - readiness probe (503 если БД недоступна).
- `GET /metrics` - метрики Prometheus.

## 5. Правило для интеграций

Контракты могут расширяться. Для стабильной интеграции:

1. Валидировать `ok`, `error.code`, `data`.
2. Не парсить внутренние поля, которых нет в OpenAPI схеме.
3. Перед релизом сверяться с `/api/openapi.json` текущего окружения.

## 6. Примеры (быстрый старт интеграции)

### Логин пользователя

```bash
curl -i -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"secret"}'
```

Ожидаем:
- `Set-Cookie` для access/refresh.
- JSON с `ok=true` и `data.access_token`/`data.refresh_token`.

### Получить текущего пользователя (через cookie)

```bash
curl -i http://localhost:8000/api/v1/auth/me \
  --cookie "access_token=<token>"
```

### Обновить access токен

```bash
curl -i -X POST http://localhost:8000/api/v1/auth/refresh \
  --cookie "refresh_token=<token>"
```

### Ошибка авторизации

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing authorization credentials"
  }
}
```
