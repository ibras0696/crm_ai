# Chat Test Run Guide

Updated: 2026-05-26
Branch: `mess_update`

## Frontend
Run from `frontend`:

```bash
npm install
npm run build
```

Expected: successful TypeScript + Vite build.

## Backend (local Python)
Recommended Python version: 3.12 or 3.13.

Run from repo root:

```bash
py -3.12 -m pip install -r backend/requirements.txt
py -3.12 -m pytest backend/tests/integration/test_chat_api.py -k employee_chat_owner_can_manage_members_and_delete_chat
```

## Backend (Docker)
Requirements:
- Docker Desktop daemon must be running.

Run from repo root:

```bash
docker compose up -d db
docker compose run --rm --no-deps api python -m pytest tests/integration/test_chat_api.py -k employee_chat_owner_can_manage_members_and_delete_chat
```

Optional cleanup:

```bash
docker compose down
```
