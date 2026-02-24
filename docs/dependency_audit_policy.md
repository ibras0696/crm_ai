# Dependency Audit Policy (pip/npm)

## Цель

Сделать supply-chain проверки регулярными и блокирующими в CI.

## Правила

- Python зависимости проверяются на каждом PR и push через `pip-audit --strict`.
- Frontend зависимости проверяются на каждом PR и push через `npm audit --audit-level=high`.
- Сборка/деплой не продолжаются, если dependency audit job завершился с ошибкой.

## SLA по уязвимостям

- `critical`: исправление/митигирование до merge.
- `high`: исправление до merge (или временный pin/override с ticket и сроком).
- `medium/low`: плановое исправление в ближайшем спринте.

## Исключения

- Временное исключение допускается только с:
  - ссылкой на issue,
  - обоснованием риска,
  - сроком снятия исключения.

## Инструменты в CI

- Backend: `pip-audit`
- Frontend: `npm audit`
