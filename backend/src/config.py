import json
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "CRM Platform"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"  # development|staging|production

    # Feature flags
    ENABLE_AI: bool = True
    ENABLE_SENTRY: bool = False
    ENABLE_METRICS: bool = True
    ENABLE_RATE_LIMIT: bool = True

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://crm_user:crm_pass@localhost:5432/crm_db"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://crm_user:crm_pass@localhost:5432/crm_db"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT_S: float = 30.0
    DB_POOL_RECYCLE_S: int = 1800
    DB_HEALTH_TIMEOUT_S: float = 2.0

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_HEALTH_TIMEOUT_S: float = 2.0

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
    S3_FORCE_PATH_STYLE: bool = True
    S3_VERIFY_SSL: bool = True
    S3_USE_SSL: bool = False

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v: Any) -> list[str]:
        # Accept:
        # - JSON array: ["https://a.com","https://b.com"]
        # - CSV: https://a.com,https://b.com
        # - single string: https://a.com
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            parts = [p.strip() for p in s.split(",")]
            return [p for p in parts if p]
        return [str(v).strip()]

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
    # Keep for backwards-compat; prefer AI_MAX_TOKENS_PER_REQUEST.
    AI_MAX_TOKENS: int = 6000
    AI_MAX_TOKENS_PER_REQUEST: int = 2000
    # Legacy defaults (used when per-plan values are not set).
    AI_MAX_TOKENS_PER_DAY_PER_ORG: int = 200000
    AI_RPM_PER_USER: int = 30
    # Per-plan limits (tokens/day per org, requests/minute per user).
    AI_MAX_TOKENS_PER_DAY_FREE: int = 20000
    AI_MAX_TOKENS_PER_DAY_TEAM: int = 200000
    AI_MAX_TOKENS_PER_DAY_BUSINESS: int = 500000
    AI_RPM_PER_USER_FREE: int = 10
    AI_RPM_PER_USER_TEAM: int = 30
    AI_RPM_PER_USER_BUSINESS: int = 60
    AI_BASE_URL: str = "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/289156bc-4adc-4be8-94cf-6767a704a80c/v1"
    AI_SYSTEM_PROMPT: str = "You are an AI assistant for the CRM platform. Reply in Russian."

    @model_validator(mode="after")
    def _validate_production_secrets(self) -> "Settings":
        if str(self.ENVIRONMENT).lower() != "production":
            return self

        def _bad_default(value: str, default: str) -> bool:
            return (value or "").strip() == default

        errors: list[str] = []

        if not self.SECRET_KEY or len(self.SECRET_KEY.strip()) < 32 or _bad_default(
            self.SECRET_KEY, "super-secret-change-in-prod"
        ):
            errors.append("SECRET_KEY")

        if not self.DATABASE_URL or _bad_default(
            self.DATABASE_URL, "postgresql+asyncpg://crm_user:crm_pass@localhost:5432/crm_db"
        ):
            errors.append("DATABASE_URL")

        if not self.S3_ACCESS_KEY or _bad_default(self.S3_ACCESS_KEY, "minioadmin"):
            errors.append("S3_ACCESS_KEY")
        if not self.S3_SECRET_KEY or _bad_default(self.S3_SECRET_KEY, "minioadmin"):
            errors.append("S3_SECRET_KEY")

        if self.ENABLE_AI and not (self.OPENAI_BEARER_TOKEN.strip() or self.OPENAI_API_KEY.strip()):
            errors.append("OPENAI_BEARER_TOKEN/OPENAI_API_KEY")

        if errors:
            raise ValueError(
                "Missing/unsafe production settings: "
                + ", ".join(errors)
                + ". Set them via environment variables or secrets."
            )

        return self

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
