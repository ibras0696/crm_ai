# План миграций и rollback (Спринты 2-5)

Документ покрывает блоки изменений, которые затрагивают AI runtime, лимиты и billing/runtime платежей.

## Блоки миграций

1. `025_add_ai_runtime_secrets_and_provider_fields.py`  
Что добавляет:
- `ai_runtime_settings.ai_base_url`, `ai_provider_mode`
- таблицы `ai_runtime_secrets`, `ai_runtime_audits`

2. `026_add_org_and_user_ai_limits.py`  
Что добавляет:
- таблицы `ai_org_limits`, `ai_user_limits`

3. `027_add_billing_runtime_settings_and_secrets.py`  
Что добавляет:
- таблицы `billing_runtime_settings`, `billing_runtime_secrets`, `billing_runtime_audits`

## Порядок применения

1. Сделать backup БД перед релизом.
2. Применить миграции:
```bash
alembic upgrade head
```
3. Проверить текущую ревизию:
```bash
alembic current
alembic heads
```

## Быстрый rollback по блокам

1. Откат только Sprint 4 (billing runtime):
```bash
alembic downgrade 026
```

2. Откат Sprint 4 + Sprint 3:
```bash
alembic downgrade 025
```

3. Откат Sprint 4 + Sprint 3 + Sprint 2:
```bash
alembic downgrade 024
```

## Риски при откате

1. `027 -> 026`:
- удаляются `billing_runtime_*` таблицы;
- теряются runtime `shop_id/secret/urls` и аудит платежных настроек.

2. `026 -> 025`:
- удаляются `ai_org_limits`, `ai_user_limits`;
- теряются кастомные лимиты организаций/сотрудников.

3. `025 -> 024`:
- удаляются runtime настройки и секреты AI;
- система вернется к env-only конфигурации AI.

## Рекомендованный backup перед релизом

Пример selective dump только новых таблиц:
```bash
pg_dump "$DATABASE_URL_SYNC" \
  -t ai_runtime_settings \
  -t ai_runtime_secrets \
  -t ai_runtime_audits \
  -t ai_org_limits \
  -t ai_user_limits \
  -t billing_runtime_settings \
  -t billing_runtime_secrets \
  -t billing_runtime_audits \
  -f sprint2_4_runtime_backup.sql
```

## Post-migration проверки

1. Superadmin:
- AI settings читаются/сохраняются;
- Billing settings читаются/сохраняются;
- YooKassa `test connection` отрабатывает.

2. Org admin:
- `/orgs/ai/limits` показывает и сохраняет лимиты.

3. AI chat:
- запросы проходят при валидных лимитах;
- лимитные ошибки возвращают ожидаемые коды (`AI_USER_RATE_LIMIT`, `AI_TOKEN_LIMIT_EXCEEDED` и т.д.).
