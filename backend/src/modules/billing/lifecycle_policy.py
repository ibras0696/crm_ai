from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class FreePlanLimits:
    max_tables: int
    max_records: int
    max_storage_bytes: int


def should_send_post_expiry_notice(
    *,
    now_utc: datetime,
    period_end: datetime,
    grace_end: datetime,
    last_sent_at: datetime | None,
    reminder_delta: timedelta,
) -> bool:
    if now_utc < period_end or now_utc >= grace_end:
        return False
    if last_sent_at is None:
        return True
    return (now_utc - last_sent_at) >= reminder_delta
