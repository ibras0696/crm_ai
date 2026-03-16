# Config Contract

Этот документ фиксирует модель конфигурации проекта и заменяет расплывчатое восприятие `secrets.yml` как основного operational источника.

Источник правды:
- typed settings: [backend/src/config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/config.py)
- config contract metadata: [backend/src/config_contract.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/config_contract.py)

## Слои конфигурации

1. `app config`
   Статические deploy-time настройки приложения. Хранятся в env.

2. `credentials/secrets`
   Чувствительные deploy-time значения. Хранятся в env или через mounted secret files с паттерном `VAR_NAME_FILE`.

3. `runtime mutable settings`
   Изменяемые значения, которыми управляет superadmin во время работы системы. Хранятся в БД.

## Где что живет

### Env / app config

Сюда относятся:
- feature flags
- лимиты и таймауты
- network endpoints
- cookie/cors/domain настройки
- non-secret defaults для billing/ai/docs

Примеры:
- `APP_NAME`
- `ENVIRONMENT`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `BILLING_GRACE_DAYS`
- `DOCS_RETENTION_DAYS`

### Env or mounted secret file

Сюда относятся чувствительные deploy-time значения. Для production официальный контракт такой:
- либо `VAR_NAME`
- либо `VAR_NAME_FILE`

`*_FILE` имеет приоритет над обычным env значением и позволяет подключать Docker/Kubernetes/Vault-style mounted secrets без правки кода.

Примеры:
- `SECRET_KEY` / `SECRET_KEY_FILE`
- `JWT_USER_SECRET_KEY` / `JWT_USER_SECRET_KEY_FILE`
- `JWT_SUPERADMIN_SECRET_KEY` / `JWT_SUPERADMIN_SECRET_KEY_FILE`
- `DATABASE_URL` / `DATABASE_URL_FILE`
- `RABBITMQ_URL` / `RABBITMQ_URL_FILE`
- `S3_SECRET_KEY` / `S3_SECRET_KEY_FILE`
- `OPENAI_BEARER_TOKEN` / `OPENAI_BEARER_TOKEN_FILE`
- `OPENAI_API_KEY` / `OPENAI_API_KEY_FILE`
- `YOOKASSA_SECRET_KEY` / `YOOKASSA_SECRET_KEY_FILE`
- `SMTP_PASSWORD` / `SMTP_PASSWORD_FILE`
- `DOCS_ONLYOFFICE_JWT_SECRET` / `DOCS_ONLYOFFICE_JWT_SECRET_FILE`

### Runtime DB config

Это mutable настройки, которыми управляет superadmin без redeploy:

AI runtime:
- `model`
- `ai_base_url`
- `ai_provider_mode`
- `system_prompt`
- `temperature`
- `max_tokens_per_request`
- `strict_actions`

Billing runtime:
- `yookassa_shop_id`
- `yookassa_return_url`
- `yookassa_webhook_url`

### Runtime encrypted secrets in DB

Это runtime-секреты, которые меняются через superadmin и хранятся в БД только в зашифрованном виде:
- `ai.ai_bearer_token`
- `billing.yookassa_secret_key`

Код:
- [runtime_secret.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/common/runtime_secret.py)
- [ai_config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/superadmin/services/ai_config.py)
- [runtime_config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/modules/billing/runtime_config.py)

## Роль `secrets.yml`

`secrets.yml` теперь трактуется только как local dev override:
- удобно для локального compose
- не является operational source of truth
- не должен использоваться как основная prod/staging модель секретов

## Официальная production strategy

Для production принимается один официальный путь:

1. обычные app settings идут через env
2. чувствительные значения идут через mounted secret files с `*_FILE`
3. mutable runtime settings управляются через БД / superadmin

Это даёт:
- ротацию без перепаковки `secrets.yml`
- более чистый audit trail
- совместимость с Docker secrets, Kubernetes secrets и внешними secret managers, которые монтируют файл в контейнер
