# CRM Platform

Мультитенантная CRM-платформа: таблицы, база знаний, документы, отчёты, AI, billing.

## Быстрый старт

1. Скопируй `secrets.yml.example` в `secrets.yml`
2. Заполни значения для локальной разработки
3. Запусти:

```bash
./scripts/compose-dev.sh up -d --build
```

## Полезные URL

- frontend: `http://localhost:5173`
- api: `http://localhost:8000`
- swagger: `http://localhost:8000/api/docs`
- health: `http://localhost:8000/api/health`
- readiness: `http://localhost:8000/api/readiness`

## Полезные команды

```bash
./scripts/compose-dev.sh ps
./scripts/compose-dev.sh logs -f api
./scripts/compose-dev.sh up -d --build
./scripts/compose-prod.sh up -d --build
```

## Важно про секреты

- `secrets.yml` нужен только для локального dev
- production secrets должны идти через env или `*_FILE`

Подробности:
- [docs/README.md](docs/README.md)
- [docs/config/CONFIG_CONTRACT.md](docs/config/CONFIG_CONTRACT.md)
