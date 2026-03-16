# API Contracts

Источник истины:
- OpenAPI: `/api/openapi.json`
- Swagger UI: `/api/docs`

Базовый префикс: `/api/v1`

## Формат ответа

Успех:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

Ошибка:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Readable message"
  }
}
```

## Авторизация

Поддерживаются:
- `Authorization: Bearer <token>`
- `HttpOnly` cookie

Для фронтенда основной сценарий: cookie + refresh через `/api/v1/auth/refresh`.

## Основные группы endpoint

- `auth` — регистрация, логин, refresh, logout, текущий пользователь
- `orgs` — текущая организация, участники, приглашения, смена роли
- `tables` — таблицы, колонки, записи, views, folders, экспорт и импорт
- `knowledge` — страницы базы знаний
- `files` — загрузка, скачивание, удаление
- `notifications` — список, unread count, read/read-all
- `reports` — summary, analytics, dashboards
- `billing` — планы, usage, платежи, подписка, webhook
- `ai` — chat, status, usage, chats, context helpers
- `access` — ACL/rules
- `superadmin` — login, dashboard, orgs, users, billing, AI runtime

## Технические endpoint

- `GET /api/health`
- `GET /api/readiness`
- `GET /metrics`

## Правило для интеграций

Для внешних клиентов ориентир только такой:
1. валидировать `ok`, `data`, `error.code`
2. не полагаться на внутренние поля, которых нет в OpenAPI
3. перед релизом сверяться с OpenAPI текущего окружения

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
