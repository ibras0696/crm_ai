# ============================================================
#  CRM Makefile — удобные команды для разработки и продакшена
#
# Требования:
# - GNU Make
# - Docker + Docker Compose v2
#
# Примечание:
# - Makefile использует простые POSIX-команды (`cp`, `sh`).
#   Если вы на Windows, запускайте из Git Bash / WSL.
# ============================================================

.PHONY: help init up down build restart ps logs logs-api logs-front \
        bootstrap migrate migration shell-api shell-db \
        up-prod down-prod restart-prod logs-prod \
        test lint lint-fix clean clean-all gen-prod-secrets

COMPOSE_DEV := docker compose --profile dev -f docker-compose.yml -f secrets.yml
COMPOSE_PROD := docker compose --profile prod -f docker-compose.prod.yml -f secrets.yml
SECRETS_FILE ?= secrets.yml

help:
	@echo ""
	@echo "CRM - available commands"
	@echo ""
	@echo "DEV"
	@echo "  make init          - prepare (creates secrets.yml from secrets.yml.example if needed)"
	@echo "  make up            - start dev (docker-compose.yml + secrets.yml if exists)"
	@echo "  make down          - stop dev"
	@echo "  make restart       - rebuild and restart dev"
	@echo "  make logs          - logs dev (all services)"
	@echo "  make logs-api      - logs dev (api)"
	@echo "  make logs-front    - logs dev (frontend)"
	@echo "  make ps            - dev containers status"
	@echo ""
	@echo "PROD"
	@echo "  make up-prod       - start prod (docker-compose.prod.yml + secrets.yml if exists)"
	@echo "  make down-prod     - stop prod"
	@echo "  make restart-prod  - rebuild and restart prod"
	@echo "  make logs-prod     - logs prod"
	@echo "  make gen-prod-secrets domain=example.com - generate strong prod secrets template"
	@echo ""
	@echo "DB / migrations"
	@echo "  make migrate       - apply Alembic migrations (dev)"
	@echo "  make migration m=  - create migration (m='name') (dev)"
	@echo "  make shell-db      - psql inside db container (dev)"
	@echo "  make shell-api     - sh inside api container (dev)"
	@echo ""
	@echo "QUALITY"
	@echo "  make test          - pytest (dev)"
	@echo "  make lint          - ruff check (dev)"
	@echo "  make lint-fix      - ruff --fix (dev)"
	@echo ""
	@echo "RU: make help-ru"
	@echo ""

help-ru:
	@echo ""
	@echo "CRM - доступные команды"
	@echo ""
	@echo "DEV"
	@echo "  make init          - подготовка (создает secrets.yml из secrets.yml.example, если нужно)"
	@echo "  make up            - поднять dev (docker-compose.yml + secrets.yml если есть)"
	@echo "  make down          - остановить dev"
	@echo "  make restart       - пересобрать и перезапустить dev"
	@echo "  make logs          - логи dev (все сервисы)"
	@echo "  make logs-api      - логи dev (api)"
	@echo "  make logs-front    - логи dev (frontend)"
	@echo "  make ps            - статус контейнеров dev"
	@echo ""
	@echo "PROD"
	@echo "  make up-prod       - поднять prod (docker-compose.prod.yml + secrets.yml если есть)"
	@echo "  make down-prod     - остановить prod"
	@echo "  make restart-prod  - пересобрать и перезапустить prod"
	@echo "  make logs-prod     - логи prod"
	@echo "  make gen-prod-secrets domain=example.com - сгенерировать шаблон сильных prod секретов"
	@echo ""
	@echo "БД / миграции"
	@echo "  make migrate       - применить миграции Alembic (dev)"
	@echo "  make migration m=  - создать миграцию (m='название') (dev)"
	@echo "  make shell-db      - psql в контейнере db (dev)"
	@echo "  make shell-api     - sh в контейнере api (dev)"
	@echo ""
	@echo "Качество"
	@echo "  make test          - pytest (dev)"
	@echo "  make lint          - ruff check (dev)"
	@echo "  make lint-fix      - ruff --fix (dev)"
	@echo ""

init:
	@if [ ! -f "$(SECRETS_FILE)" ]; then \
		if [ -f "secrets.yml.example" ]; then \
			cp secrets.yml.example "$(SECRETS_FILE)"; \
			echo "[OK] Создан $(SECRETS_FILE) из secrets.yml.example"; \
		else \
			echo "[WARN] secrets.yml.example не найден. Создай $(SECRETS_FILE) вручную."; \
		fi; \
	else \
		echo "[OK] $(SECRETS_FILE) уже существует"; \
	fi
	@echo "Примечание: docker-compose берет секреты из secrets.yml (если подключен). backend/.env не трогаем."

up:
	$(COMPOSE_DEV) up -d --build

bootstrap:
	$(COMPOSE_DEV) run --rm bootstrap

down:
	$(COMPOSE_DEV) down

build:
	$(COMPOSE_DEV) build

restart:
	$(COMPOSE_DEV) down
	$(COMPOSE_DEV) up -d --build

ps:
	$(COMPOSE_DEV) ps

logs:
	$(COMPOSE_DEV) logs -f --tail=200

logs-api:
	$(COMPOSE_DEV) logs -f --tail=200 api

logs-front:
	$(COMPOSE_DEV) logs -f --tail=200 frontend

## Prod
up-prod:
	$(COMPOSE_PROD) up -d --build

down-prod:
	$(COMPOSE_PROD) down

logs-prod:
	$(COMPOSE_PROD) logs -f --tail=200

restart-prod:
	$(COMPOSE_PROD) down
	$(COMPOSE_PROD) up -d --build

gen-prod-secrets:
	@if [ -z "$(domain)" ]; then echo "[WARN] Укажи domain=example.com"; exit 1; fi
	bash ./scripts/generate_prod_secrets.sh "$(domain)"

## Migrations / Shell (dev)
migrate:
	$(COMPOSE_DEV) exec api alembic upgrade head

migration:
	@if [ -z "$(m)" ]; then echo "[WARN] Укажи m='название миграции'"; exit 1; fi
	$(COMPOSE_DEV) exec api alembic revision --autogenerate -m "$(m)"

shell-api:
	$(COMPOSE_DEV) exec api sh

shell-db:
	$(COMPOSE_DEV) exec db sh -lc 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

## Quality (dev)
test:
	$(COMPOSE_DEV) exec api pytest tests/ -v --tb=short

lint:
	$(COMPOSE_DEV) exec api ruff check src/ --select E,W,F --ignore E501

lint-fix:
	$(COMPOSE_DEV) exec api ruff check src/ --fix --select E,W,F --ignore E501

## Cleanup
clean:
	$(COMPOSE_DEV) down --remove-orphans
	docker image prune -f

clean-all:
	@echo "[WARN] ВНИМАНИЕ: удаляем volumes (данные БД/MinIO и т.д.)"
	@echo "[WARN] Запусти вручную, если уверен: docker compose ... down -v"
	@exit 1
