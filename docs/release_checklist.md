# Релизный чек-лист (AI + лимиты + billing/payments)

## 1. Pre-release

1. Проверить миграции:
- `alembic heads`
- `alembic current`

2. Снять backup (см. `docs/migrations_rollback_plan.md`).

3. Проверить env/secrets:
- `OPENAI_BEARER_TOKEN` (fallback)
- `AI_BASE_URL`, `AI_PROVIDER_MODE`
- `YOOKASSA_*` (fallback, если runtime не заполнен)

## 2. Smoke после деплоя

1. Superadmin AI:
- открыть раздел AI;
- сохранить `model/base_url/provider_mode`;
- убедиться, что токен маскируется;
- проверить появление записи в audit.

2. Superadmin Billing:
- открыть `billing/config`;
- проверить, что видны `plans`, `token_packages`, `recent_purchases`, `yookassa`.

3. YooKassa runtime:
- задать `shop_id`, `secret_key`, `return_url`, `webhook_url`;
- нажать "Проверить подключение";
- убедиться в маскировке секрета и записи в audit.

4. Token packages:
- создать пакет;
- отредактировать пакет;
- деактивировать пакет.

5. Org admin limits:
- открыть `/orgs/ai/limits`;
- выставить org limit (day/month);
- выставить user limit (daily/rpm).

6. AI chat:
- сценарий обычного вопроса (без action);
- сценарий action (создание таблицы/KB);
- сценарий превышения лимита (ожидаемый код ошибки).

7. Billing payments:
- создать payment (`/billing/create-payment`) с runtime YooKassa;
- отправить webhook `payment.succeeded`;
- проверить, что подписка обновилась.

## 3. Автотесты перед релизом

1. Запустить модульные и интеграционные тесты:
```bash
pytest -q backend/src/modules/ai/tests
pytest -q backend/src/modules/org/tests/test_org_api.py -k "ai_limits"
pytest -q backend/src/modules/billing/tests
pytest -q backend/src/modules/superadmin/tests/test_superadmin_sprint2_api.py -k "billing|ai_runtime"
pytest -q backend/tests/integration/test_ai_limits_billing_payments_e2e.py
```

2. Проверить линтер backend:
```bash
ruff check backend/src backend/tests
```

## 4. Rollback критерии

Откат делать, если:
1. не сохраняются runtime AI/YooKassa настройки;
2. не работают лимиты (ошибки не соответствуют контракту);
3. payment creation/webhook ломают подписки;
4. regression в AI action execution.

Rollback команды и риски: `docs/migrations_rollback_plan.md`.
