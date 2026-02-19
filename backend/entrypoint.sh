#!/bin/sh
set -e
echo "[entrypoint] Starting uvicorn (migrations run inside app startup)..."
exec uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
