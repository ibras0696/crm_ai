# Security Hardening Runbook

Дата обновления: 2026-02-24

## 1. Принципы запуска в production

- Production не должен стартовать с небезопасными секретами.
- Все секреты задаются через env/secret manager, не через дефолты в compose.
- Для admin-сервисов (RabbitMQ UI, Grafana, Prometheus) внешний доступ только через приватную сеть/VPN.

## 2. Секреты и ключи

- `SECRET_KEY`, JWT ключи, пароли БД, RabbitMQ, MinIO, Grafana должны быть уникальными на окружение.
- В шаблонах (`docker-compose*.yml`, `secrets.yml.example`) только пустые значения или `CHANGE_ME`.
- Для production использовать отдельные ключи подписи:
  - `JWT_SECRET_KEY_USER`
  - `JWT_SECRET_KEY_SUPERADMIN`

## 3. Cookie-сессия вместо localStorage

Система переведена на `HttpOnly` cookie:

- Access cookie: `AUTH_ACCESS_COOKIE_NAME`
- Refresh cookie: `AUTH_REFRESH_COOKIE_NAME`
- Обязательные prod-настройки:
  - `AUTH_COOKIE_SECURE=true`
  - `AUTH_COOKIE_SAMESITE` не `none` без `secure`
  - при необходимости `AUTH_COOKIE_DOMAIN`/`AUTH_COOKIE_PATH`

Проверка: backend валидирует конфиг и блокирует небезопасный prod-старт.

## 4. CSP и security headers

- На frontend nginx включен CSP с nonce и строгими заголовками.
- На backend API CSP ограничен (`default-src 'none'`) и не раскрывает лишние источники.
- Swagger/OpenAPI в production ограничены политикой доступа.

## 5. Auth hardening

- JWT валидация включает `type=access`, `iss`, `aud` и обязательные claims.
- Для superadmin:
  - пароль хранится в hash;
  - включены rate-limit и lockout/backoff;
  - login/logout работают через защищенные cookie.
- Refresh flow защищен от race condition (atomic/locking модель).

## 6. Runtime hardening

- Global rate limit переведен на shared Redis limiter.
- Для upload/streaming введены лимиты размера и безопасная потоковая обработка.
- Для CSV/XLSX import/export введены лимиты строк/колонок/времени с graceful fail.
- Ошибки AI-провайдера не отдаются клиенту в сыром виде.

## 7. CI и контроль зависимостей

- Тесты и type-check в CI блокирующие (без `|| echo` обходов).
- Добавлены dependency audit проверки:
  - backend: `pip-audit --strict`
  - frontend: `npm audit --audit-level=high`
- CVE policy описан в `docs/dependency_audit_policy.md`.

## 8. Smoke/regression после релиза

После каждого релиза security-изменений:

1. QA smoke:
   - login/logout/refresh (user + superadmin)
   - ACL/tenant isolation
   - upload/import/export граничные сценарии
2. DevOps smoke:
   - сервисы поднимаются только с безопасными env
   - admin-панели не доступны из внешней сети
   - алерты/логи security событий поступают
3. Фиксация результата:
   - ссылка на прогон CI
   - ссылка на релиз/деплой
   - отметка QA и DevOps в PR

## 9. Ротация секретов (процедура)

1. Сгенерировать новые секреты/ключи для окружения.
2. Обновить secret manager и runtime переменные.
3. Перезапустить сервисы с новым конфигом.
4. Прогнать smoke/regression.
5. Отозвать старые ключи и убедиться, что старые токены невалидны.
