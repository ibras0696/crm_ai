#!/bin/bash
# ============================================================
# Резервное копирование PostgreSQL + MinIO
# Использование: ./scripts/backup.sh
# Переменные из .env или окружения
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="${DB_CONTAINER:-crm_chechen-db-1}"
POSTGRES_USER="${POSTGRES_USER:-crm_user}"
POSTGRES_DB="${POSTGRES_DB:-crm_db}"
MINIO_CONTAINER="${MINIO_CONTAINER:-crm_chechen-minio-1}"

mkdir -p "$BACKUP_DIR"

echo "=== Бэкап PostgreSQL ==="
docker exec "$DB_CONTAINER" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom \
  > "$BACKUP_DIR/db_${TIMESTAMP}.dump"
echo "  -> $BACKUP_DIR/db_${TIMESTAMP}.dump"

echo "=== Бэкап MinIO данных ==="
docker exec "$MINIO_CONTAINER" mc alias set local http://localhost:9000 "${S3_ACCESS_KEY:-minioadmin}" "${S3_SECRET_KEY:-minioadmin}" 2>/dev/null || true
docker cp "$MINIO_CONTAINER:/data" "$BACKUP_DIR/minio_${TIMESTAMP}" 2>/dev/null || echo "  -> MinIO бэкап пропущен (нет данных или контейнер не найден)"

echo "=== Удаление бэкапов старше 30 дней ==="
find "$BACKUP_DIR" -name "db_*.dump" -mtime +30 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "minio_*" -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

echo "=== Бэкап завершён: $TIMESTAMP ==="
