# Secrets.yml - Руководство по конфигурации

**Дата:** 27 февраля 2026 г.  
**Статус:** ✅ Secrets.yml работает корректно и загружается в контейнеры

---

## 📌 Быстрый старт

### 1. Создай secrets.yml (если не существует)

```bash
cd /Users/ibragim/PycharmProjects/CRM_AI/crm_ai
cp secrets.yml.example secrets.yml
```

### 2. Отредактируй критические значения

```bash
nano secrets.yml
```

### 3. Запусти проект

```bash
docker compose -f docker-compose.yml -f secrets.yml up -d
```

---

## 🔐 Параметры Secrets.yml

### Database (PostgreSQL)

```yaml
services:
  db:
    environment:
      POSTGRES_USER: "change_me"          # Пользователь БД
      POSTGRES_PASSWORD: "change_me"      # Пароль БД (минимум 12 символов)
      POSTGRES_DB: "crm_db"               # Имя БД
```

**Рекомендации:**
- Используй сложный пароль для production
- Минимум 12 символов
- Комбинируй буквы, цифры, спецсимволы

---

### RabbitMQ (Message Broker)

```yaml
services:
  rabbitmq:
    environment:
      RABBITMQ_DEFAULT_USER: "change_me"  # Пользователь RabbitMQ
      RABBITMQ_DEFAULT_PASS: "change_me"  # Пароль RabbitMQ
      RABBITMQ_USER: "change_me"          # Для унификации в backend
      RABBITMQ_PASS: "change_me"          # Для унификации в backend
```

**Важно:** Используй одинаковые учетные данные в обоих местах!

---

### MinIO (S3 Storage)

```yaml
services:
  minio:
    environment:
      MINIO_ROOT_USER: "change_me"        # Access Key
      MINIO_ROOT_PASSWORD: "change_me"    # Secret Key
```

**Рекомендации:**
- Access Key: минимум 3 символа
- Secret Key: минимум 8 символов
- Лучше использовать автогенерированные значения

---

### Backend API

```yaml
services:
  api:
    environment:
      # === Feature flags ===
      ENABLE_AI: "true"                   # Включить AI функции
      ENABLE_SENTRY: "false"              # Включить Sentry мониторинг
      ENABLE_METRICS: "true"              # Включить Prometheus метрики
      ENABLE_RATE_LIMIT: "true"           # Включить rate limiting

      # === Domain & URLs ===
      DOMAIN: "crm.example.com"           # Твой домен
      FRONTEND_URL: "https://crm.example.com"  # URL фронтенда
      CORS_ORIGINS: '["http://localhost:5173","https://crm.example.com"]'  # CORS

      # === Database ===
      POSTGRES_USER: "change_me"          # Должно совпадать с db.environment
      POSTGRES_PASSWORD: "change_me"      # Должно совпадать с db.environment
      POSTGRES_DB: "crm_db"               # Должно совпадать с db.environment
      DATABASE_URL: "postgresql+asyncpg://change_me:change_me@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://change_me:change_me@db:5432/crm_db"

      # === Redis ===
      REDIS_URL: "redis://redis:6379/0"   # Хост:порт/база

      # === RabbitMQ ===
      RABBITMQ_USER: "change_me"          # Должно совпадать с rabbitmq.environment
      RABBITMQ_PASS: "change_me"          # Должно совпадать с rabbitmq.environment
      RABBITMQ_URL: "amqp://change_me:change_me@rabbitmq:5672/"

      # === S3 / MinIO ===
      S3_ENDPOINT: "http://minio:9000"    # Endpoint MinIO/S3
      S3_PUBLIC_ENDPOINT: "http://localhost:9000"  # Public URL
      S3_ACCESS_KEY: "change_me"          # Должно совпадать с minio.MINIO_ROOT_USER
      S3_SECRET_KEY: "change_me"          # Должно совпадать с minio.MINIO_ROOT_PASSWORD
      S3_BUCKET: "crm-files"              # Имя bucket'а
      S3_REGION: "us-east-1"              # AWS регион

      # === Security ===
      SECRET_KEY: "change_me_min_32_chars"  # Генерируй: openssl rand -hex 32
      JWT_USER_SECRET_KEY: "change_me_min_32"   # Отдельный ключ для пользователей
      JWT_SUPERADMIN_SECRET_KEY: "change_me_min_32"  # Ключ для админов
      JWT_ALGORITHM: "HS256"              # Алгоритм подписания

      # === Email (SMTP) ===
      SMTP_HOST: "smtp.gmail.com"         # SMTP сервер
      SMTP_PORT: "587"                    # SMTP порт
      SMTP_USER: "your-email@gmail.com"   # Email
      SMTP_PASSWORD: "your-app-password"  # App password (для Gmail)
      SMTP_FROM: "noreply@crm.example.com"  # From адрес
      SMTP_TLS: "true"                    # Использовать TLS

      # === AI (Timeweb Agent / OpenAI) ===
      OPENAI_BEARER_TOKEN: "your-token"   # Timeweb Agent API ключ
      OPENAI_API_KEY: ""                  # OpenAI API ключ (если используется)
      OPENAI_MODEL: "gpt-4.1"             # Модель
      AI_BASE_URL: "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/.../v1"
      AI_PROVIDER_MODE: "timeweb_native"  # or openai_compatible

      # === Billing (YooKassa) ===
      YOOKASSA_SHOP_ID: ""                # ID магазина YooKassa
      YOOKASSA_SECRET_KEY: ""             # API ключ YooKassa

      # === Superadmin ===
      SUPERADMIN_EMAIL: "admin"           # Email админа
      SUPERADMIN_PASSWORD_HASH: ""        # Bcrypt хеш пароля
```

---

## 🛠️ Генерация ключей

### SECRET_KEY (32+ символа)

```bash
# Вариант 1: OpenSSL (рекомендуется)
openssl rand -hex 32

# Вариант 2: Python
python3 -c "import secrets; print(secrets.token_hex(32))"

# Вариант 3: Linux
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' '
```

### JWT Secret Keys (то же самое)

```bash
# Генерируй отдельный ключ для каждого
openssl rand -hex 32  # JWT_USER_SECRET_KEY
openssl rand -hex 32  # JWT_SUPERADMIN_SECRET_KEY
```

### Superadmin Password Hash (bcrypt)

```bash
# Вариант 1: Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'your-password', bcrypt.gensalt()).decode())"

# Вариант 2: Online (https://bcrypt-generator.com/)
```

---

## 📋 Таблица совместимости

**ВАЖНО:** Значения должны совпадать в нескольких местах!

| Параметр | DB Service | RabbitMQ Service | API Service | Notes |
|----------|-----------|-----------------|------------|-------|
| POSTGRES_USER | ✓ | - | ✓ | Должны совпадать |
| POSTGRES_PASSWORD | ✓ | - | ✓ | Должны совпадать |
| POSTGRES_DB | ✓ | - | ✓ | Должны совпадать |
| RABBITMQ_USER | - | RABBITMQ_DEFAULT_USER | ✓ | Должны совпадать |
| RABBITMQ_PASS | - | RABBITMQ_DEFAULT_PASS | ✓ | Должны совпадать |
| S3_ACCESS_KEY | - | - | ✓ | Должны совпадать с MINIO_ROOT_USER |
| S3_SECRET_KEY | - | - | ✓ | Должны совпадать с MINIO_ROOT_PASSWORD |

---

## 🚀 Примеры конфигурации

### DEV (разработка)

```yaml
services:
  api:
    environment:
      POSTGRES_USER: "dev_user"
      POSTGRES_PASSWORD: "dev_password"
      SECRET_KEY: "dev-secret-key-min-32-chars-xxx"
      JWT_USER_SECRET_KEY: "dev-jwt-user-key-min-32-chars"
      JWT_SUPERADMIN_SECRET_KEY: "dev-jwt-admin-key-min-32-chars"
      S3_ACCESS_KEY: "minioadmin"
      S3_SECRET_KEY: "minioadmin"
      ENABLE_AI: "false"                  # Отключить AI для dev
      DEBUG: "true"
      LOG_LEVEL: "DEBUG"
```

### PROD (production)

```yaml
services:
  api:
    environment:
      POSTGRES_USER: "prod_secure_user_$random"
      POSTGRES_PASSWORD: "$strong_password_32_chars_min"
      SECRET_KEY: "$generated_with_openssl_rand_hex_32"
      JWT_USER_SECRET_KEY: "$generated_with_openssl_rand_hex_32"
      JWT_SUPERADMIN_SECRET_KEY: "$generated_with_openssl_rand_hex_32"
      S3_ACCESS_KEY: "$your_aws_or_s3_access_key"
      S3_SECRET_KEY: "$your_aws_or_s3_secret_key"
      ENABLE_AI: "true"
      ENABLE_SENTRY: "true"
      DEBUG: "false"
      LOG_LEVEL: "INFO"
      DOMAIN: "your-domain.com"
      FRONTEND_URL: "https://your-domain.com"
      CORS_ORIGINS: '["https://your-domain.com"]'
      AUTH_COOKIE_SECURE: "true"
```

---

## ✅ Чеклист перед запуском

- [ ] Скопировал secrets.yml.example → secrets.yml
- [ ] Отредактировал все CHANGE_ME_* значения
- [ ] Проверил совпадение POSTGRES_* в db и api сервисах
- [ ] Проверил совпадение RABBITMQ_* в rabbitmq и api сервисах
- [ ] Проверил совпадение S3_* с MINIO_ROOT_*
- [ ] Сгенерировал SECRET_KEY и JWT ключи (openssl)
- [ ] Настроил SMTP для email рассылок (если требуется)
- [ ] Настроил AI токены (если включен ENABLE_AI)
- [ ] secrets.yml не в git (проверил .gitignore)
- [ ] Запустил проект: `docker compose -f docker-compose.yml -f secrets.yml up -d`
- [ ] Проверил логи: `docker logs crm_chechen-api-1`

---

## 🔍 Как проверить что secrets.yml загружается

### Метод 1: Через docker inspect

```bash
docker inspect crm_chechen-api-1 | grep -A 100 "Env" | grep DATABASE_URL
```

Должен вывести загруженный DATABASE_URL с твоими значениями.

### Метод 2: Через docker exec

```bash
docker exec crm_chechen-api-1 printenv | grep DATABASE
```

Должен вывести переменные окружения контейнера.

### Метод 3: Проверить логи

```bash
docker logs crm_chechen-api-1 | grep -E "Settings|Config|Environment"
```

---

## 🐛 Troubleshooting

### Проблема: "Failed to resolve import"

Это не связано с secrets.yml. Это проблема фронтенда с npm зависимостями.

**Решение:**
```bash
docker exec crm_chechen-frontend-1 npm install
docker restart crm_chechen-frontend-1
```

### Проблема: "Connection refused" для БД

Проверь что DATABASE_URL совпадает в docker-compose.yml и secrets.yml:

```bash
grep DATABASE_URL docker-compose.yml secrets.yml
```

### Проблема: "Authentication failed" для RabbitMQ

Убедись что RABBITMQ_USER и RABBITMQ_PASS совпадают везде:

```bash
grep -E "RABBITMQ_.*USER|RABBITMQ_.*PASS" secrets.yml
```

---

## 📞 Где найти документацию

- [docs/secrets_yml_guide.md](../docs/secrets_yml_guide.md) — дополнительное руководство
- [docker-compose.yml](../docker-compose.yml) — DEV конфигурация
- [docker-compose.prod.yml](../docker-compose.prod.yml) — PROD конфигурация
- [backend/src/config.py](../backend/src/config.py) — загрузка конфигурации в Python

---

**Статус:** Secrets.yml работает корректно ✅  
**Дата обновления:** 27 февраля 2026 г.
