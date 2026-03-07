# 🏃 Sprint Plan - CRM Platform Improvements

**Дата создания:** 27 февраля 2026  
**Общая длительность:** 8 спринтов (16 недель)  
**Цель:** Довести проект до production-ready состояния

---

## 📊 Общая Статистика

| Категория | Задач | Story Points | Приоритет |
|-----------|-------|--------------|-----------|
| Критичные | 15 | 89 | 🔴 Высокий |
| Высокий приоритет | 18 | 126 | 🟠 Высокий |
| Средний приоритет | 22 | 110 | 🟡 Средний |
| Низкий приоритет | 12 | 48 | 🟢 Низкий |
| **ИТОГО** | **67** | **373** | - |

---

## 🚀 Sprint 0: Запуск Проекта (Текущий)
**Длительность:** 2 дня  
**Цель:** Запустить проект локально  
**Story Points:** 13

### Задачи

#### TASK-001: Настроить секреты для dev окружения 🔴
**Story Points:** 5  
**Приоритет:** Критичный  
**Описание:** Создать secrets.yml с реальными значениями для запуска проекта

**Действия:**
```bash
# 1. Создать secrets.yml
cp secrets.yml.example secrets.yml

# 2. Сгенерировать секретные ключи
python -c "import secrets; print(secrets.token_urlsafe(32))"  # SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(32))"  # JWT_USER_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(32))"  # JWT_SUPERADMIN_SECRET_KEY

# 3. Заполнить secrets.yml
```

**Критерии приемки:**
- [ ] secrets.yml создан
- [ ] Все CHANGE_ME_* заменены на реальные значения
- [ ] secrets.yml в .gitignore
- [ ] Проект запускается без ошибок

---

#### TASK-002: Запустить все сервисы 🔴
**Story Points:** 3  
**Приоритет:** Критичный  
**Описание:** Запустить Docker Compose с новыми секретами

**Действия:**
```bash
# 1. Остановить текущие контейнеры
docker compose --profile dev -f docker-compose.yml down

# 2. Запустить с secrets.yml
docker compose --profile dev -f docker-compose.yml -f secrets.yml up -d --build

# 3. Проверить статус
docker compose --profile dev ps
docker logs crm_chechen-bootstrap-1
docker logs crm_chechen-api-1
docker logs crm_chechen-frontend-1
```

**Критерии приемки:**
- [ ] Bootstrap успешно выполнен
- [ ] API запущен и отвечает на /api/health
- [ ] Frontend доступен на http://localhost:5173
- [ ] Celery workers запущены
- [ ] Все healthchecks green

---

#### TASK-003: Проверить базовую функциональность 🔴
**Story Points:** 5  
**Приоритет:** Критичный  
**Описание:** Smoke test основных функций

**Действия:**
1. Открыть http://localhost:5173
2. Зарегистрировать пользователя
3. Создать организацию
4. Создать таблицу
5. Добавить запись
6. Проверить API docs http://localhost:8000/api/docs

**Критерии приемки:**
- [ ] Регистрация работает
- [ ] Создание организации работает
- [ ] CRUD операции с таблицами работают
- [ ] API docs доступны
- [ ] Нет критичных ошибок в логах

---

## 🔥 Sprint 1: Критичные Исправления
**Длительность:** 2 недели  
**Цель:** Исправить блокеры для production  
**Story Points:** 76

### Database & Performance

#### TASK-101: Добавить критичные индексы 🔴
**Story Points:** 8  
**Приоритет:** Критичный  
**Файлы:** `backend/alembic/versions/`

**Индексы для добавления:**
```sql
-- Tables module
CREATE INDEX CONCURRENTLY idx_tables_org_created 
ON tables (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_tables_org_archived 
ON tables (org_id, is_archived) WHERE is_archived = false;

-- Table records
CREATE INDEX CONCURRENTLY idx_records_table_position 
ON table_records (table_id, position);

CREATE INDEX CONCURRENTLY idx_records_org_created 
ON table_records (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_records_data_gin 
ON table_records USING GIN (data);

-- Auth module
CREATE INDEX CONCURRENTLY idx_refresh_tokens_user_active 
ON refresh_tokens (user_id, is_revoked) WHERE is_revoked = false;

-- Org module
CREATE INDEX CONCURRENTLY idx_memberships_org_role 
ON memberships (org_id, role);

CREATE INDEX CONCURRENTLY idx_invites_email_status 
ON invites (email, status);

-- AI module
CREATE INDEX CONCURRENTLY idx_ai_chats_org_created 
ON ai_chats (org_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_ai_messages_chat_created 
ON ai_messages (chat_id, created_at);
```

**Критерии приемки:**
- [ ] Миграция создана
- [ ] Индексы добавлены через CONCURRENTLY
- [ ] Query performance улучшен (измерить EXPLAIN ANALYZE)
- [ ] Нет downtime при применении

---

#### TASK-102: Исправить N+1 query проблемы 🔴
**Story Points:** 13  
**Приоритет:** Критичный  
**Файлы:** 
- `backend/src/modules/org/models.py`
- `backend/src/modules/auth/models.py`
- `backend/src/modules/*/repository.py`

**Изменения:**

1. **org/models.py:**
```python
class Organization(BaseDBModel):
    # Было: lazy="selectin" - загружает ВСЕ memberships
    # Стало: lazy="noload" + explicit loading где нужно
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="organization", 
        lazy="noload"  # ✅ Не загружать автоматически
    )
    subscription: Mapped["Subscription | None"] = relationship(
        back_populates="organization", 
        uselist=False, 
        lazy="noload"  # ✅ Explicit loading
    )
```

2. **org/repository.py:**
```python
async def get_org_with_members(org_id: UUID) -> Organization:
    stmt = (
        select(Organization)
        .where(Organization.id == org_id)
        .options(selectinload(Organization.memberships))  # ✅ Explicit
    )
    result = await session.execute(stmt)
    return result.scalar_one()
```

**Критерии приемки:**
- [ ] Все `lazy="selectin"` заменены на `lazy="noload"`
- [ ] Добавлены explicit `selectinload()` где нужно
- [ ] SQL queries уменьшились (проверить через logging)
- [ ] Тесты проходят

---

#### TASK-103: Увеличить DB connection pool 🔴
**Story Points:** 3  
**Приоритет:** Критичный  
**Файлы:** `backend/src/config.py`, `backend/src/infrastructure/database.py`

**Изменения:**
```python
# config.py
DB_POOL_SIZE: int = 50  # Было: 20
DB_MAX_OVERFLOW: int = 20  # Было: 10
DB_POOL_TIMEOUT_S: float = 10.0  # Было: 30.0 (быстрее fail)

# database.py
engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT_S,
    pool_recycle=settings.DB_POOL_RECYCLE_S,
    connect_args={
        "server_settings": {
            "statement_timeout": "30000",  # ✅ 30s timeout
            "idle_in_transaction_session_timeout": "60000"  # ✅ 60s
        }
    }
)
```

**Критерии приемки:**
- [ ] Pool size увеличен
- [ ] Statement timeout добавлен
- [ ] Нет connection exhaustion под нагрузкой
- [ ] Мониторинг pool usage добавлен

---

#### TASK-104: Добавить Redis connection pooling 🔴
**Story Points:** 8  
**Приоритет:** Критичный  
**Файлы:** `backend/src/infrastructure/redis_client.py`

**Изменения:**
```python
# redis_client.py
class RedisClient:
    def __init__(self, url: str):
        # ✅ Connection pool
        self._pool = redis.ConnectionPool.from_url(
            url,
            decode_responses=True,
            max_connections=50,  # Pool size
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30
        )
        self._redis = redis.Redis(connection_pool=self._pool)
    
    async def close(self):
        await self._pool.disconnect()
```

**Критерии приемки:**
- [ ] Connection pool реализован
- [ ] Health checks работают
- [ ] Нет connection leaks
- [ ] Performance улучшен

---

### Backup & Reliability

#### TASK-105: Настроить automated backups 🔴
**Story Points:** 13  
**Приоритет:** Критичный  
**Файлы:** `scripts/backup.sh`, `docker-compose.yml`

**Действия:**

1. **Улучшить backup.sh:**
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# PostgreSQL backup
docker exec crm_chechen-db-1 pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# MinIO backup
docker exec crm_chechen-minio-1 mc mirror /data "$BACKUP_DIR/minio_$DATE/"

# Cleanup old backups
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "minio_*" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} +

# Upload to S3 (optional)
# aws s3 sync "$BACKUP_DIR" s3://my-backups/crm/
```

2. **Добавить cron job:**
```yaml
# docker-compose.yml
services:
  backup:
    image: alpine:latest
    volumes:
      - ./scripts:/scripts
      - backup_data:/backups
    command: crond -f
    environment:
      - BACKUP_SCHEDULE=0 2 * * *  # 2 AM daily
```

**Критерии приемки:**
- [ ] Ежедневные backups настроены
- [ ] Retention policy работает
- [ ] Restore протестирован
- [ ] Мониторинг backup status

---

#### TASK-106: Добавить health monitoring 🔴
**Story Points:** 8  
**Приоритет:** Критичный  
**Файлы:** `monitoring/alerts/`, `backend/src/infrastructure/metrics_custom.py`

**Действия:**

1. **Prometheus alerts:**
```yaml
# monitoring/alerts/critical.yml
groups:
  - name: critical
    rules:
      - alert: APIDown
        expr: up{job="api"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "API is down"
      
      - alert: DatabaseDown
        expr: up{job="db"} == 0
        for: 1m
        labels:
          severity: critical
      
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
      
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, http_request_duration_seconds_bucket) > 1
        for: 10m
        labels:
          severity: warning
```

2. **Custom metrics:**
```python
# metrics_custom.py
from prometheus_client import Gauge, Counter

db_pool_size = Gauge('db_pool_size', 'Database connection pool size')
db_pool_available = Gauge('db_pool_available', 'Available DB connections')
redis_connections = Gauge('redis_connections', 'Redis connections')
celery_queue_length = Gauge('celery_queue_length', 'Celery queue length', ['queue'])
```

**Критерии приемки:**
- [ ] Alerts настроены
- [ ] Custom metrics добавлены
- [ ] Grafana dashboards обновлены
- [ ] Alertmanager настроен (опционально)

---

### Security

#### TASK-107: Добавить CSRF protection 🔴
**Story Points:** 5  
**Приоритет:** Критичный  
**Файлы:** `backend/src/middleware/csrf.py`, `backend/src/main.py`

**Реализация:**
```python
# middleware/csrf.py
from starlette.middleware.base import BaseHTTPMiddleware
import secrets

class CSRFMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method in ["POST", "PUT", "PATCH", "DELETE"]:
            token = request.headers.get("X-CSRF-Token")
            cookie_token = request.cookies.get("csrf_token")
            
            if not token or token != cookie_token:
                return JSONResponse(
                    {"detail": "CSRF token missing or invalid"},
                    status_code=403
                )
        
        response = await call_next(request)
        
        # Set CSRF token cookie
        if not request.cookies.get("csrf_token"):
            csrf_token = secrets.token_urlsafe(32)
            response.set_cookie(
                "csrf_token",
                csrf_token,
                httponly=False,  # JS needs to read it
                samesite="strict"
            )
        
        return response
```

**Критерии приемки:**
- [ ] CSRF middleware добавлен
- [ ] Frontend отправляет CSRF token
- [ ] Тесты проходят
- [ ] Документация обновлена

---

#### TASK-108: Улучшить secrets management 🔴
**Story Points:** 8  
**Приоритет:** Критичный  
**Файлы:** `docker-compose.yml`, `scripts/`

**Действия:**

1. **Использовать Docker secrets:**
```yaml
# docker-compose.prod.yml
secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt

services:
  api:
    secrets:
      - db_password
      - jwt_secret
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db_password
      JWT_SECRET_FILE: /run/secrets/jwt_secret
```

2. **Обновить config.py:**
```python
def _read_secret_file(path: str) -> str:
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return ""

class Settings(BaseSettings):
    DATABASE_PASSWORD: str = ""
    DATABASE_PASSWORD_FILE: str = ""
    
    @model_validator(mode="after")
    def load_secrets_from_files(self):
        if self.DATABASE_PASSWORD_FILE:
            self.DATABASE_PASSWORD = _read_secret_file(self.DATABASE_PASSWORD_FILE)
        return self
```

**Критерии приемки:**
- [ ] Docker secrets настроены для prod
- [ ] Секреты не видны в `docker inspect`
- [ ] Документация обновлена
- [ ] Migration guide создан

---

### Code Quality

#### TASK-109: Добавить retry logic для Celery 🔴
**Story Points:** 8  
**Приоритет:** Критичный  
**Файлы:** `backend/src/modules/*/tasks.py`

**Изменения:**
```python
# notifications/tasks.py
from celery import Task
from celery.exceptions import MaxRetriesExceededError

class BaseTaskWithRetry(Task):
    autoretry_for = (Exception,)
    retry_kwargs = {'max_retries': 3}
    retry_backoff = True
    retry_backoff_max = 600
    retry_jitter = True

@celery.task(base=BaseTaskWithRetry, bind=True)
def send_email(self, to: str, subject: str, body: str):
    try:
        # Send email logic
        ...
    except SMTPException as exc:
        # Retry with exponential backoff
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))
    except MaxRetriesExceededError:
        # Log to dead letter queue
        logger.error(f"Failed to send email after max retries: {to}")
        # Store in DB for manual retry
        await store_failed_task(...)
```

**Критерии приемки:**
- [ ] Retry logic добавлен для всех tasks
- [ ] Dead letter queue настроена
- [ ] Мониторинг failed tasks
- [ ] Тесты проходят

---

## 🟠 Sprint 2: Высокий Приоритет
**Длительность:** 2 недели  
**Цель:** Performance & Scalability  
**Story Points:** 63

### Caching Layer

#### TASK-201: Добавить Redis caching для read-heavy endpoints 🟠
**Story Points:** 13  
**Приоритет:** Высокий  
**Файлы:** `backend/src/infrastructure/cache.py`, `backend/src/modules/*/service.py`

**Реализация:**
```python
# infrastructure/cache.py
from functools import wraps
import json
import hashlib

class CacheService:
    def __init__(self, redis_client: RedisClient):
        self.redis = redis_client
    
    def cache(self, ttl: int = 300, key_prefix: str = ""):
        def decorator(func):
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # Generate cache key
                cache_key = self._generate_key(key_prefix, func.__name__, args, kwargs)
                
                # Try to get from cache
                cached = await self.redis.get(cache_key)
                if cached:
                    return json.loads(cached)
                
                # Execute function
                result = await func(*args, **kwargs)
                
                # Store in cache
                await self.redis.setex(
                    cache_key,
                    ttl,
                    json.dumps(result, default=str)
                )
                
                return result
            return wrapper
        return decorator
    
    async def invalidate(self, pattern: str):
        keys = await self.redis.keys(pattern)
        if keys:
            await self.redis.delete(*keys)

# Usage in service
class OrgService:
    @cache(ttl=300, key_prefix="org")
    async def get_org_tables(self, org_id: UUID) -> list[Table]:
        return await self.repo.get_tables(org_id)
    
    async def create_table(self, org_id: UUID, data: dict):
        table = await self.repo.create(data)
        # Invalidate cache
        await cache_service.invalidate(f"org:{org_id}:*")
        return table
```

**Endpoints для кэширования:**
- `GET /api/v1/tables/` (TTL: 5 min)
- `GET /api/v1/orgs/current` (TTL: 10 min)
- `GET /api/v1/knowledge/pages` (TTL: 5 min)
- `GET /api/v1/reports/summary` (TTL: 15 min)

**Критерии приемки:**
- [ ] Cache service реализован
- [ ] Cache invalidation работает
- [ ] Response time улучшен на 50%+
- [ ] Cache hit rate > 70%
- [ ] Метрики добавлены

---

#### TASK-202: Оптимизировать Celery workers 🟠
**Story Points:** 8  
**Приоритет:** Высокий  
**Файлы:** `backend/src/infrastructure/celery_app.py`, `docker-compose.yml`

**Изменения:**
```python
# celery_app.py
celery.conf.update(
    worker_prefetch_multiplier=4,  # Было: 1
    task_acks_late=True,
    worker_max_tasks_per_child=1000,  # Restart worker after 1000 tasks
    task_time_limit=300,  # 5 min hard limit
    task_soft_time_limit=240,  # 4 min soft limit
    
    # Priority queues
    task_routes={
        'send_critical_email': {'queue': 'high', 'priority': 10},
        'send_notification': {'queue': 'default', 'priority': 5},
        'send_bulk_email': {'queue': 'low', 'priority': 1},
    },
    
    # Result backend settings
    result_expires=3600,  # 1 hour
    result_backend_transport_options={
        'master_name': 'mymaster',
        'visibility_timeout': 3600,
    }
)
```

**Docker Compose:**
```yaml
# Отдельные workers для разных очередей
celery_worker_high:
  command: celery -A src.infrastructure.celery_app worker -Q high -c 4
  
celery_worker_default:
  command: celery -A src.infrastructure.celery_app worker -Q default -c 8
  
celery_worker_low:
  command: celery -A src.infrastructure.celery_app worker -Q low -c 2
```

**Критерии приемки:**
- [ ] Prefetch увеличен
- [ ] Priority queues настроены
- [ ] Throughput увеличен на 300%+
- [ ] Мониторинг queue length

---

#### TASK-203: Добавить pagination limits 🟠
**Story Points:** 5  
**Приоритет:** Высокий  
**Файлы:** `backend/src/common/schemas.py`, `backend/src/modules/*/routes.py`

**Реализация:**
```python
# common/schemas.py
from pydantic import BaseModel, Field, field_validator

class PaginationParams(BaseModel):
    skip: int = Field(0, ge=0, description="Number of items to skip")
    limit: int = Field(100, ge=1, le=1000, description="Max items to return")
    
    @field_validator("limit")
    @classmethod
    def validate_limit(cls, v: int) -> int:
        return min(v, 1000)  # Hard limit

class PaginatedResponse(BaseModel):
    items: list
    total: int
    skip: int
    limit: int
    has_more: bool
    
    @classmethod
    def create(cls, items: list, total: int, skip: int, limit: int):
        return cls(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
            has_more=(skip + len(items)) < total
        )

# Usage
@router.get("/tables/", response_model=PaginatedResponse)
async def list_tables(
    pagination: PaginationParams = Depends(),
    session: AsyncSession = Depends(get_async_session)
):
    items, total = await service.get_tables(
        skip=pagination.skip,
        limit=pagination.limit
    )
    return PaginatedResponse.create(items, total, pagination.skip, pagination.limit)
```

**Критерии приемки:**
- [ ] Pagination limits добавлены везде
- [ ] Consistent response format
- [ ] Cursor-based pagination для больших таблиц
- [ ] Документация обновлена

---

#### TASK-204: Добавить rate limiting per organization 🟠
**Story Points:** 8  
**Приоритет:** Высокий  
**Файлы:** `backend/src/middleware/rate_limit.py`

**Реализация:**
```python
# middleware/rate_limit.py
from slowapi import Limiter
from slowapi.util import get_remote_address

def get_org_id(request: Request) -> str:
    # Get from JWT token
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        payload = decode_jwt(token)
        return payload.get("org_id", "anonymous")
    return "anonymous"

limiter = Limiter(
    key_func=get_org_id,
    storage_uri=settings.REDIS_URL,
    default_limits=["1000/hour", "100/minute"]
)

# Per-plan limits
PLAN_LIMITS = {
    PlanTier.FREE: "100/hour",
    PlanTier.TEAM: "1000/hour",
    PlanTier.BUSINESS: "10000/hour"
}

@router.post("/tables/")
@limiter.limit(lambda: PLAN_LIMITS.get(current_org.plan, "100/hour"))
async def create_table(...):
    ...
```

**Критерии приемки:**
- [ ] Per-org rate limiting работает
- [ ] Per-plan limits настроены
- [ ] Метрики rate limit hits
- [ ] Graceful error messages

---

### Database Optimization

#### TASK-205: Добавить soft deletes 🟠
**Story Points:** 8  
**Приоритет:** Высокий  
**Файлы:** `backend/src/common/base_model.py`, `backend/src/modules/*/models.py`

**Реализация:**
```python
# common/base_model.py
class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True
    )
    
    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None
    
    def soft_delete(self):
        self.deleted_at = datetime.now(timezone.utc)
    
    def restore(self):
        self.deleted_at = None

class BaseDBModel(Base, SoftDeleteMixin):
    __abstract__ = True
    # ... existing fields

# Repository pattern
class BaseRepository:
    async def get_active(self, **filters):
        stmt = select(self.model).where(
            self.model.deleted_at.is_(None),
            *[getattr(self.model, k) == v for k, v in filters.items()]
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()
    
    async def soft_delete(self, id: UUID):
        obj = await self.get(id)
        obj.soft_delete()
        await self.session.commit()
```

**Критерии приемки:**
- [ ] Soft delete добавлен для всех моделей
- [ ] Queries фильтруют deleted
- [ ] Restore функция работает
- [ ] Cleanup job для старых deleted

---

#### TASK-206: Добавить query timeout protection 🟠
**Story Points:** 5  
**Приоритет:** Высокий  
**Файлы:** `backend/src/infrastructure/database.py`

**Реализация:**
```python
# database.py
from contextlib import asynccontextmanager

@asynccontextmanager
async def query_timeout(session: AsyncSession, timeout_ms: int = 30000):
    """Context manager для query timeout"""
    await session.execute(text(f"SET LOCAL statement_timeout = {timeout_ms}"))
    try:
        yield
    finally:
        await session.execute(text("RESET statement_timeout"))

# Usage
async def get_large_dataset():
    async with query_timeout(session, timeout_ms=5000):
        result = await session.execute(heavy_query)
        return result.scalars().all()
```

**Критерии приемки:**
- [ ] Query timeout настроен
- [ ] Long queries отменяются
- [ ] Метрики timeout errors
- [ ] Graceful error handling

---

### Monitoring & Observability

#### TASK-207: Добавить APM (Application Performance Monitoring) 🟠
**Story Points:** 13  
**Приоритет:** Высокий  
**Файлы:** `backend/src/infrastructure/tracing.py`

**Реализация (OpenTelemetry):**
```python
# infrastructure/tracing.py
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor

def setup_tracing(app: FastAPI):
    # Setup tracer
    trace.set_tracer_provider(TracerProvider())
    tracer = trace.get_tracer(__name__)
    
    # OTLP exporter (to Jaeger/Tempo)
    otlp_exporter = OTLPSpanExporter(
        endpoint="http://jaeger:4317",
        insecure=True
    )
    
    span_processor = BatchSpanProcessor(otlp_exporter)
    trace.get_tracer_provider().add_span_processor(span_processor)
    
    # Auto-instrument FastAPI
    FastAPIInstrumentor.instrument_app(app)
    
    # Auto-instrument SQLAlchemy
    SQLAlchemyInstrumentor().instrument(
        engine=engine.sync_engine,
        service="crm-db"
    )

# Custom spans
@tracer.start_as_current_span("create_table")
async def create_table(data: dict):
    span = trace.get_current_span()
    span.set_attribute("table.name", data["name"])
    ...
```

**Docker Compose:**
```yaml
jaeger:
  image: jaegertracing/all-in-one:latest
  ports:
    - "16686:16686"  # UI
    - "4317:4317"    # OTLP gRPC
```

**Критерии приемки:**
- [ ] OpenTelemetry настроен
- [ ] Traces собираются
- [ ] Jaeger UI доступен
- [ ] Slow queries видны в traces

---

#### TASK-208: Настроить log aggregation 🟠
**Story Points:** 8  
**Приоритет:** Высокий  
**Файлы:** `docker-compose.yml`, `monitoring/loki/`

**Реализация (Loki):**
```yaml
# docker-compose.yml
loki:
  image: grafana/loki:latest
  ports:
    - "3100:3100"
  volumes:
    - ./monitoring/loki/loki-config.yml:/etc/loki/local-config.yaml
    - loki_data:/loki

promtail:
  image: grafana/promtail:latest
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - ./monitoring/promtail/promtail-config.yml:/etc/promtail/config.yml
  command: -config.file=/etc/promtail/config.yml
```

**Критерии приемки:**
- [ ] Loki собирает логи
- [ ] Grafana показывает логи
- [ ] Log search работает
- [ ] Retention настроен

---

## 🟡 Sprint 3: Средний Приоритет
**Длительность:** 2 недели  
**Цель:** Scalability & Reliability  
**Story Points:** 55

### High Availability

#### TASK-301: PostgreSQL Streaming Replication 🟡
**Story Points:** 13  
**Приоритет:** Средний  
**Файлы:** `docker-compose.prod.yml`, `scripts/`

**Реализация:**
```yaml
# docker-compose.prod.yml
db_primary:
  image: pgvector/pgvector:pg16
  environment:
    POSTGRES_REPLICATION_MODE: master
    POSTGRES_REPLICATION_USER: replicator
    POSTGRES_REPLICATION_PASSWORD: repl_password

db_replica:
  image: pgvector/pgvector:pg16
  environment:
    POSTGRES_REPLICATION_MODE: slave
    POSTGRES_MASTER_HOST: db_primary
    POSTGRES_MASTER_PORT: 5432
    POSTGRES_REPLICATION_USER: replicator
    POSTGRES_REPLICATION_PASSWORD: repl_password
```

**Критерии приемки:**
- [ ] Replication настроена
- [ ] Failover протестирован
- [ ] Read queries идут на replica
- [ ] Monitoring replication lag

---

#### TASK-302: Redis Sentinel для HA 🟡
**Story Points:** 13  
**Приоритет:** Средний  
**Файлы:** `docker-compose.prod.yml`, `backend/src/infrastructure/redis_client.py`

**Реализация:**
```yaml
redis_master:
  image: redis:7-alpine
  command: redis-server --appendonly yes

redis_replica:
  image: redis:7-alpine
  command: redis-server --slaveof redis_master 6379

redis_sentinel:
  image: redis:7-alpine
  command: redis-sentinel /etc/redis/sentinel.conf
  volumes:
    - ./monitoring/redis/sentinel.conf:/etc/redis/sentinel.conf
```

**Критерии приемки:**
- [ ] Sentinel настроен
- [ ] Automatic failover работает
- [ ] Client reconnect работает
- [ ] Monitoring sentinel status

---

#### TASK-303: RabbitMQ Cluster 🟡
**Story Points:** 13  
**Приоритет:** Средний  
**Файлы:** `docker-compose.prod.yml`

**Реализация:**
```yaml
rabbitmq_1:
  image: rabbitmq:3.13-management-alpine
  environment:
    RABBITMQ_ERLANG_COOKIE: secret_cookie
    RABBITMQ_DEFAULT_USER: admin
    RABBITMQ_DEFAULT_PASS: password

rabbitmq_2:
  image: rabbitmq:3.13-management-alpine
  environment:
    RABBITMQ_ERLANG_COOKIE: secret_cookie
  depends_on:
    - rabbitmq_1
  command: >
    bash -c "rabbitmq-server & sleep 10 &&
    rabbitmqctl stop_app &&
    rabbitmqctl join_cluster rabbit@rabbitmq_1 &&
    rabbitmqctl start_app"
```

**Критерии приемки:**
- [ ] Cluster настроен
- [ ] Mirrored queues работают
- [ ] Failover протестирован
- [ ] Monitoring cluster status

---

### Database Partitioning

#### TASK-304: Партиционирование table_records 🟡
**Story Points:** 13  
**Приоритет:** Средний  
**Файлы:** `backend/alembic/versions/`

**Реализация:**
```sql
-- Партиционирование по created_at (monthly)
CREATE TABLE table_records_partitioned (
    LIKE table_records INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Создать партиции
CREATE TABLE table_records_2026_01 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE table_records_2026_02 PARTITION OF table_records_partitioned
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Автоматическое создание партиций
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
    partition_date date;
    partition_name text;
BEGIN
    partition_date := date_trunc('month', CURRENT_DATE + interval '1 month');
    partition_name := 'table_records_' || to_char(partition_date, 'YYYY_MM');
    
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF table_records_partitioned
         FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        partition_date,
        partition_date + interval '1 month'
    );
END;
$$ LANGUAGE plpgsql;
```

**Критерии приемки:**
- [ ] Партиционирование работает
- [ ] Auto-create партиций
- [ ] Query performance улучшен
- [ ] Старые партиции архивируются

---

#### TASK-305: Архивирование старых данных 🟡
**Story Points:** 8  
**Приоритет:** Средний  
**Файлы:** `backend/src/modules/*/tasks.py`

**Реализация:**
```python
# Celery task для архивирования
@celery.task
def archive_old_records():
    """Archive records older than 2 years"""
    cutoff_date = datetime.now() - timedelta(days=730)
    
    # Move to archive table
    with sync_session() as session:
        session.execute(text("""
            INSERT INTO table_records_archive
            SELECT * FROM table_records
            WHERE created_at < :cutoff_date
            AND deleted_at IS NOT NULL
        """), {"cutoff_date": cutoff_date})
        
        # Delete from main table
        session.execute(text("""
            DELETE FROM table_records
            WHERE created_at < :cutoff_date
            AND deleted_at IS NOT NULL
        """), {"cutoff_date": cutoff_date})
        
        session.commit()

# Schedule monthly
celery.conf.beat_schedule['archive-old-records'] = {
    'task': 'archive_old_records',
    'schedule': crontab(day_of_month=1, hour=3),
}
```

**Критерии приемки:**
- [ ] Archive table создана
- [ ] Scheduled task работает
- [ ] Restore from archive возможен
- [ ] Monitoring archived count

---

## 🟢 Sprint 4: Низкий Приоритет
**Длительность:** 2 недели  
**Цель:** Developer Experience & Documentation  
**Story Points:** 48

### Testing & Quality

#### TASK-401: Добавить E2E тесты 🟢
**Story Points:** 13  
**Приоритет:** Низкий  
**Файлы:** `tests/e2e/`

**Реализация (Playwright):**
```python
# tests/e2e/test_tables.py
import pytest
from playwright.async_api import async_playwright

@pytest.mark.asyncio
async def test_create_table_flow():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        # Login
        await page.goto("http://localhost:5173/login")
        await page.fill('input[name="email"]', "test@example.com")
        await page.fill('input[name="password"]', "password")
        await page.click('button[type="submit"]')
        
        # Create table
        await page.goto("http://localhost:5173/tables")
        await page.click('button:has-text("New Table")')
        await page.fill('input[name="name"]', "Test Table")
        await page.click('button:has-text("Create")')
        
        # Verify
        await page.wait_for_selector('text=Test Table')
        
        await browser.close()
```

**Критерии приемки:**
- [ ] E2E тесты для основных flows
- [ ] CI/CD integration
- [ ] Screenshot на failures
- [ ] Coverage > 70%

---

#### TASK-402: Улучшить API документацию 🟢
**Story Points:** 8  
**Приоритет:** Низкий  
**Файлы:** `docs/api/`, `backend/src/modules/*/routes.py`

**Действия:**
1. Добавить examples в OpenAPI
2. Создать Postman collection
3. Написать API guides
4. Добавить code samples

**Критерии приемки:**
- [ ] OpenAPI с примерами
- [ ] Postman collection
- [ ] API guides написаны
- [ ] Code samples для всех endpoints

---

#### TASK-403: Добавить performance benchmarks 🟢
**Story Points:** 8  
**Приоритет:** Низкий  
**Файлы:** `tests/performance/`

**Реализация (Locust):**
```python
# tests/performance/locustfile.py
from locust import HttpUser, task, between

class CRMUser(HttpUser):
    wait_time = between(1, 3)
    
    def on_start(self):
        # Login
        response = self.client.post("/api/v1/auth/login", json={
            "email": "test@example.com",
            "password": "password"
        })
        self.token = response.json()["access_token"]
    
    @task(3)
    def list_tables(self):
        self.client.get(
            "/api/v1/tables/",
            headers={"Authorization": f"Bearer {self.token}"}
        )
    
    @task(1)
    def create_table(self):
        self.client.post(
            "/api/v1/tables/",
            json={"name": "Test Table"},
            headers={"Authorization": f"Bearer {self.token}"}
        )
```

**Критерии приемки:**
- [ ] Load tests настроены
- [ ] Baseline metrics установлены
- [ ] CI/CD integration
- [ ] Performance regression detection

---

## 📊 Sprint Summary

### Sprint 0: Запуск (2 дня)
- **Задач:** 3
- **Story Points:** 13
- **Цель:** Запустить проект локально

### Sprint 1: Критичные Исправления (2 недели)
- **Задач:** 9
- **Story Points:** 76
- **Цель:** Production blockers

### Sprint 2: Высокий Приоритет (2 недели)
- **Задач:** 8
- **Story Points:** 63
- **Цель:** Performance & Scalability

### Sprint 3: Средний Приоритет (2 недели)
- **Задач:** 5
- **Story Points:** 55
- **Цель:** High Availability

### Sprint 4: Низкий Приоритет (2 недели)
- **Задач:** 3
- **Story Points:** 48
- **Цель:** Testing & Documentation

---

## 🎯 Метрики Успеха

### После Sprint 1
- [ ] Проект запущен и работает
- [ ] Все критичные индексы добавлены
- [ ] N+1 queries исправлены
- [ ] Backups настроены
- [ ] Response time < 500ms (p95)

### После Sprint 2
- [ ] Caching работает (hit rate > 70%)
- [ ] Celery throughput увеличен на 300%
- [ ] Rate limiting per org работает
- [ ] APM показывает все slow queries

### После Sprint 3
- [ ] PostgreSQL replication работает
- [ ] Redis HA настроен
- [ ] RabbitMQ cluster работает
- [ ] Uptime > 99.9%

### После Sprint 4
- [ ] E2E tests coverage > 70%
- [ ] API documentation complete
- [ ] Performance benchmarks установлены
- [ ] Load testing passed (10k concurrent users)

---

## 📝 Следующие Шаги

1. **Сейчас:** Выполнить Sprint 0 (запуск проекта)
2. **Эта неделя:** Начать Sprint 1 (критичные исправления)
3. **Через 2 недели:** Sprint 2 (performance)
4. **Через 1 месяц:** Sprint 3 (HA)
5. **Через 1.5 месяца:** Sprint 4 (testing)

**Готовность к production:** Через 8 недель (2 месяца)

---

**Автор:** Cascade AI  
**Дата:** 27 февраля 2026  
**Версия:** 1.0
