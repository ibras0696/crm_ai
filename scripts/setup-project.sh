#!/bin/bash

##############################################################################
# CRM_AI Project Setup Helper
# 
# Этот скрипт помогает правильно запустить проект с secrets.yml
##############################################################################

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_FILE="$PROJECT_ROOT/secrets.yml"
SECRETS_EXAMPLE="$PROJECT_ROOT/secrets.yml.example"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

check_requirements() {
    print_header "Проверка требований"
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker не установлен"
        echo "Установи Docker с https://www.docker.com/products/docker-desktop"
        exit 1
    fi
    print_success "Docker установлен"
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose не установлен"
        exit 1
    fi
    print_success "Docker Compose установлен"
    
    echo ""
}

check_secrets() {
    print_header "Проверка secrets.yml"
    
    if [ ! -f "$SECRETS_FILE" ]; then
        print_warning "secrets.yml не найден"
        
        if [ ! -f "$SECRETS_EXAMPLE" ]; then
            print_error "secrets.yml.example тоже не найден!"
            exit 1
        fi
        
        echo "Копирую secrets.yml.example → secrets.yml..."
        cp "$SECRETS_EXAMPLE" "$SECRETS_FILE"
        print_success "Файл secrets.yml создан"
        
        echo -e "\n${YELLOW}⚠️  ВАЖНО: Отредактируй secrets.yml перед запуском!${NC}"
        echo "Измени значения CHANGE_ME_* на реальные:"
        echo ""
        echo "  • POSTGRES_USER/PASSWORD - учетные данные БД"
        echo "  • SECRET_KEY - минимум 32 символа"
        echo "  • S3_ACCESS_KEY/SECRET_KEY - MinIO учетные данные"
        echo "  • RABBITMQ_USER/PASS - RabbitMQ учетные данные"
        echo "  • JWT_*_SECRET_KEY - JWT ключи для подписания"
        echo ""
        
        read -p "Хочешь отредактировать secrets.yml сейчас? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ${EDITOR:-nano} "$SECRETS_FILE"
        fi
    else
        print_success "secrets.yml найден"
        
        # Check if using defaults
        if grep -q "CHANGE_ME_" "$SECRETS_FILE"; then
            print_warning "secrets.yml содержит значения по умолчанию (CHANGE_ME_*)"
            echo "Убедись, что это значения для разработки, не для production!"
        fi
    fi
    
    echo ""
}

show_status() {
    print_header "Статус контейнеров"
    
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep crm_chechen || true
    
    echo ""
}

start_project() {
    print_header "Запуск проекта"
    
    cd "$PROJECT_ROOT"
    
    echo "Запускаю: docker compose -f docker-compose.yml -f secrets.yml up -d"
    docker compose -f docker-compose.yml -f secrets.yml up -d
    
    echo ""
    print_success "Проект запущен!"
    
    sleep 3
    
    echo "Ожидаю инициализацию сервисов..."
    sleep 5
    
    show_status
}

show_services() {
    print_header "Доступные сервисы"
    
    echo "Frontend:   ${GREEN}http://localhost:5173${NC}"
    echo "API:        ${GREEN}http://localhost:8000${NC}"
    echo "API Docs:   ${GREEN}http://localhost:8000/api/docs${NC}"
    echo ""
    echo "PostgreSQL: localhost:5432"
    echo "Redis:      localhost:6379"
    echo "RabbitMQ:   localhost:5672 (Management: http://localhost:15672)"
    echo "MinIO:      http://localhost:9000"
    echo "Grafana:    http://localhost:3000"
    echo "Prometheus: http://localhost:9090"
    echo ""
}

show_logs() {
    print_header "Просмотр логов"
    
    echo "Frontend логи:"
    echo "  docker logs crm_chechen-frontend-1 -f"
    echo ""
    echo "API логи:"
    echo "  docker logs crm_chechen-api-1 -f"
    echo ""
    echo "Все логи:"
    echo "  docker compose logs -f"
    echo ""
}

stop_project() {
    print_header "Остановка проекта"
    
    cd "$PROJECT_ROOT"
    docker compose -f docker-compose.yml -f secrets.yml down
    
    print_success "Проект остановлен"
}

show_help() {
    cat << EOF
${BLUE}CRM_AI Project Setup Helper${NC}

Использование:
  $0 [команда]

Команды:
  check       - Проверить требования и secrets.yml
  up          - Запустить проект
  down        - Остановить проект
  status      - Показать статус контейнеров
  logs-api    - Показать логи API
  logs-front  - Показать логи Frontend
  logs        - Показать логи всех сервисов
  info        - Показать информацию о сервисах
  help        - Показать эту справку

Примеры:
  $0 check      # Проверить setup
  $0 up         # Запустить проект
  $0 status     # Проверить статус
  $0 logs-api   # Просмотреть логи API
  $0 down       # Остановить проект

EOF
}

main() {
    case "${1:-help}" in
        check)
            check_requirements
            check_secrets
            echo -e "${GREEN}✓ Все проверки пройдены!${NC}\n"
            ;;
        up)
            check_requirements
            check_secrets
            start_project
            show_services
            echo -e "${GREEN}Проект успешно запущен!${NC}\n"
            ;;
        down)
            stop_project
            ;;
        status)
            show_status
            ;;
        logs-api)
            docker logs crm_chechen-api-1 -f --tail 100
            ;;
        logs-front)
            docker logs crm_chechen-frontend-1 -f --tail 100
            ;;
        logs)
            cd "$PROJECT_ROOT"
            docker compose logs -f --tail 50
            ;;
        info)
            show_services
            show_logs
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            echo "Неизвестная команда: $1"
            echo "Используй '$0 help' для справки"
            exit 1
            ;;
    esac
}

main "$@"
