# Sprint 1 Runbook (Security Hardening)

## Что уже внедрено в коде

- В `docker-compose.prod.yml` удалены дефолтные секреты и включены обязательные переменные (`:?set in secrets`).
- В `docker-compose.prod.yml` убраны внешние порты для `rabbitmq`, `prometheus`, `grafana`.
- В backend закрыта публикация Swagger/OpenAPI в production по умолчанию.
- В `nginx` добавлен явный deny на `/api/docs`, `/api/redoc`, `/api/openapi.json`.
- В `Settings` добавлена строгая валидация production-конфига (в т.ч. `CHANGE_ME`, localhost/example, дефолтные DSN/ключи).
- В `secrets.yml.example` заменены слабые значения на `CHANGE_ME_*`.

## Операционные шаги (сделать на окружении)

1. Сгенерировать новый набор секретов:

```bash
make gen-prod-secrets domain=your-domain.com > .env.prod.generated
```

2. Перенести значения в `secrets.yml` или secret manager (Vault/1Password/Bitwarden/etc).

3. Обязательно задать:
- `POSTGRES_*`, `DATABASE_URL`, `DATABASE_URL_SYNC`
- `RABBITMQ_*`, `RABBITMQ_URL`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `SECRET_KEY` (длина 32+)
- `JWT_USER_SECRET_KEY`, `JWT_SUPERADMIN_SECRET_KEY` (разные, длина 32+)
- `JWT_ISSUER`, `JWT_AUDIENCE_USER`, `JWT_AUDIENCE_SUPERADMIN`
- `DOMAIN`, `FRONTEND_URL`, `CORS_ORIGINS`
- `GRAFANA_USER`, `GRAFANA_PASSWORD`
- `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD_HASH` (если нужен superadmin вход)

4. Перезапустить production:

```bash
docker compose -f docker-compose.prod.yml -f secrets.yml up -d --build
```

5. Проверить, что admin-сервисы снаружи недоступны:
- `:15672` (RabbitMQ UI)
- `:9090` (Prometheus)
- `:3000` (Grafana)

6. Проверить API:
- `GET /api/health` доступен
- `GET /api/docs` и `GET /api/openapi.json` возвращают `404` в production

## Примечание

Ротация уже существующих паролей БД/брокера/объектного хранилища требует отдельной процедуры миграции данных и обновления credentials на стороне сервисов.
