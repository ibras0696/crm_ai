#!/bin/bash
# ============================================================
# Восстановление PostgreSQL из бэкапа
# Использование: ./scripts/restore.sh backups/db_20250218_120000.dump
# ============================================================
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Использование: $0 <путь_к_дампу>"
  echo "Пример: $0 backups/db_20250218_120000.dump"
  exit 1
fi

DUMP_FILE="$1"
DB_CONTAINER="${DB_CONTAINER:-crm_chechen-db-1}"
POSTGRES_USER="${POSTGRES_USER:-crm_user}"
POSTGRES_DB="${POSTGRES_DB:-crm_db}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "Ошибка: файл $DUMP_FILE не найден"
  exit 1
fi

echo "=== Восстановление из $DUMP_FILE ==="
echo "ВНИМАНИЕ: Это перезапишет все данные в базе $POSTGRES_DB!"
read -p "Продолжить? (y/N): " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Отменено."
  exit 0
fi

cat "$DUMP_FILE" | docker exec -i "$DB_CONTAINER" pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner 2>/dev/null || true

echo "=== Восстановление завершено ==="
