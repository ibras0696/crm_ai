from __future__ import annotations

from datetime import UTC, datetime


def normalize_lock_timestamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def optimistic_lock_matches(*, current: datetime | None, expected: datetime | None) -> bool:
    return normalize_lock_timestamp(current) == normalize_lock_timestamp(expected)
