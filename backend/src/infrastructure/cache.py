"""Redis caching service with automatic invalidation."""

import hashlib
import json
import logging
from collections.abc import Callable
from functools import wraps
from typing import Any

from src.infrastructure.redis_client import RedisClient

logger = logging.getLogger(__name__)


class CacheService:
    """Redis-based caching service."""

    def __init__(self, redis_client: RedisClient):
        self.redis_client = redis_client

    def _generate_key(self, prefix: str, func_name: str, args: tuple, kwargs: dict) -> str:
        """Generate cache key from function name and arguments."""
        key_parts = [prefix, func_name]

        # Add args
        if args:
            args_str = json.dumps(args, sort_keys=True, default=str)
            key_parts.append(hashlib.md5(args_str.encode()).hexdigest()[:8])

        # Add kwargs
        if kwargs:
            kwargs_str = json.dumps(kwargs, sort_keys=True, default=str)
            key_parts.append(hashlib.md5(kwargs_str.encode()).hexdigest()[:8])

        return ":".join(key_parts)

    def cache(self, ttl: int = 300, key_prefix: str = ""):
        """Decorator for caching function results."""

        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(*args, **kwargs):
                redis = await self.redis_client.get()
                cache_key = self._generate_key(key_prefix, func.__name__, args, kwargs)

                # Try to get from cache
                try:
                    cached = await redis.get(cache_key)
                    if cached:
                        logger.debug(f"Cache hit: {cache_key}")
                        return json.loads(cached)
                except Exception as e:
                    logger.warning(f"Cache get error: {e}")

                # Execute function
                result = await func(*args, **kwargs)

                # Store in cache
                try:
                    await redis.setex(cache_key, ttl, json.dumps(result, default=str))
                    logger.debug(f"Cache set: {cache_key}")
                except Exception as e:
                    logger.warning(f"Cache set error: {e}")

                return result

            return wrapper

        return decorator

    async def invalidate(self, pattern: str):
        """Invalidate cache keys matching pattern."""
        redis = await self.redis_client.get()
        try:
            cursor = 0
            while True:
                cursor, keys = await redis.scan(cursor, match=pattern, count=100)
                if keys:
                    await redis.delete(*keys)
                    logger.info(f"Invalidated {len(keys)} cache keys matching {pattern}")
                if cursor == 0:
                    break
        except Exception as e:
            logger.error(f"Cache invalidation error: {e}")

    async def get(self, key: str) -> Any | None:
        """Get value from cache."""
        redis = await self.redis_client.get()
        try:
            value = await redis.get(key)
            return json.loads(value) if value else None
        except Exception as e:
            logger.warning(f"Cache get error: {e}")
            return None

    async def set(self, key: str, value: Any, ttl: int = 300):
        """Set value in cache."""
        redis = await self.redis_client.get()
        try:
            await redis.setex(key, ttl, json.dumps(value, default=str))
        except Exception as e:
            logger.warning(f"Cache set error: {e}")

    async def delete(self, key: str):
        """Delete key from cache."""
        redis = await self.redis_client.get()
        try:
            await redis.delete(key)
        except Exception as e:
            logger.warning(f"Cache delete error: {e}")
