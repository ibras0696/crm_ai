# Chat Production Rollout Runbook (crm.py-it.ru)

Дата обновления: 26 мая 2026

## Scope
- Realtime reconnect/backfill pipeline
- Infinite history + attachment loading optimization
- Chat telemetry and observability

## Feature Flags
Backend (`.env`):
- `CHAT_REALTIME_ROLLOUT_ENABLED=true|false`
- `CHAT_REALTIME_ROLLOUT_PERCENT=0..100`
- `CHAT_TELEMETRY_ENABLED=true|false`

Frontend (`.env` fallback):
- `VITE_CHAT_REALTIME_ROLLOUT_ENABLED=true|false`
- `VITE_CHAT_REALTIME_ROLLOUT_PERCENT=0..100`
- `VITE_CHAT_TELEMETRY_ENABLED=true|false`

Рекомендуемая стратегия:
1. `CHAT_REALTIME_ROLLOUT_PERCENT=5`
2. 30-60 минут наблюдения
3. `25 -> 50 -> 100`

## Metrics To Watch
- `chat_ws_connections_total`
- `chat_ws_reconnects_total`
- `chat_message_lag_seconds`
- `chat_attachment_download_url_requests_total`
- `chat_errors_total`
- `chat_telemetry_events_total`

## Smoke / Regression (prod-stand)
1. Auth:
- login/logout
- refresh токена

2. Chat:
- открыть чат и отправить 3 сообщения
- оборвать сеть на 10-20с и восстановить
- проверить backfill через `after_seq_no`

3. Files:
- upload вложения
- отправка сообщения с вложением
- открытие/скачивание вложения

## Rollback Plan
Шаг 1 (мягкий rollback):
- `CHAT_REALTIME_ROLLOUT_PERCENT=0`
- оставить `CHAT_TELEMETRY_ENABLED=true` для диагностики

Шаг 2 (жесткий rollback):
- `CHAT_REALTIME_ROLLOUT_ENABLED=false`
- при необходимости `CHAT_TELEMETRY_ENABLED=false`

Шаг 3:
- проверить отсутствие всплеска `chat_errors_total`
- проверить стабилизацию `chat_ws_reconnects_total`

## Post-Release Monitoring (24-48h)
- первые 2 часа: контроль каждые 15 минут
- до 24ч: контроль каждый час
- 24-48ч: контроль каждые 2-4 часа
- фиксировать инциденты и корреляцию с deploy/rollout шагами
