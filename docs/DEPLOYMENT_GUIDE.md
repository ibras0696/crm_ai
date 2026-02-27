# 🚀 CRM Platform Deployment Guide

Полное руководство по развертыванию CRM Platform в production.

---

## 📋 Pre-requisites

### Минимальные Требования
- **CPU:** 4 cores
- **RAM:** 8 GB
- **Disk:** 50 GB SSD
- **OS:** Ubuntu 22.04 LTS или новее
- **Docker:** 24.0+
- **Docker Compose:** 2.20+

### Рекомендуемые Требования (HA Setup)
- **CPU:** 8+ cores
- **RAM:** 16+ GB
- **Disk:** 100+ GB SSD
- **Network:** 1 Gbps

---

## 🔧 Production Setup

### 1. Подготовка Сервера

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### 2. Clone Repository

```bash
git clone https://github.com/your-org/crm-platform.git
cd crm-platform
```

### 3. Configure Secrets

```bash
# Copy example secrets
cp secrets.yml.example secrets.yml

# Generate strong passwords
openssl rand -base64 32  # For SECRET_KEY
openssl rand -base64 32  # For JWT_USER_SECRET_KEY
openssl rand -base64 32  # For JWT_SUPERADMIN_SECRET_KEY
openssl rand -base64 16  # For DB password
openssl rand -base64 16  # For RabbitMQ password
openssl rand -base64 16  # For Redis password

# Edit secrets.yml
nano secrets.yml
```

**secrets.yml example:**
```yaml
services:
  db:
    environment:
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "STRONG_DB_PASSWORD_HERE"
      POSTGRES_DB: "crm_db"
  
  rabbitmq:
    environment:
      RABBITMQ_DEFAULT_USER: "crm_rabbit"
      RABBITMQ_DEFAULT_PASS: "STRONG_RABBIT_PASSWORD_HERE"
  
  minio:
    environment:
      MINIO_ROOT_USER: "crm_minio"
      MINIO_ROOT_PASSWORD: "STRONG_MINIO_PASSWORD_HERE"
  
  api:
    environment:
      ENVIRONMENT: "production"
      DEBUG: "false"
      DOMAIN: "your-domain.com"
      FRONTEND_URL: "https://your-domain.com"
      
      # Database
      POSTGRES_USER: "crm_prod"
      POSTGRES_PASSWORD: "STRONG_DB_PASSWORD_HERE"
      DATABASE_URL: "postgresql+asyncpg://crm_prod:STRONG_DB_PASSWORD_HERE@db:5432/crm_db"
      DATABASE_URL_SYNC: "postgresql+psycopg2://crm_prod:STRONG_DB_PASSWORD_HERE@db:5432/crm_db"
      
      # RabbitMQ
      RABBITMQ_URL: "amqp://crm_rabbit:STRONG_RABBIT_PASSWORD_HERE@rabbitmq:5672/"
      
      # S3
      S3_ACCESS_KEY: "crm_minio"
      S3_SECRET_KEY: "STRONG_MINIO_PASSWORD_HERE"
      
      # Security
      SECRET_KEY: "GENERATED_SECRET_KEY_32_CHARS"
      JWT_USER_SECRET_KEY: "GENERATED_JWT_USER_KEY_32_CHARS"
      JWT_SUPERADMIN_SECRET_KEY: "GENERATED_JWT_SUPERADMIN_KEY_32_CHARS"
      
      # CORS
      CORS_ORIGINS: "[\"https://your-domain.com\"]"
      
      # Cookies
      AUTH_COOKIE_SECURE: "true"
      AUTH_COOKIE_SAMESITE: "lax"
      
      # AI (optional)
      ENABLE_AI: "true"
      OPENAI_BEARER_TOKEN: "YOUR_OPENAI_TOKEN"
      
      # Email (optional)
      ENABLE_EMAIL: "true"
      SMTP_HOST: "smtp.gmail.com"
      SMTP_PORT: "587"
      SMTP_USER: "your-email@gmail.com"
      SMTP_PASSWORD: "your-app-password"
      SMTP_FROM: "noreply@your-domain.com"
```

### 4. SSL Certificates (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d your-domain.com

# Certificates will be in:
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 5. Deploy

**Standard Deployment:**
```bash
./scripts/compose-prod.sh up -d --build
```

**High Availability Deployment:**
```bash
docker compose -f docker-compose.ha.yml up -d --build
```

### 6. Verify Deployment

```bash
# Check all services are running
docker compose ps

# Check API health
curl https://your-domain.com/api/health

# Check logs
docker compose logs -f api
```

---

## 🔄 Database Migrations

### Apply Migrations

```bash
# Run migrations
docker compose exec api alembic upgrade head

# Create new migration
docker compose exec api alembic revision --autogenerate -m "description"
```

### Apply Critical Indexes

```bash
# Copy SQL file to container
docker cp backend/alembic/versions/add_critical_indexes.sql crm_chechen-db-1:/tmp/

# Execute
docker compose exec db psql -U crm_prod -d crm_db -f /tmp/add_critical_indexes.sql
```

### Setup Partitioning

```bash
# Copy partitioning SQL
docker cp backend/alembic/versions/add_table_partitioning.sql crm_chechen-db-1:/tmp/

# Execute
docker compose exec db psql -U crm_prod -d crm_db -f /tmp/add_table_partitioning.sql
```

---

## 📊 Monitoring Setup

### Grafana

1. Access: `https://your-domain.com:3000`
2. Login: admin / (password from secrets.yml)
3. Add Prometheus datasource: `http://prometheus:9090`
4. Import dashboards from `monitoring/grafana/dashboards/`

### Prometheus

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
