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
        migrate migration shell-api shell-db \
        up-prod down-prod restart-prod logs-prod \
        test lint lint-fix clean clean-all

COMPOSE := docker compose
SECRETS_FILE ?= secrets.yml

COMPOSE_DEV_FILES := -f docker-compose.yml
ifneq ($(wildcard $(SECRETS_FILE)),)
COMPOSE_DEV_FILES += -f $(SECRETS_FILE)
endif
COMPOSE_DEV := $(COMPOSE) $(COMPOSE_DEV_FILES)

COMPOSE_PROD_FILES := -f docker-compose.prod.yml
ifneq ($(wildcard $(SECRETS_FILE)),)
COMPOSE_PROD_FILES += -f $(SECRETS_FILE)
endif
COMPOSE_PROD := $(COMPOSE) $(COMPOSE_PROD_FILES)

# Цвета (опционально)
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

help:
	@echo ""
	@echo "$(CYAN)CRM — доступные команды$(RESET)"
	@echo ""
	@echo "$(GREEN)DEV$(RESET)"
	@echo "  make init          — подготовка (создаёт secrets.yml из example, если нужно)"
	@echo "  make up            — поднять dev (docker-compose.yml + secrets.yml если есть)"
	@echo "  make down          — остановить dev"
	@echo "  make restart       — пересобрать и перезапустить dev"
	@echo "  make logs          — логи dev (все сервисы)"
	@echo "  make logs-api      — логи dev (api)"
	@echo "  make logs-front    — логи dev (frontend)"
	@echo "  make ps            — статус контейнеров dev"
	@echo ""
	@echo "$(GREEN)PROD$(RESET)"
	@echo "  make up-prod       — поднять prod (docker-compose.prod.yml + secrets.yml если есть)"
	@echo "  make down-prod     — остановить prod"
	@echo "  make restart-prod  — пересобрать и перезапустить prod"
	@echo "  make logs-prod     — логи prod"
	@echo ""
	@echo "$(GREEN)БД / миграции$(RESET)"
	@echo "  make migrate       — применить миграции Alembic (dev)"
	@echo "  make migration m=  — создать миграцию (m='название') (dev)"
	@echo "  make shell-db      — psql в контейнере db (dev)"
	@echo "  make shell-api     — sh в контейнере api (dev)"
	@echo ""
	@echo "$(GREEN)Качество$(RESET)"
	@echo "  make test          — pytest (dev)"
	@echo "  make lint          — ruff check (dev)"
	@echo "  make lint-fix      — ruff --fix (dev)"
	@echo ""

init:
	@if [ ! -f "$(SECRETS_FILE)" ]; then \
		if [ -f "secrets.yml.example" ]; then \
			cp secrets.yml.example "$(SECRETS_FILE)"; \
			echo "$(GREEN)✔ Создан $(SECRETS_FILE) из secrets.yml.example$(RESET)"; \
		else \
			echo "$(YELLOW)⚠ secrets.yml.example не найден. Создай $(SECRETS_FILE) вручную.$(RESET)"; \
		fi; \
	else \
		echo "$(GREEN)✔ $(SECRETS_FILE) уже существует$(RESET)"; \
	fi
	@echo "$(CYAN)Примечание: backend/.env используется только для dev (env_file).$(RESET)"

up:
	$(COMPOSE_DEV) up -d --build

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

## Migrations / Shell (dev)
migrate:
	$(COMPOSE_DEV) exec api alembic upgrade head

migration:
	@if [ -z "$(m)" ]; then echo "$(YELLOW)⚠ Укажи m='название миграции'$(RESET)"; exit 1; fi
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
	@echo "$(YELLOW)⚠ ВНИМАНИЕ: удаляем volumes (данные БД/MinIO и т.д.)$(RESET)"
	@echo "$(YELLOW)   Запусти вручную, если уверен: docker compose ... down -v$(RESET)"
	@exit 1

