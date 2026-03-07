from __future__ import annotations

import asyncio
from typing import Any

import redis.asyncio as aioredis
from redis.asyncio import ConnectionPool

from src.config import settings


class RedisClient:
    def __init__(self, url: str):
        self._pool = ConnectionPool.from_url(
            url,
            decode_responses=True,
            max_connections=50,
            socket_timeout=5,
            socket_connect_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30
        )
        self._redis = aioredis.Redis(connection_pool=self._pool)

    async def get(self):
        return self._redis

    async def close(self):
        await self._pool.disconnect()


async def ping_with_timeout(client: aioredis.Redis, timeout_s: float = 2.0) -> Any:
    return await asyncio.wait_for(client.ping(), timeout=timeout_s)

# Global synchronous redis client wrapper for background tasks and services
redis_client = RedisClient(settings.REDIS_URL)

