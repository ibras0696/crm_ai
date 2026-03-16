# Deployment Guide

Короткая схема для staging/prod.

## Требования

- Linux сервер
- Docker + Docker Compose v2
- домен и TLS
- подготовленные секреты

## Модель конфигурации

В production:
- обычные настройки идут через env
- секреты идут через env или `*_FILE`
- `secrets.yml` не используется как основной operational источник

Подробности: [config/CONFIG_CONTRACT.md](config/CONFIG_CONTRACT.md)

## Минимальные шаги

1. Подготовить сервер и Docker
2. Клонировать репозиторий
3. Заполнить production env/secrets
4. Проверить `docker-compose.prod.yml`
5. Запустить:

```bash
./scripts/compose-prod.sh up -d --build
```

## Что обязательно задать

- `ENVIRONMENT=production`
- `DOMAIN`
- `FRONTEND_URL`
- `SECRET_KEY`
- `JWT_USER_SECRET_KEY`
- `JWT_SUPERADMIN_SECRET_KEY`
- `DATABASE_URL`
- `DATABASE_URL_SYNC`
- `RABBITMQ_URL`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

Опционально, если используются:
- `OPENAI_BEARER_TOKEN` / `OPENAI_API_KEY`
- `SMTP_*`
- `YOOKASSA_*`

## После запуска проверить

```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:8000/api/health
curl http://localhost:8000/api/readiness
docker compose -f docker-compose.prod.yml logs -f api
```

## Перед релизом

Свериться с [release_checklist.md](release_checklist.md).

1. Access: `https://your-domain.com:9090`
2. Verify targets are up: Status → Targets
3. Check alerts: Alerts

### Alerting (Optional)

```bash
# Install Alertmanager
docker run -d \
  --name alertmanager \
  -p 9093:9093 \
  -v ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml \
  prom/alertmanager
```

---

## 🔐 Security Hardening

### Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### Docker Security

```bash
# Run containers as non-root
# Add to docker-compose.prod.yml:
services:
  api:
    user: "1000:1000"
```

### Secrets Management

```bash
# Use Docker secrets instead of environment variables
# Create secrets:
echo "db_password" | docker secret create db_password -

# Use in compose:
services:
  db:
    secrets:
      - db_password
```

---

## 💾 Backup Strategy

### Automated Backups

```bash
# Setup cron job
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/crm-platform/scripts/backup.sh
```

### Manual Backup

```bash
# Database backup
docker compose exec db pg_dump -U crm_prod crm_db > backup_$(date +%Y%m%d).sql

# MinIO backup
docker compose exec minio mc mirror /data /backups/minio_$(date +%Y%m%d)
```

### Restore

```bash
# Restore database
cat backup_20260227.sql | docker compose exec -T db psql -U crm_prod crm_db

# Restore MinIO
docker compose exec minio mc mirror /backups/minio_20260227 /data
```

---

## 📈 Scaling

### Horizontal Scaling (Kubernetes)

```bash
# Convert to Kubernetes
kompose convert -f docker-compose.prod.yml

# Deploy to K8s
kubectl apply -f .
```

### Vertical Scaling

Edit `docker-compose.prod.yml`:
```yaml
services:
  api:
    cpus: "4.0"      # Increase from 2.0
    mem_limit: "4g"  # Increase from 2g
```

---

## 🔧 Troubleshooting

### API Not Starting

```bash
# Check logs
docker compose logs api

# Check database connection
docker compose exec api python -c "from src.infrastructure.database import engine; print(engine)"
```

### High Memory Usage

```bash
# Check container stats
docker stats

# Restart specific service
docker compose restart api
```

### Database Connection Pool Exhausted

```bash
# Increase pool size in config.py
DB_POOL_SIZE: int = 100
DB_MAX_OVERFLOW: int = 50
```

---

## 📝 Maintenance

### Update Application

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose down
docker compose up -d --build
```

### Clean Up

```bash
# Remove old images
docker image prune -a

# Remove unused volumes
docker volume prune

# Remove stopped containers
docker container prune
```

---

## 🎯 Performance Tuning

### PostgreSQL

```sql
-- Increase shared_buffers
ALTER SYSTEM SET shared_buffers = '2GB';

-- Increase work_mem
ALTER SYSTEM SET work_mem = '64MB';

-- Reload config
SELECT pg_reload_conf();
```

### Redis

```bash
# Increase maxmemory
docker compose exec redis redis-cli CONFIG SET maxmemory 2gb
docker compose exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

---

## 📞 Support

- **Documentation:** https://docs.your-domain.com
- **Issues:** https://github.com/your-org/crm-platform/issues
- **Email:** support@your-domain.com

---

**Last Updated:** 27 февраля 2026
