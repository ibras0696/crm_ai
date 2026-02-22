from __future__ import annotations

import asyncio
from typing import Any

import redis.asyncio as aioredis


class RedisClient:
    def __init__(self, url: str):
        self._url = url
        self._client: aioredis.Redis | None = None
        self._lock = asyncio.Lock()

    async def get(self) -> aioredis.Redis:
        async with self._lock:
            if self._client is None:
                self._client = aioredis.from_url(self._url)
            return self._client

    async def close(self) -> None:
        async with self._lock:
            if self._client is not None:
                await self._client.aclose()
                self._client = None


async def ping_with_timeout(client: aioredis.Redis, timeout_s: float = 2.0) -> Any:
    return await asyncio.wait_for(client.ping(), timeout=timeout_s)

