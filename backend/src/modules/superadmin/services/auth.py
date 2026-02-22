from datetime import UTC, datetime, timedelta

import jwt as pyjwt

from src.common.enums import UserRole
from src.config import settings


class SuperadminAuthService:
    """Authentication/config use-cases for superadmin."""

    def authenticate_superadmin(self, email: str, password: str) -> str:
        if not settings.SUPERADMIN_EMAIL or not settings.SUPERADMIN_PASSWORD:
            raise RuntimeError("SUPERADMIN_NOT_CONFIGURED")
        if email != settings.SUPERADMIN_EMAIL or password != settings.SUPERADMIN_PASSWORD:
            raise ValueError("INVALID_CREDENTIALS")
        now = datetime.now(UTC)
        payload = {
            "sub": "superadmin",
            "role": UserRole.SUPERADMIN.value,
            "type": "access",
            "iat": now,
            "exp": now + timedelta(hours=12),
        }
        return pyjwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    def ai_config(self) -> dict:
        base_url = (settings.AI_BASE_URL or "").rstrip("/")
        provider = "timeweb-agent-openai-compatible" if "agent.timeweb.cloud" in base_url else "openai-compatible"
        key = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY or ""
        return {
            "provider": provider,
            "base_url": base_url,
            "official_provider_docs_url": "https://agent.timeweb.cloud/docs",
            "model": settings.OPENAI_MODEL,
            "key_configured": bool(key),
            "key_prefix": f"{key[:4]}***" if key else "",
        }
