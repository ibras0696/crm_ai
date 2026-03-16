from __future__ import annotations

import logging
import secrets
import string
import uuid

from redis.exceptions import RedisError

from src.infrastructure.redis_client import redis_client
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.repository import UserRepository
from src.modules.auth.security import hash_password
from src.modules.notifications.public_api import queue_password_reset_email

logger = logging.getLogger(__name__)


class AuthPasswordService:
    """Password management use-cases."""

    async def request_password_reset(self, email: str) -> None:
        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            user = await repo.get_by_email(email)
            if not user or not user.is_active:
                # To prevent user enumeration, we return silently
                return

            # Generate a secure random token
            alphabet = string.ascii_letters + string.digits
            token = "".join(secrets.choice(alphabet) for _ in range(64))

            # Save token to Redis using CacheService logic manually, or just use raw redis
            redis = await redis_client.get()
            cache_key = f"pwd_reset:{token}"
            try:
                # 30 minutes TTL
                await redis.setex(cache_key, 1800, str(user.id))
            except RedisError as e:
                logger.error(f"Failed to set password reset token in Redis: {e}")
                return

            queue_password_reset_email(to_email=user.email, reset_token=token)

    async def reset_password(self, token: str, new_password: str) -> bool:
        redis = await redis_client.get()
        cache_key = f"pwd_reset:{token}"

        try:
            user_id_str = await redis.get(cache_key)
            if not user_id_str:
                return False

            user_id = uuid.UUID(user_id_str.decode(encoding="utf-8") if isinstance(user_id_str, bytes) else user_id_str)
        except (RedisError, TypeError, ValueError, AttributeError) as e:
            logger.error(f"Failed to get or parse password reset token from Redis: {e}")
            return False

        async with UnitOfWork() as uow:
            repo = UserRepository(uow.session)
            user = await repo.get_by_id(user_id)
            if not user:
                return False

            user.hashed_password = hash_password(new_password)

            await repo.update(user)
            await uow.commit()

        # Delete token after successful use
        try:
            await redis.delete(cache_key)
        except RedisError as e:
            logger.error(f"Failed to delete password reset token from Redis: {e}")

        return True
