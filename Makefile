# ============================================================
#  CRM Makefile — удобные команды для разработки и продакшена
# ============================================================

.PHONY: help up down build restart logs ps \
        up-prod down-prod logs-prod \
        migrate shell-api shell-db \
        test lint clean init

# Цвета для вывода
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

## ─── Помощь ───────────────────────────────────────────────
help:
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════════╗$(RESET)"
	@echo "$(CYAN)║         CRM — доступные команды              ║$(RESET)"
	@echo "$(CYAN)╚══════════════════════════════════════════════╝$(RESET)"
	@echo ""
	@echo "$(GREEN)── DEV ──────────────────────────────────────$(RESET)"
	@echo "  make init          — первый запуск (копирует .env, поднимает всё)"
	@echo "  make up            — запустить все сервисы (dev)"
	@echo "  make down          — остановить все сервисы (dev)"
	@echo "  make build         — пересобрать образы (dev)"
	@echo "  make restart       — пересобрать и перезапустить (dev)"
	@echo "  make logs          — логи всех сервисов"
	@echo "  make logs-api      — логи только API"
	@echo "  make logs-front    — логи только фронтенда"
	@echo "  make ps            — статус контейнеров"
	@echo ""
	@echo "$(GREEN)── PROD ─────────────────────────────────────$(RESET)"
	@echo "  make up-prod       — запустить продакшен"
	@echo "  make down-prod     — остановить продакшен"
	@echo "  make logs-prod     — логи продакшена"
	@echo "  make restart-prod  — перезапустить продакшен"
	@echo ""
	@echo "$(GREEN)── БД / МИГРАЦИИ ────────────────────────────$(RESET)"
	@echo "  make migrate       — применить миграции Alembic"
	@echo "  make migration m=  — создать новую миграцию (m='название')"
	@echo "  make shell-db      — psql в контейнере БД"
	@echo "  make shell-api     — bash в контейнере API"
	@echo ""
	@echo "$(GREEN)── ТЕСТЫ / ЛИНТЕР ───────────────────────────$(RESET)"
	@echo "  make test          — запустить тесты бэкенда"
	@echo "  make lint          — проверить код (ruff)"
	@echo "  make lint-fix      — исправить код (ruff --fix)"
	@echo ""
	@echo "$(GREEN)── ОЧИСТКА ──────────────────────────────────$(RESET)"
	@echo "  make clean         — удалить остановленные контейнеры и образы"
	@echo "  make clean-all     — полная очистка (включая volumes!)"
	@echo ""

## ─── Первый запуск ────────────────────────────────────────
init:
	@echo "$(CYAN)▶ Инициализация проекта...$(RESET)"
	@if [ ! -f backend/.env ]; then \
		cp .env.example backend/.env; \
		echo "$(GREEN)✔ Создан backend/.env из .env.example$(RESET)"; \
	else \
		echo "$(YELLOW)⚠ backend/.env уже существует, пропускаем$(RESET)"; \
	fi
	@echo "$(CYAN)▶ Запускаем сервисы...$(RESET)"
	docker compose up -d --build
	@echo "$(GREEN)✔ Проект запущен!$(RESET)"
	@echo ""
	@echo "  API:       http://localhost:8000"
	@echo "  Docs:      http://localhost:8000/api/docs"
	@echo "  Frontend:  http://localhost:5173"
	@echo "  MinIO:     http://localhost:9001"
	@echo "  RabbitMQ:  http://localhost:15672"
	@echo "  Grafana:   http://localhost:3000"
	@echo "  Prometheus:http://localhost:9090"

## ─── DEV команды ──────────────────────────────────────────
up:
	@echo "$(CYAN)▶ Запускаем dev-окружение...$(RESET)"
	docker compose up -d
	@echo "$(GREEN)✔ Готово$(RESET)"
	@echo "  API:       http://localhost:8000/api/docs"
	@echo "  Frontend:  http://localhost:5173"
	@echo "  Grafana:   http://localhost:3000  (admin/admin)"
	@echo "  RabbitMQ:  http://localhost:15672 (crm_rabbit/crm_rabbit_pass)"

down:
	@echo "$(CYAN)▶ Останавливаем dev-окружение...$(RESET)"
	docker compose down
	@echo "$(GREEN)✔ Остановлено$(RESET)"

build:
	@echo "$(CYAN)▶ Пересобираем образы...$(RESET)"
	docker compose build --no-cache
	@echo "$(GREEN)✔ Сборка завершена$(RESET)"

restart:
	@echo "$(CYAN)▶ Пересобираем и перезапускаем...$(RESET)"
	docker compose down
	docker compose up -d --build
	@echo "$(GREEN)✔ Перезапущено$(RESET)"

logs:
	docker compose logs -f --tail=100

logs-api:
	docker compose logs -f --tail=100 api

logs-front:
	docker compose logs -f --tail=100 frontend

ps:
	@echo "$(CYAN)▶ Статус контейнеров:$(RESET)"
	docker compose ps

## ─── PROD команды ─────────────────────────────────────────
up-prod:
	@echo "$(CYAN)▶ Запускаем ПРОДАКШЕН...$(RESET)"
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "$(YELLOW)⚠ Создан .env из .env.example — заполните переменные!$(RESET)"; \
	fi
	docker compose -f docker-compose.prod.yml up -d --build
	@echo "$(GREEN)✔ Продакшен запущен$(RESET)"

down-prod:
	@echo "$(CYAN)▶ Останавливаем продакшен...$(RESET)"
	docker compose -f docker-compose.prod.yml down
	@echo "$(GREEN)✔ Остановлено$(RESET)"

logs-prod:
	docker compose -f docker-compose.prod.yml logs -f --tail=100

restart-prod:
	@echo "$(CYAN)▶ Перезапускаем продакшен...$(RESET)"
	docker compose -f docker-compose.prod.yml down
	docker compose -f docker-compose.prod.yml up -d --build
	@echo "$(GREEN)✔ Перезапущено$(RESET)"

## ─── Миграции ─────────────────────────────────────────────
migrate:
	@echo "$(CYAN)▶ Применяем миграции Alembic...$(RESET)"
	docker compose exec api alembic upgrade head
	@echo "$(GREEN)✔ Миграции применены$(RESET)"

migration:
	@echo "$(CYAN)▶ Создаём миграцию: $(m)$(RESET)"
	docker compose exec api alembic revision --autogenerate -m "$(m)"
	@echo "$(GREEN)✔ Миграция создана$(RESET)"

## ─── Оболочки ─────────────────────────────────────────────
shell-api:
	@echo "$(CYAN)▶ Открываем bash в контейнере API...$(RESET)"
	docker compose exec api bash

shell-db:
	@echo "$(CYAN)▶ Открываем psql в контейнере БД...$(RESET)"
	docker compose exec db psql -U crm_user -d crm_db

## ─── Тесты ────────────────────────────────────────────────
test:
	@echo "$(CYAN)▶ Запускаем тесты бэкенда...$(RESET)"
	docker compose exec api pytest tests/ -v --tb=short
	@echo "$(GREEN)✔ Тесты завершены$(RESET)"

lint:
	@echo "$(CYAN)▶ Проверяем код (ruff)...$(RESET)"
	docker compose exec api ruff check src/ --select E,W,F --ignore E501
	@echo "$(GREEN)✔ Проверка завершена$(RESET)"

lint-fix:
	@echo "$(CYAN)▶ Исправляем код (ruff --fix)...$(RESET)"
	docker compose exec api ruff check src/ --fix --select E,W,F --ignore E501
	@echo "$(GREEN)✔ Исправлено$(RESET)"

## ─── Очистка ──────────────────────────────────────────────
clean:
	@echo "$(CYAN)▶ Очищаем остановленные контейнеры и неиспользуемые образы...$(RESET)"
	docker compose down --remove-orphans
	docker image prune -f
	@echo "$(GREEN)✔ Очищено$(RESET)"

clean-all:
	@echo "$(YELLOW)⚠ ВНИМАНИЕ: удаляем ВСЕ данные включая volumes!$(RESET)"
	@read -p "Вы уверены? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	docker compose down -v --remove-orphans
	docker image prune -af
	@echo "$(GREEN)✔ Полная очистка завершена$(RESET)"
