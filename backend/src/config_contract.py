from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from src.config import Settings


class ConfigLayer(StrEnum):
    APP = "app_config"
    SECRET = "credentials_secrets"
    RUNTIME = "runtime_mutable"


class ConfigSource(StrEnum):
    ENV = "env"
    ENV_OR_FILE = "env_or_file_secret"
    DB = "database"
    DB_SECRET = "database_encrypted_secret"


@dataclass(frozen=True, slots=True)
class ConfigContractEntry:
    key: str
    layer: ConfigLayer
    source: ConfigSource
    secret: bool
    mutable: bool
    owner: str
    notes: str


ENV_SECRET_FIELDS = {
    "DATABASE_URL",
    "DATABASE_URL_SYNC",
    "DOCS_ONLYOFFICE_JWT_SECRET",
    "JWT_SUPERADMIN_SECRET_KEY",
    "JWT_USER_SECRET_KEY",
    "OPENAI_API_KEY",
    "OPENAI_BEARER_TOKEN",
    "RABBITMQ_URL",
    "REDIS_URL",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "SECRET_KEY",
    "SENTRY_DSN",
    "SMTP_PASSWORD",
    "SMTP_USER",
    "SUPERADMIN_PASSWORD",
    "SUPERADMIN_PASSWORD_HASH",
    "YOOKASSA_SECRET_KEY",
    "YOOKASSA_SHOP_ID",
    "BILLING_WEBHOOK_SHARED_SECRET",
}

RUNTIME_CONTRACT = (
    ConfigContractEntry(
        key="ai.model",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Runtime override for AI model; falls back to OPENAI_MODEL.",
    ),
    ConfigContractEntry(
        key="ai.ai_base_url",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Runtime AI provider base URL; falls back to AI_BASE_URL.",
    ),
    ConfigContractEntry(
        key="ai.ai_provider_mode",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Runtime provider mode; falls back to AI_PROVIDER_MODE.",
    ),
    ConfigContractEntry(
        key="ai.system_prompt",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Mutable AI system prompt.",
    ),
    ConfigContractEntry(
        key="ai.temperature",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Mutable AI generation temperature.",
    ),
    ConfigContractEntry(
        key="ai.max_tokens_per_request",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Mutable AI request token cap.",
    ),
    ConfigContractEntry(
        key="ai.strict_actions",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Mutable AI strict action execution flag.",
    ),
    ConfigContractEntry(
        key="ai.ai_bearer_token",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB_SECRET,
        secret=True,
        mutable=True,
        owner="superadmin_ai_runtime",
        notes="Encrypted runtime AI credential; falls back to OPENAI_BEARER_TOKEN/OPENAI_API_KEY.",
    ),
    ConfigContractEntry(
        key="billing.yookassa_shop_id",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_billing_runtime",
        notes="Mutable YooKassa shop id; falls back to YOOKASSA_SHOP_ID.",
    ),
    ConfigContractEntry(
        key="billing.yookassa_return_url",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_billing_runtime",
        notes="Mutable YooKassa return URL; falls back to YOOKASSA_RETURN_URL.",
    ),
    ConfigContractEntry(
        key="billing.yookassa_webhook_url",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB,
        secret=False,
        mutable=True,
        owner="superadmin_billing_runtime",
        notes="Mutable YooKassa webhook URL; falls back to YOOKASSA_WEBHOOK_URL.",
    ),
    ConfigContractEntry(
        key="billing.yookassa_secret_key",
        layer=ConfigLayer.RUNTIME,
        source=ConfigSource.DB_SECRET,
        secret=True,
        mutable=True,
        owner="superadmin_billing_runtime",
        notes="Encrypted runtime YooKassa secret; falls back to YOOKASSA_SECRET_KEY.",
    ),
)


def build_env_contract() -> tuple[ConfigContractEntry, ...]:
    entries: list[ConfigContractEntry] = []
    for field_name in sorted(Settings.model_fields):
        secret = field_name in ENV_SECRET_FIELDS
        entries.append(
            ConfigContractEntry(
                key=field_name,
                layer=ConfigLayer.SECRET if secret else ConfigLayer.APP,
                source=ConfigSource.ENV_OR_FILE if secret else ConfigSource.ENV,
                secret=secret,
                mutable=False,
                owner="settings",
                notes=(
                    "Deploy-time secret. In production prefer mounted secret files via "
                    f"{field_name}_FILE instead of plaintext env."
                    if secret
                    else "Deploy-time application configuration."
                ),
            )
        )
    return tuple(entries)


def build_config_contract() -> tuple[ConfigContractEntry, ...]:
    return build_env_contract() + RUNTIME_CONTRACT
