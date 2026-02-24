from __future__ import annotations

import hmac

from src.config import settings
from src.infrastructure.redis import get_redis
from src.modules.auth.security import create_superadmin_access_token, verify_password


class SuperadminRateLimitedError(ValueError):
    def __init__(self, retry_after_s: int):
        super().__init__("RATE_LIMITED")
        self.retry_after_s = int(max(1, retry_after_s))


class SuperadminAuthService:
    """Authentication/config use-cases for superadmin."""

    async def authenticate_superadmin(self, email: str, password: str, ip_address: str | None = None) -> str:
        if not settings.SUPERADMIN_EMAIL or not settings.SUPERADMIN_PASSWORD_HASH:
            raise RuntimeError("SUPERADMIN_NOT_CONFIGURED")
        throttle_key = self._throttle_key(email=email, ip_address=ip_address)
        locked_ttl = await self._lock_ttl(throttle_key)
        if locked_ttl > 0:
            raise SuperadminRateLimitedError(locked_ttl)

        email_ok = hmac.compare_digest((email or "").strip().lower(), settings.SUPERADMIN_EMAIL.strip().lower())
        try:
            password_ok = verify_password(password, settings.SUPERADMIN_PASSWORD_HASH)
        except Exception:
            password_ok = False
        if not (email_ok and password_ok):
            retry_after = await self._on_auth_failed(throttle_key)
            if retry_after > 0:
                raise SuperadminRateLimitedError(retry_after)
            raise ValueError("INVALID_CREDENTIALS")

        await self._on_auth_success(throttle_key)
        return create_superadmin_access_token()

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

    @staticmethod
    def _throttle_key(*, email: str, ip_address: str | None) -> str:
        e = (email or "").strip().lower() or "-"
        ip = (ip_address or "").strip() or "-"
        return f"superadmin:auth:{e}:{ip}"

    async def _lock_ttl(self, throttle_key: str) -> int:
        r = await self._redis_or_none()
        if r is None:
            return 0
        ttl = await r.ttl(f"{throttle_key}:lock")
        return max(0, int(ttl or 0))

    async def _on_auth_failed(self, throttle_key: str) -> int:
        r = await self._redis_or_none()
        if r is None:
            return 0
        fail_key = f"{throttle_key}:fail"
        lock_key = f"{throttle_key}:lock"
        fails = int(await r.incr(fail_key))
        if fails == 1:
            await r.expire(fail_key, int(max(60, settings.SUPERADMIN_LOGIN_WINDOW_S)))
        limit = int(max(1, settings.SUPERADMIN_LOGIN_MAX_ATTEMPTS))
        if fails <= limit:
            return 0

        step = fails - limit
        lock_for = int(max(1, settings.SUPERADMIN_LOCK_BASE_S)) * (2 ** max(0, step - 1))
        lock_for = min(lock_for, int(max(1, settings.SUPERADMIN_LOCK_MAX_S)))
        await r.set(lock_key, "1", ex=lock_for)
        return lock_for

    async def _on_auth_success(self, throttle_key: str) -> None:
        r = await self._redis_or_none()
        if r is None:
            return
        await r.delete(f"{throttle_key}:fail", f"{throttle_key}:lock")

    async def _redis_or_none(self):
        try:
            return await get_redis()
        except Exception:
            return None
