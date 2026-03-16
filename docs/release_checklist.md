# Release Checklist

## Перед релизом

- проверить миграции
- проверить production env/secrets
- прогнать `ruff`
- прогнать полный backend suite
- собрать frontend

Минимум:

```bash
./scripts/compose-dev.sh exec -T api ruff check src/ tests/
./scripts/compose-dev.sh exec -T api pytest -q
docker compose -f docker-compose.prod.yml config -q
```

## После деплоя

Проверить:
- `GET /api/health`
- `GET /api/readiness`
- логин пользователя
- создание и чтение таблицы
- AI chat
- docs upload/download
- billing payment/webhook
- superadmin runtime settings

## Когда делать rollback

Откат нужен, если:
- приложение не проходит `health/readiness`
- сломана авторизация
- billing/webhook меняет подписки неверно
- docs upload/edit/download не работают
- AI недоступен или ломает критический user flow
