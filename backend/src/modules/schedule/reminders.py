"""Reminder helpers for one-off and recurring schedule events."""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta

SUPPORTED_SIMPLE_RECURRENCES = {"daily", "weekly", "monthly", "yearly"}


def normalize_simple_recurrence(value: str | None) -> str | None:
    text = str(value or "").strip().lower()
    if text in SUPPORTED_SIMPLE_RECURRENCES:
        return text
    return None


def advance_occurrence(start_at: datetime, recurrence: str) -> datetime:
    if recurrence == "daily":
        return start_at + timedelta(days=1)
    if recurrence == "weekly":
        return start_at + timedelta(days=7)
    if recurrence == "monthly":
        year = start_at.year + (1 if start_at.month == 12 else 0)
        month = 1 if start_at.month == 12 else start_at.month + 1
        day = min(start_at.day, monthrange(year, month)[1])
        return start_at.replace(year=year, month=month, day=day)
    if recurrence == "yearly":
        year = start_at.year + 1
        day = min(start_at.day, monthrange(year, start_at.month)[1])
        return start_at.replace(year=year, day=day)
    return start_at


def _first_occurrence_at_or_after(base_start: datetime, *, recurrence: str, target: datetime) -> datetime:
    if base_start >= target:
        return base_start

    if recurrence == "daily":
        days = max(0, int((target - base_start).total_seconds() // 86400))
        current = base_start + timedelta(days=days)
    elif recurrence == "weekly":
        weeks = max(0, int((target - base_start).total_seconds() // (7 * 86400)))
        current = base_start + timedelta(days=7 * weeks)
    else:
        current = base_start

    guard = 0
    while current < target and guard < 5000:
        nxt = advance_occurrence(current, recurrence)
        if nxt <= current:
            break
        current = nxt
        guard += 1
    return current


def iter_occurrences_within_window(
    *,
    base_start: datetime,
    recurrence: str,
    window_start: datetime,
    window_end: datetime,
) -> list[datetime]:
    if window_end < window_start:
        return []
    current = _first_occurrence_at_or_after(base_start, recurrence=recurrence, target=window_start)
    occurrences: list[datetime] = []
    guard = 0
    while current <= window_end and guard < 5000:
        occurrences.append(current)
        nxt = advance_occurrence(current, recurrence)
        if nxt <= current:
            break
        current = nxt
        guard += 1
    return occurrences


def build_recurrence_marker(*, occurrence_start: datetime, offset_minutes: int) -> str:
    return f"{occurrence_start.isoformat()}|{int(offset_minutes)}"


def _extract_marker_occurrence(marker: str) -> datetime | None:
    head = str(marker or "").split("|", 1)[0].strip()
    if not head:
        return None
    try:
        return datetime.fromisoformat(head)
    except ValueError:
        return None


def prune_recurrence_markers(
    markers: set[str],
    *,
    now: datetime,
    keep_days: int = 60,
    max_items: int = 2000,
) -> list[str]:
    threshold = now - timedelta(days=max(1, int(keep_days)))
    kept: list[str] = []
    for marker in markers:
        occurrence = _extract_marker_occurrence(marker)
        if occurrence is None or occurrence >= threshold:
            kept.append(marker)
    kept.sort()
    if len(kept) > max_items:
        kept = kept[-max_items:]
    return kept
