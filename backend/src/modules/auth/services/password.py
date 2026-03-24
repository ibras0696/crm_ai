from __future__ import annotations

import logging
import secrets
import uuid
from hashlib import sha256

from redis.exceptions import RedisError

from src.config import settings
from src.infrastructure.redis_client import redis_client
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.repository import RefreshTokenRepository, UserRepository
from src.modules.auth.security import hash_password
from src.modules.notifications.public_api import queue_password_reset_email

logger = logging.getLogger(__name__)


class AuthPasswordService:
    """Password management use-cases."""

    @staticmethod
    def _reset_token_cache_key(token: str) -> str:
        token_hash = sha256(str(token).encode("utf-8")).hexdigest()
        return f"pwd_reset:{token_hash}"

    async def request_password_reset(self, email: str) -> None:
        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            user = await repo.get_by_email(email)
            if not user or not user.is_active:
                # To prevent user enumeration, we return silently
                return

            token = secrets.token_urlsafe(max(32, int(settings.AUTH_PASSWORD_RESET_TOKEN_BYTES)))

            redis = await redis_client.get()
            cache_key = self._reset_token_cache_key(token)
            try:
                await redis.setex(cache_key, int(settings.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS), str(user.id))
            except RedisError:
                logger.exception("Failed to set password reset token in Redis")
                return

            queue_password_reset_email(to_email=user.email, reset_token=token)

    async def reset_password(self, token: str, new_password: str) -> bool:
        redis = await redis_client.get()
        cache_key = self._reset_token_cache_key(token)

        try:
            # Atomic one-time token consumption.
            user_id_str = await redis.getdel(cache_key)
        except (AttributeError, TypeError):
            # Compatibility fallback for redis versions without GETDEL.
            try:
                user_id_str = await redis.get(cache_key)
                if user_id_str:
                    await redis.delete(cache_key)
            except RedisError:
                logger.exception("Failed to get or delete password reset token from Redis")
                return False
        except RedisError:
            logger.exception("Failed to consume password reset token from Redis")
            return False

        try:
            if not user_id_str:
                return False

            user_id = uuid.UUID(str(user_id_str))
        except (TypeError, ValueError):
            logger.exception("Failed to parse password reset token payload")
            return False

        async with UnitOfWork() as uow:
            user_repo = UserRepository(uow.session)
            refresh_repo = RefreshTokenRepository(uow.session)
            user = await user_repo.get_by_id(user_id)
            if not user:
                return False

            user.hashed_password = hash_password(new_password)
            await user_repo.update(user)
            await refresh_repo.revoke_all_for_user(user.id)
            await uow.commit()

        return True
