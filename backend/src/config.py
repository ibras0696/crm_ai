import json
import os
from typing import Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    APP_NAME: str = "CRM Platform"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"  # development|staging|production
    APP_TIMEZONE: str = "Europe/Moscow"

    # Feature flags
    ENABLE_SENTRY: bool = False
    ENABLE_METRICS: bool = True
    ENABLE_RATE_LIMIT: bool = True
    RATE_LIMIT_REQUESTS_PER_MINUTE: int = 120
    EXPOSE_API_DOCS_IN_PROD: bool = False

    # Security / hardening
    MAX_REQUEST_BODY_MB: int = 50
    RATE_LIMIT_REDIS_PREFIX: str = "rate_limit"
    FILE_MAX_UPLOAD_MB: int = 25
    FILE_UPLOAD_CHUNK_SIZE_KB: int = 256
    FILE_ALLOWED_MIME_TYPES: list[str] = [
        "image/png",
        "image/jpeg",
        "image/gif",
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ]
    CHAT_ATTACHMENT_MAX_UPLOAD_MB: int = 5
    CHAT_ATTACHMENT_MAX_FILES_PER_MESSAGE: int = 1
    CHAT_ATTACHMENT_PRESIGNED_TTL_S: int = 900
    CHAT_ATTACHMENT_ALLOWED_MIME_TYPES: list[str] = []
    CHAT_REALTIME_ROLLOUT_ENABLED: bool = True
    CHAT_REALTIME_ROLLOUT_PERCENT: int = 100
    CHAT_TELEMETRY_ENABLED: bool = True
    # --------------------------------------------------------------------------
    # Docs Module Security & Pipeline
    # --------------------------------------------------------------------------
    DOCS_AV_MODE: str = "mock_clean"  # mock_clean | clamav
    DOCS_CLAMAV_HOST: str = "clamav"
    DOCS_CLAMAV_PORT: int = 3310
    DOCS_CLAMAV_TIMEOUT_S: float = 10.0
    DOCS_SCAN_CHUNK_SIZE_KB: int = 256
    DOCS_TEXT_SAVE_RPM: int = 20

    # --- OnlyOffice Document Server ---
    DOCS_ONLYOFFICE_ENABLED: bool = False
    DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL: str = ""
    DOCS_ONLYOFFICE_DOCUMENT_SERVER_INTERNAL_URL: str = "http://onlyoffice:80"
    DOCS_ONLYOFFICE_JWT_SECRET: str = ""
    DOCS_ONLYOFFICE_CALLBACK_URL: str = "http://api:8000/api/v1/docs/integrations/onlyoffice/callback"
    DOCS_ONLYOFFICE_EDITOR_LANG: str = "ru"
    DOCS_ONLYOFFICE_REQUEST_TIMEOUT_S: float = 20.0

    # --- AI Document Generation ---
    DOCS_AI_GENERATION_ENABLED: bool = True
    DOCS_AI_MAX_PROMPT_CHARS: int = 12000
    DOCS_AI_MAX_CHARS_TXT: int = 60000
    DOCS_AI_MAX_CHARS_DOCX: int = 80000
    DOCS_AI_MAX_CHARS_PDF: int = 70000
    DOCS_AI_RESERVED_BYTES_BASE: int = 262144

    # --------------------------------------------------------------------------
    # Retention & Cleanup
    # --------------------------------------------------------------------------
    DOCS_RETENTION_DAYS: int = 0
    DOCS_RETENTION_KEEP_LATEST: int = 5
    DOCS_RETENTION_BATCH_SIZE: int = 200
    TABLE_EXPORT_MAX_ROWS: int = 5000
    TABLE_EXPORT_MAX_COLUMNS: int = 200
    TABLE_IMPORT_MAX_BYTES: int = 5 * 1024 * 1024
    TABLE_IMPORT_MAX_ROWS: int = 5000
    TABLE_IMPORT_MAX_COLUMNS: int = 200
    TABLE_IMPORT_MAX_CELL_CHARS: int = 4000
    TABLE_IMPORT_MAX_PROCESSING_S: float = 8.0
    AUTH_ACCESS_COOKIE_NAME: str = "access_token"
    AUTH_REFRESH_COOKIE_NAME: str = "refresh_token"
    AUTH_COOKIE_SECURE: bool = False
    AUTH_COOKIE_SAMESITE: str = "lax"
    AUTH_COOKIE_DOMAIN: str = ""
    AUTH_COOKIE_PATH: str = "/"
    AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS: int = 1800
    AUTH_PASSWORD_RESET_TOKEN_BYTES: int = 48
    AUTH_REGISTRATION_CONFIRM_TOKEN_TTL_SECONDS: int = 1800
    AUTH_REGISTRATION_CONFIRM_TOKEN_BYTES: int = 48
    AUTH_REGISTRATION_REQUEST_RPM_PER_EMAIL: int = 3
    AUTH_REGISTRATION_REQUEST_RPM_PER_IP: int = 20

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://crm_user:crm_pass@localhost:5432/crm_db"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://crm_user:crm_pass@localhost:5432/crm_db"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 50
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_S: float = 10.0
    DB_POOL_RECYCLE_S: int = 1800
    DB_HEALTH_TIMEOUT_S: float = 2.0
    DB_STATEMENT_TIMEOUT_MS: int = 30000

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_HEALTH_TIMEOUT_S: float = 2.0

    # Auth / JWT
    SECRET_KEY: str = "super-secret-change-in-prod"
    JWT_ALGORITHM: str = "HS256"
    JWT_USER_SECRET_KEY: str = ""
    JWT_SUPERADMIN_SECRET_KEY: str = ""
    JWT_ISSUER: str = "crm-platform"
    JWT_AUDIENCE_USER: str = "crm-api-users"
    JWT_AUDIENCE_SUPERADMIN: str = "crm-api-superadmin"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REFRESH_TOKEN_REMEMBER_ME_EXPIRE_DAYS: int = 30

    # S3 / MinIO
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_PUBLIC_ENDPOINT: str = ""
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "crm-files"
    S3_REGION: str = "us-east-1"
    S3_FORCE_PATH_STYLE: bool = True
    S3_VERIFY_SSL: bool = True
    S3_USE_SSL: bool = False

    # LiveKit
    LIVEKIT_URL: str = "ws://livekit:7880"
    LIVEKIT_PUBLIC_URL: str = "ws://localhost:7880"
    LIVEKIT_API_KEY: str = "devkey"
    LIVEKIT_API_SECRET: str = "devsecret-min-32-chars-for-security"

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

    @field_validator("TRUSTED_HOSTS", mode="before")
    @classmethod
    def _parse_trusted_hosts(cls, v: Any) -> list[str]:
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

    @field_validator("FILE_ALLOWED_MIME_TYPES", mode="before")
    @classmethod
    def _parse_file_allowed_mime_types(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x).strip().lower() for x in v if str(x).strip()]
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return [str(x).strip().lower() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            return [p.strip().lower() for p in s.split(",") if p.strip()]
        return [str(v).strip().lower()]

    @field_validator("CHAT_ATTACHMENT_ALLOWED_MIME_TYPES", mode="before")
    @classmethod
    def _parse_chat_attachment_allowed_mime_types(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x).strip().lower() for x in v if str(x).strip()]
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return [str(x).strip().lower() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            return [p.strip().lower() for p in s.split(",") if p.strip()]
        return [str(v).strip().lower()]

    @field_validator("AUTH_COOKIE_SAMESITE", mode="before")
    @classmethod
    def _validate_auth_cookie_samesite(cls, v: Any) -> str:
        s = str(v or "lax").strip().lower()
        if s not in {"lax", "strict", "none"}:
            return "lax"
        return s

    @field_validator("DEBUG", mode="before")
    @classmethod
    def _normalize_debug_bool(cls, v: Any) -> Any:
        if isinstance(v, str):
            s = v.strip().lower()
            if s in {"release", "prod", "production"}:
                return False
            if s in {"debug", "dev", "development"}:
                return True
        return v

    @field_validator("CHAT_REALTIME_ROLLOUT_PERCENT", mode="before")
    @classmethod
    def _normalize_chat_rollout_percent(cls, v: Any) -> int:
        try:
            value = int(v)
        except (TypeError, ValueError):
            value = 100
        return max(0, min(100, value))

    # SMTP / Email
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_FROM_NAME: str = "CRM Platform"
    SMTP_TLS: bool = True
    SMTP_TIMEOUT_S: float = 10.0
    # Enable sending emails from API/worker. If false, tasks will no-op successfully.
    ENABLE_EMAIL: bool = True

    # Invites anti-spam
    INVITES_RPM_PER_ACTOR: int = 10

    # Domain
    DOMAIN: str = "localhost"
    FRONTEND_URL: str = "https://crm.example.com"
    TRUSTED_HOSTS: list[str] = []

    # RabbitMQ
    RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"

    # YooKassa billing
    YOOKASSA_SHOP_ID: str = ""
    YOOKASSA_SECRET_KEY: str = ""
    YOOKASSA_RETURN_URL: str = "http://localhost:5173/billing/success"
    YOOKASSA_WEBHOOK_URL: str = ""
    BILLING_WEBHOOK_SHARED_SECRET: str = ""
    BILLING_GRACE_DAYS: int = 30
    BILLING_PRE_EXPIRY_NOTICE_HOURS: int = 24
    BILLING_PURGE_AFTER_END_DAYS: int = 30
    BILLING_POST_EXPIRY_REMINDER_DAYS: int = 7
    BILLING_CLEANUP_BATCH_SIZE: int = 100

    # Sentry
    SENTRY_DSN: str = ""

    # Superadmin (created from env, not tied to any org)
    SUPERADMIN_EMAIL: str = ""
    SUPERADMIN_PASSWORD: str = ""
    SUPERADMIN_PASSWORD_HASH: str = ""
    SUPERADMIN_ACCESS_COOKIE_NAME: str = "sa_access_token"
    SUPERADMIN_LOGIN_MAX_ATTEMPTS: int = 5
    SUPERADMIN_LOGIN_WINDOW_S: int = 900
    SUPERADMIN_LOCK_BASE_S: int = 30
    SUPERADMIN_LOCK_MAX_S: int = 1800

    # --- AI (Timeweb Agent / OpenAI-compatible) ---
    ENABLE_AI: bool = True
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
    AI_PROVIDER_MODE: str = "openai_compatible"  # openai_compatible | timeweb_native
    AI_ENFORCE_EXACT_USAGE: bool = True
    AI_SEND_SYSTEM_PROMPT_ONCE_PER_CHAT: bool = True
    AI_PROVIDER_TIMEOUT_S: float = 60.0
    AI_SYSTEM_PROMPT: str = "You are an AI assistant for the CRM platform. Reply in Russian."

    @model_validator(mode="before")
    @classmethod
    def _load_file_backed_values(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        merged = dict(data)
        for field_name in cls.model_fields:
            file_env_name = f"{field_name}_FILE"
            # Prefer value provided by settings sources (e.g. .env), fallback to process env.
            file_path_raw = merged.get(file_env_name)
            if file_path_raw is None:
                file_path_raw = os.getenv(file_env_name, "")
            file_path = str(file_path_raw or "").strip()
            if not file_path:
                continue
            resolved_path = os.path.expanduser(file_path)
            try:
                with open(resolved_path, encoding="utf-8") as fh:
                    merged[field_name] = fh.read().strip()
            except OSError as exc:
                raise ValueError(
                    f"Failed to load {field_name} from {file_env_name}={resolved_path}: {exc}"
                ) from exc
        return merged

    @model_validator(mode="after")
    def _validate_production_secrets(self) -> "Settings":
        if str(self.ENVIRONMENT).lower() != "production":
            return self

        def _is_unsafe(value: str, *, defaults: tuple[str, ...] = ()) -> bool:
            v = (value or "").strip()
            if not v:
                return True
            vl = v.lower()
            if vl.startswith("change_me"):
                return True
            if vl in {"example.com", "localhost"}:
                return True
            return v in defaults

        errors: list[str] = []
        jwt_user_secret = str(self.JWT_USER_SECRET_KEY or "").strip()
        jwt_superadmin_secret = str(self.JWT_SUPERADMIN_SECRET_KEY or "").strip()
        openai_bearer_token = str(self.OPENAI_BEARER_TOKEN or "").strip()
        openai_api_key = str(self.OPENAI_API_KEY or "").strip()
        superadmin_email = str(self.SUPERADMIN_EMAIL or "").strip()
        superadmin_password_hash = str(self.SUPERADMIN_PASSWORD_HASH or "").strip()
        superadmin_password = str(self.SUPERADMIN_PASSWORD or "").strip()
        billing_webhook_shared_secret = str(self.BILLING_WEBHOOK_SHARED_SECRET or "").strip()

        if len((self.SECRET_KEY or "").strip()) < 32 or _is_unsafe(
            self.SECRET_KEY,
            defaults=("super-secret-change-in-prod", "super-secret-dev-key-change-in-prod"),
        ):
            errors.append("SECRET_KEY")
        if len(jwt_user_secret) < 32 or _is_unsafe(self.JWT_USER_SECRET_KEY):
            errors.append("JWT_USER_SECRET_KEY")
        if len(jwt_superadmin_secret) < 32 or _is_unsafe(self.JWT_SUPERADMIN_SECRET_KEY):
            errors.append("JWT_SUPERADMIN_SECRET_KEY")
        if jwt_user_secret and jwt_superadmin_secret and jwt_user_secret == jwt_superadmin_secret:
            errors.append("JWT_USER_SECRET_KEY/JWT_SUPERADMIN_SECRET_KEY")

        if _is_unsafe(
            self.DATABASE_URL,
            defaults=("postgresql+asyncpg://crm_user:crm_pass@localhost:5432/crm_db",),
        ):
            errors.append("DATABASE_URL")
        if _is_unsafe(
            self.DATABASE_URL_SYNC,
            defaults=("postgresql+psycopg2://crm_user:crm_pass@localhost:5432/crm_db",),
        ):
            errors.append("DATABASE_URL_SYNC")

        if _is_unsafe(self.S3_ACCESS_KEY, defaults=("minioadmin",)):
            errors.append("S3_ACCESS_KEY")
        if _is_unsafe(self.S3_SECRET_KEY, defaults=("minioadmin",)):
            errors.append("S3_SECRET_KEY")
        if _is_unsafe(
            self.RABBITMQ_URL,
            defaults=("amqp://guest:guest@localhost:5672/", "amqp://guest:guest@rabbitmq:5672/"),
        ):
            errors.append("RABBITMQ_URL")
        if _is_unsafe(self.DOMAIN):
            errors.append("DOMAIN")
        if _is_unsafe(self.FRONTEND_URL):
            errors.append("FRONTEND_URL")
        if any("localhost" in (o or "").lower() for o in (self.CORS_ORIGINS or [])):
            errors.append("CORS_ORIGINS")

        if self.ENABLE_AI and not (openai_bearer_token or openai_api_key):
            errors.append("OPENAI_BEARER_TOKEN/OPENAI_API_KEY")
        if bool(superadmin_email) ^ bool(superadmin_password_hash):
            errors.append("SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD_HASH")
        if superadmin_password:
            errors.append("SUPERADMIN_PASSWORD")
        if not billing_webhook_shared_secret:
            errors.append("BILLING_WEBHOOK_SHARED_SECRET")
        if not bool(self.AUTH_COOKIE_SECURE):
            errors.append("AUTH_COOKIE_SECURE")
        if self.AUTH_COOKIE_SAMESITE == "none" and not bool(self.AUTH_COOKIE_SECURE):
            errors.append("AUTH_COOKIE_SECURE (required when AUTH_COOKIE_SAMESITE=none)")

        if errors:
            raise ValueError(
                "Missing/unsafe production settings: "
                + ", ".join(errors)
                + ". Set them via environment variables or secrets."
            )

        return self

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
