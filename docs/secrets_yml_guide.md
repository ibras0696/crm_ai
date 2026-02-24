# Production Secrets Guide (`secrets.yml`)

Этот документ про production и полный `secrets.yml`.

Источник: [secrets.yml.example](../secrets.yml.example)

## 1) Как использовать в prod

```bash
cp secrets.yml.example secrets.yml
# заполнить secrets.yml
docker compose -f docker-compose.prod.yml -f secrets.yml up -d --build
```

## 2) Полный production `secrets.yml` (все ключи)

Ниже полный шаблон на основе `secrets.yml.example`, но с production-ориентированными значениями/плейсхолдерами.

```yaml
services:
  # --- Database (PostgreSQL) ---
  db:
    environment:
      # ОБЯЗАТЕЛЬНО поменять
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "<STRONG_DB_PASSWORD>"
      # можно оставить
      POSTGRES_DB: "crm_db"

  # --- Message broker (RabbitMQ) ---
  rabbitmq:
    environment:
      # ОБЯЗАТЕЛЬНО поменять
      RABBITMQ_DEFAULT_USER: "crm_rabbit"
      RABBITMQ_DEFAULT_PASS: "<STRONG_RABBIT_PASSWORD>"
      # дубли для унификации с backend
      RABBITMQ_USER: "crm_rabbit"
      RABBITMQ_PASS: "<STRONG_RABBIT_PASSWORD>"

  # --- Object storage (S3/MinIO) ---
  minio:
    environment:
      # ОБЯЗАТЕЛЬНО поменять
      MINIO_ROOT_USER: "<S3_ACCESS_KEY>"
      MINIO_ROOT_PASSWORD: "<S3_SECRET_KEY>"

  # --- Backend API ---
  api:
    environment:
      # --- Feature flags ---
      ENABLE_AI: "true"
      ENABLE_SENTRY: "false"
      ENABLE_METRICS: "true"
      ENABLE_RATE_LIMIT: "true"

      # --- Domain / Web ---
      # ОБЯЗАТЕЛЬНО задать реальные
      DOMAIN: "crm.example.com"
      FRONTEND_URL: "https://crm.example.com"
      CORS_ORIGINS: "[\"https://crm.example.com\"]"

      # --- PostgreSQL ---
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "<STRONG_DB_PASSWORD>"
      POSTGRES_DB: "crm_db"
      DATABASE_URL: "postgresql+asyncpg://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      DB_POOL_SIZE: "20"
      DB_MAX_OVERFLOW: "10"
      DB_POOL_TIMEOUT_S: "30"
      DB_POOL_RECYCLE_S: "1800"
      DB_HEALTH_TIMEOUT_S: "2"
      API_WORKERS: "4"

      # --- Redis ---
      REDIS_URL: "redis://redis:6379/0"
      REDIS_HEALTH_TIMEOUT_S: "2"

      # --- RabbitMQ ---
      RABBITMQ_USER: "crm_rabbit"
      RABBITMQ_PASS: "<STRONG_RABBIT_PASSWORD>"
      RABBITMQ_URL: "amqp://crm_rabbit:<STRONG_RABBIT_PASSWORD>@rabbitmq:5672/"

      # --- S3 / MinIO ---
      S3_ENDPOINT: "http://minio:9000"
      S3_ACCESS_KEY: "<S3_ACCESS_KEY>"
      S3_SECRET_KEY: "<S3_SECRET_KEY>"
      S3_BUCKET: "crm-files"
      S3_REGION: "us-east-1"
      S3_FORCE_PATH_STYLE: "true"
      S3_VERIFY_SSL: "true"
      S3_USE_SSL: "false"

      # --- App / Security ---
      APP_NAME: "CRM Platform"
      SECRET_KEY: "<SECRET_KEY_MIN_32>"
      JWT_USER_SECRET_KEY: "<JWT_USER_SECRET_KEY_MIN_32>"
      JWT_SUPERADMIN_SECRET_KEY: "<JWT_SUPERADMIN_SECRET_KEY_MIN_32_OTHER>"
      JWT_ISSUER: "crm-platform"
      JWT_AUDIENCE_USER: "crm-api-users"
      JWT_AUDIENCE_SUPERADMIN: "crm-api-superadmin"
      JWT_ALGORITHM: "HS256"
      ACCESS_TOKEN_EXPIRE_MINUTES: "30"
      REFRESH_TOKEN_EXPIRE_DAYS: "7"
      AUTH_COOKIE_SECURE: "true"
      AUTH_COOKIE_SAMESITE: "lax"
      AUTH_COOKIE_DOMAIN: "crm.example.com"
      AUTH_COOKIE_PATH: "/"

      DEBUG: "false"
      LOG_LEVEL: "INFO"
      ENVIRONMENT: "production"

      # --- Sentry ---
      SENTRY_DSN: ""

      # --- AI ---
      # если ENABLE_AI=true, нужно задать OPENAI_BEARER_TOKEN ИЛИ OPENAI_API_KEY
      OPENAI_BEARER_TOKEN: "<OPENAI_BEARER_TOKEN>"
      OPENAI_API_KEY: ""
      OPENAI_MODEL: "gpt-4.1"
      AI_BASE_URL: "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/<agent-id>/v1"
      AI_MAX_TOKENS: "6000"
      AI_MAX_TOKENS_PER_REQUEST: "2000"
      AI_MAX_TOKENS_PER_DAY_PER_ORG: "200000"
      AI_RPM_PER_USER: "30"
      AI_SYSTEM_PROMPT: "You are an AI assistant for the CRM platform. Reply in Russian."

      # --- Billing (YooKassa) ---
      YOOKASSA_SHOP_ID: "<YOOKASSA_SHOP_ID>"
      YOOKASSA_SECRET_KEY: "<YOOKASSA_SECRET_KEY>"
      YOOKASSA_RETURN_URL: "https://crm.example.com/billing/success"

      # --- SMTP ---
      SMTP_HOST: "smtp.gmail.com"
      SMTP_PORT: "587"
      SMTP_USER: "<SMTP_USER>"
      SMTP_PASSWORD: "<SMTP_PASSWORD>"
      SMTP_FROM: "noreply@crm.example.com"
      SMTP_FROM_NAME: "CRM Platform"
      SMTP_TLS: "true"

      # --- Superadmin seed ---
      # либо оба пустые, либо оба заданы
      SUPERADMIN_EMAIL: "root@crm.example.com"
      SUPERADMIN_PASSWORD_HASH: "<BCRYPT_HASH>"
      SUPERADMIN_ACCESS_COOKIE_NAME: "sa_access_token"

  # --- Backend bootstrap ---
  # ДОЛЖНО совпадать с api для общих ключей
  bootstrap:
    environment:
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "<STRONG_DB_PASSWORD>"
      POSTGRES_DB: "crm_db"
      DATABASE_URL: "postgresql+asyncpg://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      REDIS_URL: "redis://redis:6379/0"
      RABBITMQ_USER: "crm_rabbit"
      RABBITMQ_PASS: "<STRONG_RABBIT_PASSWORD>"
      RABBITMQ_URL: "amqp://crm_rabbit:<STRONG_RABBIT_PASSWORD>@rabbitmq:5672/"
      S3_ENDPOINT: "http://minio:9000"
      S3_ACCESS_KEY: "<S3_ACCESS_KEY>"
      S3_SECRET_KEY: "<S3_SECRET_KEY>"
      S3_BUCKET: "crm-files"
      S3_REGION: "us-east-1"
      SECRET_KEY: "<SECRET_KEY_MIN_32>"
      JWT_USER_SECRET_KEY: "<JWT_USER_SECRET_KEY_MIN_32>"
      JWT_SUPERADMIN_SECRET_KEY: "<JWT_SUPERADMIN_SECRET_KEY_MIN_32_OTHER>"
      DEBUG: "false"
      LOG_LEVEL: "INFO"
      ENVIRONMENT: "production"

  # --- Celery worker ---
  celery_worker:
    environment:
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "<STRONG_DB_PASSWORD>"
      POSTGRES_DB: "crm_db"
      DATABASE_URL: "postgresql+asyncpg://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      REDIS_URL: "redis://redis:6379/0"
      RABBITMQ_USER: "crm_rabbit"
      RABBITMQ_PASS: "<STRONG_RABBIT_PASSWORD>"
      RABBITMQ_URL: "amqp://crm_rabbit:<STRONG_RABBIT_PASSWORD>@rabbitmq:5672/"
      S3_ENDPOINT: "http://minio:9000"
      S3_ACCESS_KEY: "<S3_ACCESS_KEY>"
      S3_SECRET_KEY: "<S3_SECRET_KEY>"
      S3_BUCKET: "crm-files"
      S3_REGION: "us-east-1"
      SECRET_KEY: "<SECRET_KEY_MIN_32>"
      JWT_USER_SECRET_KEY: "<JWT_USER_SECRET_KEY_MIN_32>"
      JWT_SUPERADMIN_SECRET_KEY: "<JWT_SUPERADMIN_SECRET_KEY_MIN_32_OTHER>"
      DEBUG: "false"
      LOG_LEVEL: "INFO"
      ENVIRONMENT: "production"

  # --- Celery beat ---
  celery_beat:
    environment:
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "<STRONG_DB_PASSWORD>"
      POSTGRES_DB: "crm_db"
      DATABASE_URL: "postgresql+asyncpg://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://crm_prod:<STRONG_DB_PASSWORD>@db:5432/crm_db"
      REDIS_URL: "redis://redis:6379/0"
      RABBITMQ_USER: "crm_rabbit"
      RABBITMQ_PASS: "<STRONG_RABBIT_PASSWORD>"
      RABBITMQ_URL: "amqp://crm_rabbit:<STRONG_RABBIT_PASSWORD>@rabbitmq:5672/"
      S3_ENDPOINT: "http://minio:9000"
      S3_ACCESS_KEY: "<S3_ACCESS_KEY>"
      S3_SECRET_KEY: "<S3_SECRET_KEY>"
      S3_BUCKET: "crm-files"
      S3_REGION: "us-east-1"
      SECRET_KEY: "<SECRET_KEY_MIN_32>"
      JWT_USER_SECRET_KEY: "<JWT_USER_SECRET_KEY_MIN_32>"
      JWT_SUPERADMIN_SECRET_KEY: "<JWT_SUPERADMIN_SECRET_KEY_MIN_32_OTHER>"
      DEBUG: "false"
      LOG_LEVEL: "INFO"
      ENVIRONMENT: "production"

  # --- Monitoring / Grafana ---
  grafana:
    environment:
      GRAFANA_USER: "grafana_admin"
      GRAFANA_PASSWORD: "<STRONG_GRAFANA_PASSWORD>"
      GF_SECURITY_ADMIN_USER: "grafana_admin"
      GF_SECURITY_ADMIN_PASSWORD: "<STRONG_GRAFANA_PASSWORD>"
```

## 3) Что менять обязательно, что нет

### Обязательно менять (всегда)

- `POSTGRES_PASSWORD`
- `RABBITMQ_DEFAULT_PASS`, `RABBITMQ_PASS`
- `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY`
- `SECRET_KEY`
- `JWT_USER_SECRET_KEY`
- `JWT_SUPERADMIN_SECRET_KEY`
- `GRAFANA_PASSWORD`, `GF_SECURITY_ADMIN_PASSWORD`
- `DOMAIN`, `FRONTEND_URL`, `CORS_ORIGINS`
- `AUTH_COOKIE_SECURE=true` в prod

### Обязательно, если фича используется

- AI: `OPENAI_BEARER_TOKEN` или `OPENAI_API_KEY`
- Billing: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`
- Email: `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- Superadmin seed: `SUPERADMIN_EMAIL` + `SUPERADMIN_PASSWORD_HASH` (парой)

### Можно оставить дефолтом

- `POSTGRES_DB`, `S3_BUCKET`, `S3_REGION`
- `JWT_ISSUER`, `JWT_AUDIENCE_USER`, `JWT_AUDIENCE_SUPERADMIN`, `JWT_ALGORITHM`
- `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`
- `DB_POOL_*`, `REDIS_HEALTH_TIMEOUT_S`
- `API_WORKERS` (по умолчанию `4`, влияет на `uvicorn --workers`)
- `OPENAI_MODEL`, `AI_MAX_TOKENS*`, `AI_RPM_PER_USER`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM_NAME`, `SMTP_TLS`

## 4) Примеры генерации значений

```bash
# base64 секреты
openssl rand -base64 64

# hex секрет
openssl rand -hex 32

# bcrypt hash для superadmin
python - <<'PY'
import bcrypt
password = b"ChangeMeStrongPassword123!"
print(bcrypt.hashpw(password, bcrypt.gensalt()).decode())
PY
```

Готовый генератор из репозитория:

```bash
./scripts/generate_prod_secrets.sh crm.example.com > .env.prod.generated
```

## 5) Жесткая pre-release проверка

- нет `CHANGE_ME` в `secrets.yml`
- `ENVIRONMENT=production`
- `DEBUG=false`
- `AUTH_COOKIE_SECURE=true`
- `JWT_USER_SECRET_KEY != JWT_SUPERADMIN_SECRET_KEY`
- `CORS_ORIGINS` без `localhost`
- `SUPERADMIN_PASSWORD` нигде не используется
- если `ENABLE_AI=true`, задан AI-токен/ключ
