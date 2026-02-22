"""Обработчики AI-действий для расписания и базы знаний."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from src.infrastructure.uow import UnitOfWork
from src.modules.knowledge.models import KBPage
from src.modules.schedule.models import Event


def _parse_dt(value: str | None) -> datetime | None:
    """Распарсить дату-время (RFC3339/ISO) в datetime (UTC по умолчанию)."""
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def handle_create_schedule_event_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать событие в расписании."""
    title = str(action_payload.get("title") or action_payload.get("name") or "").strip()[:500]
    if not title:
        return {"action": "create_schedule_event", "ok": False, "error": "title_required"}

    start_at = _parse_dt(action_payload.get("start_at"))
    if start_at is None:
        return {"action": "create_schedule_event", "ok": False, "error": "start_at_required"}

    end_at = _parse_dt(action_payload.get("end_at"))
    description = str(action_payload.get("description") or "").strip() or None
    color = str(action_payload.get("color") or "").strip()[:20] or None
    recurrence = str(action_payload.get("recurrence") or "").strip() or None
    all_day = bool(action_payload.get("all_day") or False)

    assigned_to_raw = action_payload.get("assigned_to")
    assigned_to: uuid.UUID | None = None
    try:
        if assigned_to_raw:
            assigned_to = uuid.UUID(str(assigned_to_raw))
    except Exception:
        assigned_to = None
    if assigned_to is None:
        assigned_to = user_id

    event = Event(
        org_id=org_id,
        created_by=user_id,
        assigned_to=assigned_to,
        title=title,
        description=description,
        start_at=start_at,
        end_at=end_at,
        all_day=all_day,
        color=color,
        recurrence=recurrence,
    )
    uow.session.add(event)
    await uow.session.flush()
    return {
        "action": "create_schedule_event",
        "ok": True,
        "event": {
            "id": str(event.id),
            "title": event.title,
            "start_at": event.start_at.isoformat(),
            "end_at": event.end_at.isoformat() if event.end_at else None,
            "recurrence": event.recurrence,
        },
    }


async def handle_create_kb_page_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать страницу базы знаний."""
    title = str(action_payload.get("title") or action_payload.get("name") or "").strip()[:500]
    if not title:
        return {"action": "create_kb_page", "ok": False, "error": "title_required"}

    content = action_payload.get("content")
    if content is not None:
        content = str(content)
    icon = str(action_payload.get("icon") or "").strip() or None

    parent_id_raw = action_payload.get("parent_id")
    parent_id: uuid.UUID | None = None
    try:
        if parent_id_raw:
            parent_id = uuid.UUID(str(parent_id_raw))
    except Exception:
        parent_id = None

    slug = title.lower().replace(" ", "-")[:200]
    page = KBPage(org_id=org_id, created_by=user_id, title=title, slug=slug, content=content, parent_id=parent_id, icon=icon)
    uow.session.add(page)
    await uow.session.flush()
    return {"action": "create_kb_page", "ok": True, "page": {"id": str(page.id), "title": page.title, "slug": page.slug}}

