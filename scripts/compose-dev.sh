#!/usr/bin/env sh
set -eu

BASE_FILE="docker-compose.yml"
SECRETS_FILE="${SECRETS_FILE:-secrets.yml}"

if [ -f "$SECRETS_FILE" ]; then
  exec docker compose --profile dev -f "$BASE_FILE" -f "$SECRETS_FILE" "$@"
fi

echo "[WARN] $SECRETS_FILE not found. Starting without secrets override." >&2
exec docker compose --profile dev -f "$BASE_FILE" "$@"
