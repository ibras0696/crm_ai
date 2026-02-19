# Assumptions

## General
- This is a monorepo with `backend/` and `frontend/` directories.
- Development environment uses Docker Compose for all services.
- Production deployment details (K8s, CI/CD pipelines) are deferred to Sprint 12.

## Backend
- Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic.
- PostgreSQL 16 with pgvector extension.
- Redis 7 for caching and Celery broker.
- MinIO as S3-compatible object storage.
- Celery for background jobs (broker=Redis, backend=Redis).
- JWT auth with access (30 min) + refresh (7 days) tokens.
- Passwords hashed with bcrypt via passlib.
- All API responses follow a unified envelope: `{ "ok": bool, "data": ..., "error": ... }`.
- Email sending is stubbed (console backend) until SMTP is configured.
- Billing/payments are modeled but payment provider integration is deferred.
- AI agent uses OpenAI-compatible API; key provided via env var.

## Frontend
- React 18 + TypeScript + Vite.
- TailwindCSS + shadcn/ui for components.
- TanStack Query for data fetching.
- React Router v6 for routing.

## Security
- CORS: configurable origins, default `http://localhost:5173`.
- Rate limiting via slowapi (in-memory for dev, Redis for prod).
- Refresh tokens stored in DB, rotated on use.

## Database
- All tables have `org_id` foreign key (except `organizations` itself and global tables).
- Soft delete is NOT used by default; hard delete + audit log instead.
- UUIDs as primary keys everywhere.
- Timestamps in UTC, stored as `TIMESTAMP WITH TIME ZONE`.

## RBAC
- Five roles: owner, admin, manager, employee, readonly.
- Permissions checked at service layer via dependency injection.
- Object-level permissions implemented via `access_rules` table (per resource type/id, per role/user).
- OWNER/ADMIN always have full access; other roles checked against access rules.
- Default behavior (no rules): allow all — backwards compatible.

## Access Control
- Resource types: `table`, `knowledge`, `ai`, `schedule`, `reports`.
- Permissions: `can_read`, `can_write`, `can_delete`.
- Rules can target a specific role OR a specific user_id.
- Rules can be type-wide (resource_id=null) or per-resource.

## AI Integration
- AI agent uses OpenAI-compatible API (Grok/xAI by default).
- Organization context (KB pages + table schemas + sample records) auto-injected into system prompt.
- Context capped at 4000 chars to save tokens.
- Frontend toggle to enable/disable context injection.

## Billing
- Plans stored in DB (`plans` table): free, team, business.
- YooKassa payment gateway integration (create payment + webhook).
- Webhook updates `subscriptions` table on successful payment.
- Usage tracking: members, tables, records, files, storage.

## Production Deployment
- `docker-compose.prod.yml` with nginx reverse proxy, SSL via certbot.
- Prometheus + Grafana for monitoring.
- RabbitMQ for production message broker.
- API runs with 4 uvicorn workers behind nginx.
- Frontend built as static files served by nginx.
- Alembic migrations run automatically on deploy (`alembic upgrade head`).

## CI/CD
- GitHub Actions: backend lint (ruff) + tests, frontend type check + build.
- Docker image build on main branch.
- CD via SSH deploy with auto-rollback on container health check failure.
- Health checks: container status + `/api/health` endpoint.

## Testing
- pytest-asyncio for async tests.
- httpx.AsyncClient for API tests.
- Testcontainers or separate test DB via Docker Compose.
- Coverage target: 60% for Sprint 1, increasing each sprint.
