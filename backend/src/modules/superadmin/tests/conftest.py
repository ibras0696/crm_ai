import pytest
import pytest_asyncio

from src.config import settings
from src.infrastructure.redis import get_redis
from src.modules.auth.security import hash_password


@pytest.fixture(autouse=True)
def _superadmin_test_credentials(monkeypatch):
    monkeypatch.setattr(settings, "SUPERADMIN_EMAIL", "admin@test.local")
    monkeypatch.setattr(settings, "SUPERADMIN_PASSWORD_HASH", hash_password("12345678"))


@pytest_asyncio.fixture(autouse=True)
async def _clear_superadmin_auth_throttle():
    async def _clear() -> None:
        try:
            redis = await get_redis()
            keys = await redis.keys("superadmin:auth:*")
            if keys:
                await redis.delete(*keys)
        except Exception:
            # Tests must not fail because Redis is unavailable in local setup.
            return

    await _clear()
    yield
    await _clear()
