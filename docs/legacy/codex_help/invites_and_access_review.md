# Приглашения Сотрудников И Права Доступа: Ревью + CURL Сценарии

Дата: 2026-02-22

Цель: зафиксировать, как сейчас работает приглашение сотрудников и права доступа (RBAC/Access Rules), и что нужно доделать.

## 1) Как работает приглашение (Invite flow)

Где реализовано:
- Роуты: `backend/src/modules/org/routes.py`
- Логика: `backend/src/modules/org/service.py`
- Модели: `backend/src/modules/org/models.py`
- Репозитории: `backend/src/modules/org/repository.py`

Что происходит:
1. **OWNER/ADMIN** вызывает `POST /api/v1/orgs/invites` (email + role).
2. Создается запись `invites` со статусом `pending`, `expires_at=now+7d`, и генерируется `token`.
3. `token` **не возвращается** клиенту (это нормально с точки зрения безопасности).
4. Получатель должен принять приглашение через `POST /api/v1/orgs/invites/accept`, передав `token` + данные профиля + пароль.
5. При принятии:
   - если user не существует, создается новый user;
   - создается membership (роль берется из invite);
   - invite помечается `accepted`;
   - выдается `access_token` + `refresh_token`.

Текущий гэп:
- В проекте нет “реального” канала доставки `token` до пользователя:
  - email задачи сейчас stub (`backend/src/modules/notifications/tasks.py`).
  - UI должен либо:
    - слать письмо с invite-link,
    - либо давать администратору “скопировать invite link” (dev-only режим),
    - либо иметь кнопку “повторно отправить приглашение”.

## 2) Роли (грубый RBAC на уровне эндпоинтов)

Сейчас ограничения в основном через `require_roles(...)`:
- `POST /orgs/invites` доступно только `OWNER|ADMIN`.
- Таблицы/отчеты/ai/расписание имеют разные role-матрицы.

Это “грубое” RBAC: роль определяет доступ к целым эндпоинтам/модулям, но не к конкретным ресурсам (таблицам/страницам KB/дашбордам).

## 3) Access Rules (тонкие права доступа)

Где реализовано:
- API: `backend/src/modules/access/routes.py`
- Модель: `backend/src/modules/access/models.py`

Что есть:
- CRUD API для правил: `GET/POST/PATCH/DELETE /api/v1/access/rules`.
- `check_access(...)` умеет проверять:
  - правила на конкретный `resource_id`;
  - правила на тип ресурса (resource_id = null);
  - на user_id или role.

Критичный гэп (на сейчас):
- `check_access(...)` **нигде не используется**, кроме самого `access` модуля.
- В конце функции стоит `return True` (default allow), то есть даже при подключении без изменения логики будет риск “разрешено по умолчанию”.

Рекомендованный следующий шаг:
- Вынести `check_access` в отдельный сервис/dep (`src/modules/access/service.py` или `dependencies.py`).
- Интегрировать проверки в `tables/knowledge/reports/schedule/files` (в нужных местах create/update/delete/read).
- Определиться с политикой по умолчанию для не-owner/admin:
  - либо **deny by default** (без правила нет доступа),
  - либо **allow by default** (как сейчас), но тогда правила не несут смысла безопасности.

## 4) CURL сценарии (шаблоны)

Примечания:
- Токены не вставляйте в историю терминала в проде.
- Ниже используются плейсхолдеры: `<ACCESS_TOKEN>`, `<INVITE_TOKEN>`.

### 4.1 Регистрация владельца (создает org)

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@example.com",
    "password": "StrongPass123!",
    "first_name": "Owner",
    "last_name": "User",
    "org_name": "My Org"
  }'
```

### 4.2 Создать приглашение (owner/admin)

```bash
curl -X POST http://localhost:8000/api/v1/orgs/invites \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "invited@example.com",
    "role": "employee"
  }'
```

Ожидаемо:
- `token` в ответе не будет.

### 4.3 Принять приглашение

`<INVITE_TOKEN>` должен прийти через email/invite-link (пока это надо реализовать).

```bash
curl -X POST http://localhost:8000/api/v1/orgs/invites/accept \
  -H "Content-Type: application/json" \
  -d '{
    "token": "<INVITE_TOKEN>",
    "password": "StrongPass123!",
    "first_name": "Invited",
    "last_name": "User"
  }'
```

### 4.4 Проверка: employee не может приглашать

```bash
curl -X POST http://localhost:8000/api/v1/orgs/invites \
  -H "Authorization: Bearer <EMPLOYEE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"email":"x@example.com","role":"employee"}'
```

Ожидаемо: `403`.

### 4.5 Access Rules: создать правило

```bash
curl -X POST http://localhost:8000/api/v1/access/rules \
  -H "Authorization: Bearer <OWNER_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "resource_type": "table",
    "resource_id": null,
    "role": "employee",
    "can_read": true,
    "can_write": false,
    "can_delete": false
  }'
```

Важно: пока правила не применяются (нет интеграции `check_access` в остальные модули).

