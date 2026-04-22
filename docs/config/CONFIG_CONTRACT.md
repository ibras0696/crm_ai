# Config Contract

Источник истины:
- [backend/src/config.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/config.py)
- [backend/src/config_contract.py](/Users/ibragim/PycharmProjects/CRM_AI/crm_ai/backend/src/config_contract.py)

## 1. App config

Обычные deploy-time настройки.

Примеры:
- `ENVIRONMENT`
- `DOMAIN`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- лимиты и таймауты

Хранятся в env.

## 2. Secrets

Чувствительные deploy-time значения.

Для production официальный вариант:
- `VAR_NAME`
- или `VAR_NAME_FILE`

Примеры:
- `SECRET_KEY`
- `JWT_*`
- `DATABASE_URL`
- `RABBITMQ_URL`
- `S3_SECRET_KEY`
- `OPENAI_*`
- `YOOKASSA_*`
- `BILLING_WEBHOOK_SHARED_SECRET`
- `SMTP_PASSWORD`

## 3. Runtime settings

Изменяемые настройки, которые правятся без redeploy через superadmin.

Сейчас это:
- AI runtime settings
- billing YooKassa runtime settings

Runtime secrets в БД хранятся только в зашифрованном виде.

## 4. Роль `secrets.yml`

`secrets.yml` — только local dev override.

Он:
- удобен для локального compose
- не является production source of truth
- не должен быть основной моделью для staging/prod
