from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select

from src.common.runtime_secret import decrypt_runtime_secret, mask_runtime_secret
from src.config import settings
from src.modules.billing.models import BillingRuntimeSecret, BillingRuntimeSettings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(slots=True)
class ResolvedYooKassaConfig:
    shop_id: str
    secret_key: str
    return_url: str
    webhook_url: str
    runtime_shop_id: str
    runtime_return_url: str
    runtime_webhook_url: str
    runtime_secret_key: str


async def resolve_yookassa_runtime_config(session: AsyncSession) -> ResolvedYooKassaConfig:
    settings_row = (await session.execute(select(BillingRuntimeSettings).limit(1))).scalars().first()
    secret_row = (await session.execute(select(BillingRuntimeSecret).limit(1))).scalars().first()

    runtime_shop_id = (settings_row.yookassa_shop_id if settings_row else "").strip()
    runtime_return_url = (settings_row.yookassa_return_url if settings_row else "").strip()
    runtime_webhook_url = (settings_row.yookassa_webhook_url if settings_row else "").strip()
    runtime_secret = decrypt_runtime_secret(secret_row.yookassa_secret_key_encrypted) if secret_row else ""

    env_shop_id = (settings.YOOKASSA_SHOP_ID or "").strip()
    env_secret = (settings.YOOKASSA_SECRET_KEY or "").strip()
    env_return_url = (settings.YOOKASSA_RETURN_URL or "").strip()
    env_webhook_url = (settings.YOOKASSA_WEBHOOK_URL or "").strip()

    return ResolvedYooKassaConfig(
        shop_id=(runtime_shop_id or env_shop_id),
        secret_key=(runtime_secret or env_secret),
        return_url=(runtime_return_url or env_return_url),
        webhook_url=(runtime_webhook_url or env_webhook_url),
        runtime_shop_id=runtime_shop_id,
        runtime_return_url=runtime_return_url,
        runtime_webhook_url=runtime_webhook_url,
        runtime_secret_key=runtime_secret,
    )


def yookassa_secret_mask(value: str) -> str:
    return mask_runtime_secret(value)
