from __future__ import annotations

import hmac

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from src.config import settings
from src.infrastructure.redis import get_redis
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.security import create_superadmin_access_token, hash_password, verify_password
from src.modules.superadmin.models import (
    SuperadminRuntimeAudit,
    SuperadminRuntimeSecret,
    SuperadminRuntimeSettings,
)


class SuperadminRateLimitedError(ValueError):
    def __init__(self, retry_after_s: int):
        super().__init__("RATE_LIMITED")
        self.retry_after_s = int(max(1, retry_after_s))


class SuperadminAuthService:
    """Authentication/config use-cases for superadmin."""

    async def authenticate_superadmin(self, email: str, password: str, ip_address: str | None = None) -> str:
        credentials = await self._resolve_credentials()
        if not credentials["email"] or not credentials["password_hash"]:
            raise RuntimeError("SUPERADMIN_NOT_CONFIGURED")
        throttle_key = self._throttle_key(email=email, ip_address=ip_address)
        locked_ttl = await self._lock_ttl(throttle_key)
        if locked_ttl > 0:
            raise SuperadminRateLimitedError(locked_ttl)

        email_ok = hmac.compare_digest(self._normalize_email(email), str(credentials["email"]))
        try:
            password_ok = verify_password(password, str(credentials["password_hash"]))
        except Exception:
            password_ok = False
        if not (email_ok and password_ok):
            retry_after = await self._on_auth_failed(throttle_key)
            if retry_after > 0:
                raise SuperadminRateLimitedError(retry_after)
            raise ValueError("INVALID_CREDENTIALS")

        await self._on_auth_success(throttle_key)
        return create_superadmin_access_token(email=str(credentials["email"]))

    async def get_profile(self) -> dict:
        try:
            async with UnitOfWork() as uow:
                settings_row = (await uow.session.execute(select(SuperadminRuntimeSettings).limit(1))).scalars().first()
                secret_row = (await uow.session.execute(select(SuperadminRuntimeSecret).limit(1))).scalars().first()
                audits = (
                    (
                        await uow.session.execute(
                            select(SuperadminRuntimeAudit).order_by(SuperadminRuntimeAudit.created_at.desc()).limit(20)
                        )
                    )
                    .scalars()
                    .all()
                )
        except SQLAlchemyError:
            settings_row = None
            secret_row = None
            audits = []

        runtime_email = self._normalize_email(settings_row.email if settings_row else "")
        runtime_password_hash = str(secret_row.password_hash or "").strip() if secret_row else ""
        env_email = self._normalize_email(settings.SUPERADMIN_EMAIL)
        env_password_hash = str(settings.SUPERADMIN_PASSWORD_HASH or "").strip()
        effective_email = runtime_email or env_email
        effective_password_hash = runtime_password_hash or env_password_hash

        return {
            "email": effective_email,
            "password_configured": bool(effective_password_hash),
            "runtime_email_overridden": bool(runtime_email),
            "runtime_password_overridden": bool(runtime_password_hash),
            "audit": [
                {
                    "id": str(item.id),
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "actor": item.actor,
                    "ip_address": item.ip_address,
                    "changed_fields": item.changed_fields or [],
                    "meta": item.meta or {},
                }
                for item in audits
            ],
        }

    async def update_profile(self, payload: dict, *, changed_by: str, ip_address: str | None = None) -> dict:
        credentials = await self._resolve_credentials()
        effective_email = str(credentials["email"] or "")
        effective_password_hash = str(credentials["password_hash"] or "")
        current_password = str(payload.get("current_password") or "")
        if not effective_email or not effective_password_hash:
            raise RuntimeError("SUPERADMIN_NOT_CONFIGURED")
        try:
            current_password_ok = verify_password(current_password, effective_password_hash)
        except Exception:
            current_password_ok = False
        if not current_password_ok:
            raise ValueError("INVALID_CURRENT_PASSWORD")

        changed_fields: list[str] = []
        old_values: dict[str, object] = {}
        new_values: dict[str, object] = {}

        async with UnitOfWork() as uow:
            settings_row = (await uow.session.execute(select(SuperadminRuntimeSettings).limit(1))).scalars().first()
            if settings_row is None:
                settings_row = SuperadminRuntimeSettings()
                uow.session.add(settings_row)
                await uow.session.flush()

            secret_row = (await uow.session.execute(select(SuperadminRuntimeSecret).limit(1))).scalars().first()
            if secret_row is None:
                secret_row = SuperadminRuntimeSecret()
                uow.session.add(secret_row)
                await uow.session.flush()

            if payload.get("email") is not None:
                next_email = self._normalize_email(payload.get("email"))
                if next_email and next_email != effective_email:
                    old_values["email"] = effective_email
                    settings_row.email = next_email
                    new_values["email"] = next_email
                    changed_fields.append("email")

            if payload.get("new_password") is not None:
                next_password = str(payload.get("new_password") or "")
                old_values["password_configured"] = bool(effective_password_hash)
                secret_row.password_hash = hash_password(next_password)
                new_values["password_configured"] = True
                changed_fields.append("password")

            if changed_fields:
                uow.session.add(
                    SuperadminRuntimeAudit(
                        actor=(changed_by or effective_email or "superadmin").strip() or "superadmin",
                        ip_address=(ip_address or "").strip() or None,
                        changed_fields=changed_fields,
                        meta={"old": old_values, "new": new_values},
                    )
                )

            await uow.commit()

        return await self.get_profile()

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
        e = SuperadminAuthService._normalize_email(email) or "-"
        ip = (ip_address or "").strip() or "-"
        return f"superadmin:auth:{e}:{ip}"

    @staticmethod
    def _normalize_email(email: str | None) -> str:
        return (email or "").strip().lower()

    async def _resolve_credentials(self) -> dict[str, str]:
        try:
            async with UnitOfWork() as uow:
                settings_row = (await uow.session.execute(select(SuperadminRuntimeSettings).limit(1))).scalars().first()
                secret_row = (await uow.session.execute(select(SuperadminRuntimeSecret).limit(1))).scalars().first()
        except SQLAlchemyError:
            settings_row = None
            secret_row = None

        runtime_email = self._normalize_email(settings_row.email if settings_row else "")
        runtime_password_hash = str(secret_row.password_hash or "").strip() if secret_row else ""
        env_email = self._normalize_email(settings.SUPERADMIN_EMAIL)
        env_password_hash = str(settings.SUPERADMIN_PASSWORD_HASH or "").strip()
        return {
            "email": runtime_email or env_email,
            "password_hash": runtime_password_hash or env_password_hash,
        }

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
