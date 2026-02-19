from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "CRM Platform"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://crm_user:crm_pass@localhost:5432/crm_db"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://crm_user:crm_pass@localhost:5432/crm_db"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Auth / JWT
    SECRET_KEY: str = "super-secret-change-in-prod"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # S3 / MinIO
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "crm-files"
    S3_REGION: str = "us-east-1"

    # CORS
    CORS_ORIGINS: str = '["http://localhost:5173"]'

    # SMTP / Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_FROM_NAME: str = "CRM Platform"
    SMTP_TLS: bool = True

    # Domain
    DOMAIN: str = "localhost"
    FRONTEND_URL: str = "http://localhost:5173"

    # RabbitMQ
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"

    # YooKassa billing
    YOOKASSA_SHOP_ID: str = ""
    YOOKASSA_SECRET_KEY: str = ""
    YOOKASSA_RETURN_URL: str = "http://localhost:5173/billing/success"

    # Sentry
    SENTRY_DSN: str = ""

    # Superadmin (created from env, not tied to any org)
    SUPERADMIN_EMAIL: str = ""
    SUPERADMIN_PASSWORD: str = ""

    # AI (Timeweb Agent / OpenAI-compatible)
    OPENAI_API_KEY: str = ""
    OPENAI_BEARER_TOKEN: str = ""
    OPENAI_MODEL: str = "gpt-4.1"
    AI_BASE_URL: str = "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/289156bc-4adc-4be8-94cf-6767a704a80c/v1"
    AI_SYSTEM_PROMPT: str = "Ты — AI-ассистент CRM платформы. Отвечай на русском языке. Помогай с данными, отчётами и аналитикой."

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
