#!/usr/bin/env sh
set -eu

# Usage:
#   ./scripts/generate_prod_secrets.sh your-domain.com > .env.prod.generated
# Then copy values into secrets.yml (or your secret manager).

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

rand_b64() {
  openssl rand -base64 "${1:-48}" | tr -d '\n'
}

rand_hex() {
  openssl rand -hex "${1:-32}"
}

DB_USER="crm_prod"
DB_PASS="$(rand_b64 36)"
DB_NAME="crm_db"
RABBIT_USER="crm_rabbit"
RABBIT_PASS="$(rand_b64 36)"
S3_ACCESS_KEY="crmminio"
S3_SECRET_KEY="$(rand_hex 32)"
SECRET_KEY="$(rand_b64 64)"
JWT_USER_SECRET_KEY="$(rand_b64 64)"
JWT_SUPERADMIN_SECRET_KEY="$(rand_b64 64)"
GRAFANA_USER="grafana_admin"
GRAFANA_PASSWORD="$(rand_b64 36)"

cat <<EOF
# Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Review before applying.

POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=${DB_NAME}
DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@db:5432/${DB_NAME}
DATABASE_URL_SYNC=postgresql+psycopg2://${DB_USER}:${DB_PASS}@db:5432/${DB_NAME}

RABBITMQ_USER=${RABBIT_USER}
RABBITMQ_PASS=${RABBIT_PASS}
RABBITMQ_URL=amqp://${RABBIT_USER}:${RABBIT_PASS}@rabbitmq:5672/

S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_BUCKET=crm-files

SECRET_KEY=${SECRET_KEY}
JWT_USER_SECRET_KEY=${JWT_USER_SECRET_KEY}
JWT_SUPERADMIN_SECRET_KEY=${JWT_SUPERADMIN_SECRET_KEY}
JWT_ISSUER=crm-platform
JWT_AUDIENCE_USER=crm-api-users
JWT_AUDIENCE_SUPERADMIN=crm-api-superadmin
DOMAIN=${DOMAIN}
FRONTEND_URL=https://${DOMAIN}
CORS_ORIGINS=["https://${DOMAIN}"]
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=lax
AUTH_COOKIE_DOMAIN=${DOMAIN}
AUTH_COOKIE_PATH=/
SUPERADMIN_ACCESS_COOKIE_NAME=sa_access_token

GRAFANA_USER=${GRAFANA_USER}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
EOF
