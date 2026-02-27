"""Rate limit для операций сохранения текста в модуле Docs."""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from src.config import settings
from src.infrastructure.redis import get_redis
from src.modules.docs.errors import DocsModuleError

if TYPE_CHECKING:
    import uuid


@dataclass(slots=True)
class _MemoryBucket:
    """In-memory fallback бакет для поминутного лимитера."""

    values: list[float] = field(default_factory=list)


class DocsTextSaveRateLimiter:
    """Поминутный rate limit для endpoint `save-text` (per org/user)."""

    def __init__(self) -> None:
        self.prefix = f"{(settings.RATE_LIMIT_REDIS_PREFIX or 'rate_limit').strip()}:docs:text_save"
        self._memory: dict[str, _MemoryBucket] = defaultdict(_MemoryBucket)

    async def check(self, *, org_id: uuid.UUID, user_id: uuid.UUID, rpm_limit: int) -> None:
        """Проверить лимит сохранений текста за минуту.

        Args:
            org_id: Идентификатор организации.
            user_id: Идентификатор пользователя.
            rpm_limit: Максимум сохранений в минуту (0 = без ограничений).

        Raises:
            DocsModuleError: Если лимит превышен.
        """
        if int(rpm_limit) <= 0:
            return

        now = int(time.time())
        window_start = now - (now % 60)
        retry_after = max(1, 60 - (now - window_start))
        key = f"{self.prefix}:{org_id}:{user_id}:{window_start}"

        try:
            redis = await get_redis()
            current = int(await redis.incr(key))
            if current == 1:
                await redis.expire(key, 120)
            if current > int(rpm_limit):
                raise DocsModuleError(
                    code="RATE_LIMITED",
                    message="Слишком много сохранений текста. Повторите через минуту.",
                    status_code=429,
                )
            return
        except DocsModuleError:
            raise
        except Exception as exc:
            bucket = self._memory[key]
            now_float = time.time()
            bucket.values = [value for value in bucket.values if now_float - value < 60.0]
            if len(bucket.values) >= int(rpm_limit):
                raise DocsModuleError(
                    code="RATE_LIMITED",
                    message=f"Слишком много сохранений текста. Повторите через {retry_after} сек.",
                    status_code=429,
                ) from exc
            bucket.values.append(now_float)


DEFAULT_DOCS_TEXT_SAVE_RATE_LIMITER = DocsTextSaveRateLimiter()
