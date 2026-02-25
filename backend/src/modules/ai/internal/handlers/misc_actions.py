"""Обработчики AI-действий для расписания и базы знаний."""

from __future__ import annotations

import uuid
import re
from datetime import UTC, datetime, timezone
from typing import Any

from src.modules.ai.internal.repository import AIRepository
from src.infrastructure.uow import UnitOfWork
from src.modules.knowledge.models import KBPage
from src.modules.schedule.schemas import CreateEventRequest
from src.modules.schedule.service import ScheduleService, ScheduleServiceError


def _parse_dt(value: Any | None) -> datetime | None:
    """Распарсить дату-время (RFC3339/ISO) в datetime (UTC по умолчанию)."""
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt
    s = str(value).strip()
    if not s:
        return None
    s = s.replace(",", " ").replace("  ", " ")
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        dt = None
    if dt is None:
        known_formats = (
            "%d.%m.%Y %H:%M:%S",
            "%d.%m.%Y %H:%M",
            "%d.%m.%Y",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
        )
        for fmt in known_formats:
            try:
                dt = datetime.strptime(s, fmt)
                break
            except Exception:
                continue
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _normalize_color(value: str | None) -> str | None:
    if not value:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    named = {
        "синий": "#3b82f6",
        "blue": "#3b82f6",
        "зеленый": "#10b981",
        "зелёный": "#10b981",
        "green": "#10b981",
        "оранжевый": "#f59e0b",
        "orange": "#f59e0b",
        "красный": "#ef4444",
        "red": "#ef4444",
        "фиолетовый": "#8b5cf6",
        "purple": "#8b5cf6",
        "бирюзовый": "#06b6d4",
        "cyan": "#06b6d4",
    }
    if s in named:
        return named[s]
    if re.fullmatch(r"#[0-9a-f]{6}", s):
        return s
    return None


def _normalize_recurrence(value: str | None) -> str | None:
    if not value:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    if s.startswith("rrule:"):
        return value
    mapping = {
        "daily": "daily",
        "каждый день": "daily",
        "ежедневно": "daily",
        "weekly": "weekly",
        "каждую неделю": "weekly",
        "еженедельно": "weekly",
        "monthly": "monthly",
        "каждый месяц": "monthly",
        "ежемесячно": "monthly",
        "yearly": "yearly",
        "каждый год": "yearly",
        "ежегодно": "yearly",
        "none": None,
        "без повтора": None,
    }
    return mapping.get(s, value)


def _extract_start_end(payload: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    start_raw = payload.get("start_at") or payload.get("startAt") or payload.get("starts_at")
    end_raw = payload.get("end_at") or payload.get("endAt") or payload.get("ends_at")

    # human-friendly aliases
    if start_raw is None:
        start_raw = (
            payload.get("дата_начала")
            or payload.get("начало")
            or payload.get("start_date")
            or payload.get("дата")
        )
    if end_raw is None:
        end_raw = payload.get("дата_конца") or payload.get("конец") or payload.get("end_date")

    start_time = (
        payload.get("время_начала")
        or payload.get("start_time")
        or payload.get("time_start")
        or payload.get("время")
    )
    end_time = payload.get("время_конца") or payload.get("end_time") or payload.get("time_end")

    if start_raw and start_time and "T" not in str(start_raw) and " " not in str(start_raw):
        start_raw = f"{start_raw} {start_time}"
    if end_raw and end_time and "T" not in str(end_raw) and " " not in str(end_raw):
        end_raw = f"{end_raw} {end_time}"

    return _parse_dt(start_raw), _parse_dt(end_raw)


def _extract_reminders(payload: dict[str, Any]) -> list[int]:
    raw = (
        payload.get("reminder_offsets_minutes")
        or payload.get("reminders_minutes")
        or payload.get("reminders")
        or payload.get("remind_offsets")
        or payload.get("напомнить_за")
        or payload.get("напоминания")
        or payload.get("напоминание")
        or payload.get("remind_before")
    )
    if raw is None:
        return []
    if not isinstance(raw, list):
        raw = [raw]

    result: list[int] = []
    alias = {
        "1ч": 60,
        "1 час": 60,
        "час": 60,
        "за 1 час": 60,
        "2ч": 120,
        "2 часа": 120,
        "два часа": 120,
        "за 2 часа": 120,
        "1д": 1440,
        "1 день": 1440,
        "день": 1440,
        "за 1 день": 1440,
    }
    for v in raw:
        if isinstance(v, int):
            if v in (60, 120, 1440):
                result.append(v)
            continue
        s = str(v).strip().lower()
        if not s:
            continue
        if s.isdigit():
            iv = int(s)
            if iv in (60, 120, 1440):
                result.append(iv)
            continue
        if s in alias:
            result.append(alias[s])
    # uniq + stable order
    out: list[int] = []
    for x in result:
        if x not in out:
            out.append(x)
    return out


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

    start_at, end_at = _extract_start_end(action_payload)
    if start_at is None:
        return {"action": "create_schedule_event", "ok": False, "error": "start_at_required"}

    description = str(action_payload.get("description") or action_payload.get("описание") or "").strip() or None
    color = _normalize_color(
        str(
            action_payload.get("color")
            or action_payload.get("color_hex")
            or action_payload.get("цвет")
            or ""
        ).strip()
        or None
    ) or "#3b82f6"
    recurrence = _normalize_recurrence(
        str(action_payload.get("recurrence") or action_payload.get("repeat") or action_payload.get("повтор") or "").strip() or None
    )
    all_day = bool(action_payload.get("all_day") or action_payload.get("весь_день") or False)
    reminders = _extract_reminders(action_payload)

    assigned_to_raw = (
        action_payload.get("assigned_to")
        or action_payload.get("assignedTo")
        or action_payload.get("assignee_id")
        or action_payload.get("исполнитель")
    )
    assigned_to: uuid.UUID | None = None
    try:
        if assigned_to_raw:
            assigned_to = uuid.UUID(str(assigned_to_raw))
    except Exception:
        assigned_to = None
    if assigned_to is None:
        assigned_to = user_id

    participant_ids_raw = (
        action_payload.get("participant_ids")
        or action_payload.get("participants")
        or action_payload.get("participantIds")
        or action_payload.get("участники")
        or []
    )
    participant_ids: list[uuid.UUID] = []
    if isinstance(participant_ids_raw, list):
        for value in participant_ids_raw:
            try:
                participant_ids.append(uuid.UUID(str(value)))
            except Exception:
                continue
    if assigned_to and assigned_to not in participant_ids:
        participant_ids.append(assigned_to)
    if user_id not in participant_ids:
        participant_ids.append(user_id)

    service = ScheduleService(uow.session)
    try:
        event = await service.create_event(
            org_id=org_id,
            user_id=user_id,
            body=CreateEventRequest(
                title=title,
                description=description,
                start_at=start_at,
                end_at=end_at,
                all_day=all_day,
                color=color,
                assigned_to=assigned_to,
                participant_ids=participant_ids,
                reminder_offsets_minutes=reminders,
                recurrence=recurrence,
            ),
        )
    except ScheduleServiceError as exc:
        return {
            "action": "create_schedule_event",
            "ok": False,
            "error": exc.code,
            "message": exc.message,
        }
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
    """Создать страницу(ы) базы знаний, включая древовидную структуру."""
    repo = AIRepository(uow.session)
    nodes = _extract_kb_nodes(action_payload)
    if not nodes:
        return {"action": "create_kb_page", "ok": False, "error": "title_required"}

    parent_id_raw = action_payload.get("parent_id")
    parent_id: uuid.UUID | None = None
    try:
        if parent_id_raw:
            parent_id = uuid.UUID(str(parent_id_raw))
    except Exception:
        parent_id = None
    if parent_id is not None:
        parent = await repo.get_kb_page_for_org(org_id=org_id, page_id=parent_id)
        if parent is None:
            return {"action": "create_kb_page", "ok": False, "error": "parent_not_found"}

    max_kb_pages = await _resolve_kb_limit(uow, org_id=org_id)
    current_kb_pages = await repo.count_kb_pages(org_id=org_id)
    if max_kb_pages > 0 and current_kb_pages >= max_kb_pages:
        return {
            "action": "create_kb_page",
            "ok": False,
            "error": "knowledge_limit_reached",
            "message": "Достигнут лимит тарифа по записям базы знаний.",
        }

    requested_total = sum(_count_kb_nodes(node) for node in nodes)
    remaining_slots = max(0, max_kb_pages - current_kb_pages) if max_kb_pages > 0 else 10_000_000

    created_pages: list[KBPage] = []
    skipped_due_to_limit = 0

    async def _create_node(node: dict[str, Any], parent: uuid.UUID | None) -> None:
        nonlocal remaining_slots, skipped_due_to_limit
        if remaining_slots <= 0:
            skipped_due_to_limit += _count_kb_nodes(node)
            return

        page = KBPage(
            org_id=org_id,
            created_by=user_id,
            title=str(node["title"])[:500],
            slug=_build_kb_slug(str(node["title"])),
            content=(str(node["content"]) if node.get("content") is not None else None),
            parent_id=parent,
            icon=(str(node["icon"]).strip()[:50] if node.get("icon") else None),
        )
        uow.session.add(page)
        await uow.session.flush()
        created_pages.append(page)
        remaining_slots -= 1

        for child in (node.get("children") or []):
            await _create_node(child, page.id)

    for node in nodes:
        await _create_node(node, parent_id)

    if not created_pages:
        return {
            "action": "create_kb_page",
            "ok": False,
            "error": "knowledge_limit_reached",
            "message": "Достигнут лимит тарифа по записям базы знаний.",
        }

    first = created_pages[0]
    return {
        "action": "create_kb_page",
        "ok": True,
        "page": {"id": str(first.id), "title": first.title, "slug": first.slug},
        "created_pages": [
            {
                "id": str(p.id),
                "title": p.title,
                "slug": p.slug,
                "parent_id": str(p.parent_id) if p.parent_id else None,
            }
            for p in created_pages
        ],
        "created_count": len(created_pages),
        "requested_count": requested_total,
        "skipped_count": max(0, skipped_due_to_limit),
    }


async def _resolve_kb_limit(uow: UnitOfWork, *, org_id: uuid.UUID) -> int:
    plan = await AIRepository(uow.session).resolve_effective_plan(org_id=org_id)
    # Для KB используем общий лимит записей тарифа.
    return int(getattr(plan, "max_records", 0) or 0)


def _normalize_kb_node(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    title = str(raw.get("title") or raw.get("name") or "").strip()[:500]
    if not title:
        return None
    content = raw.get("content")
    if content is not None:
        content = str(content)
    icon = str(raw.get("icon") or "").strip() or None
    children_raw = raw.get("children")
    if not isinstance(children_raw, list):
        children_raw = raw.get("pages")
    children: list[dict[str, Any]] = []
    if isinstance(children_raw, list):
        for child in children_raw[:200]:
            norm = _normalize_kb_node(child)
            if norm is not None:
                children.append(norm)
    return {"title": title, "content": content, "icon": icon, "children": children}


def _extract_kb_nodes(action_payload: dict[str, Any]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []

    tree_raw = action_payload.get("tree")
    if isinstance(tree_raw, dict):
        normalized = _normalize_kb_node(tree_raw)
        if normalized is not None:
            nodes.append(normalized)
            return nodes

    root_title = str(action_payload.get("title") or action_payload.get("name") or "").strip()
    pages_raw = action_payload.get("pages")
    if root_title:
        root_node = _normalize_kb_node(
            {
                "title": root_title,
                "content": action_payload.get("content"),
                "icon": action_payload.get("icon"),
                "children": pages_raw if isinstance(pages_raw, list) else [],
            }
        )
        if root_node is not None:
            nodes.append(root_node)
            return nodes

    if isinstance(pages_raw, list):
        for raw in pages_raw[:200]:
            normalized = _normalize_kb_node(raw)
            if normalized is not None:
                nodes.append(normalized)
    return nodes


def _count_kb_nodes(node: dict[str, Any]) -> int:
    children = node.get("children") or []
    if not isinstance(children, list):
        return 1
    return 1 + sum(_count_kb_nodes(child) for child in children if isinstance(child, dict))


def _build_kb_slug(title: str) -> str:
    raw = (title or "").strip().lower()
    replaced = re.sub(r"\s+", "-", raw)
    cleaned = re.sub(r"[^a-z0-9\-а-яё]", "", replaced)
    collapsed = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not collapsed:
        return "page"
    return collapsed[:200]
