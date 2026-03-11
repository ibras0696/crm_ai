"""Обработчики AI-действий для расписания и базы знаний."""

from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from src.modules.ai.internal.repository import AIRepository
from src.modules.knowledge.models import KBPage
from src.modules.schedule.schemas import CreateEventRequest
from src.modules.schedule.service import ScheduleService, ScheduleServiceError

if TYPE_CHECKING:
    from src.infrastructure.uow import UnitOfWork
    from src.modules.schedule.models import Event


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
    if s.endswith(("Z", "z")):
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
                dt = datetime.strptime(s, fmt).replace(tzinfo=UTC)
                break
            except Exception:
                continue
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _normalize_color(value: str | None) -> str | None:
    """Нормализовать цвет в HEX-формат.

    Args:
        value: Название цвета или HEX-строка.

    Returns:
        Нормализованный HEX (`#rrggbb`) или None.
    """
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


def _extract_color_from_text(text: str | None) -> str | None:
    """Извлечь цвет из пользовательского текста.

    Args:
        text: Исходный текст.

    Returns:
        HEX-цвет или None, если цвет не найден.
    """
    if not text:
        return None
    lowered = str(text).lower()
    aliases = [
        "синий",
        "blue",
        "зеленый",
        "зелёный",
        "green",
        "оранжевый",
        "orange",
        "красный",
        "red",
        "фиолетовый",
        "purple",
        "бирюзовый",
        "cyan",
    ]
    for token in aliases:
        if token in lowered:
            return _normalize_color(token)
    return None


def _default_color_by_weekday(start_at: datetime) -> str:
    """Вернуть цвет по дню недели события.

    Args:
        start_at: Дата/время начала события.

    Returns:
        HEX-цвет из предопределенной палитры.
    """
    palette = [
        "#3b82f6",  # mon
        "#8b5cf6",  # tue
        "#10b981",  # wed
        "#06b6d4",  # thu
        "#f59e0b",  # fri
        "#ef4444",  # sat
        "#6366f1",  # sun
    ]
    target = start_at if start_at.tzinfo is not None else start_at.replace(tzinfo=UTC)
    return palette[target.weekday() % len(palette)]


def _normalize_recurrence(value: str | None) -> str | None:
    """Нормализовать значение повторяемости события.

    Args:
        value: Сырой recurrence/repeat из payload.

    Returns:
        Нормализованное значение recurrence или None.
    """
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
    """Извлечь `start_at` и `end_at` из payload события.

    Args:
        payload: Action payload события.

    Returns:
        Кортеж `(start_at, end_at)`; элементы могут быть None.
    """
    start_raw = payload.get("start_at") or payload.get("startAt") or payload.get("starts_at")
    end_raw = payload.get("end_at") or payload.get("endAt") or payload.get("ends_at")

    # human-friendly aliases
    if start_raw is None:
        start_raw = (
            payload.get("дата_начала") or payload.get("начало") or payload.get("start_date") or payload.get("дата")
        )
    if end_raw is None:
        end_raw = payload.get("дата_конца") or payload.get("конец") or payload.get("end_date")

    start_time = (
        payload.get("время_начала") or payload.get("start_time") or payload.get("time_start") or payload.get("время")
    )
    end_time = payload.get("время_конца") or payload.get("end_time") or payload.get("time_end")

    if start_raw and start_time and "T" not in str(start_raw) and " " not in str(start_raw):
        start_raw = f"{start_raw} {start_time}"
    if end_raw and end_time and "T" not in str(end_raw) and " " not in str(end_raw):
        end_raw = f"{end_raw} {end_time}"

    return _parse_dt(start_raw), _parse_dt(end_raw)


def _extract_reminders(payload: dict[str, Any]) -> list[int]:
    """Извлечь напоминания в минутах из payload.

    Args:
        payload: Action payload события.

    Returns:
        Список уникальных оффсетов напоминаний в минутах.
    """
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
            continue
        if ("2" in s and "час" in s) or ("два" in s and "час" in s):
            result.append(120)
            continue
        if "день" in s or "сутк" in s:
            result.append(1440)
            continue
        if "час" in s:
            result.append(60)
            continue
        for marker, marker_value in alias.items():
            if marker in s:
                result.append(marker_value)
                break
    # uniq + stable order
    out: list[int] = []
    for x in result:
        if x not in out:
            out.append(x)
    return out


def _extract_participant_refs(payload: dict[str, Any]) -> tuple[list[uuid.UUID], list[str]]:
    """Извлечь участников события в виде UUID и строковых референсов.

    Args:
        payload: Action payload события.

    Returns:
        Кортеж `(participant_ids, participant_refs)`.
    """
    raw = (
        payload.get("participant_ids")
        or payload.get("participants")
        or payload.get("participantIds")
        or payload.get("участники")
        or payload.get("participants_refs")
        or []
    )
    if not isinstance(raw, list):
        raw = [raw]
    ids: list[uuid.UUID] = []
    refs: list[str] = []
    for value in raw:
        if isinstance(value, dict):
            id_value = value.get("id") or value.get("user_id")
            if id_value:
                try:
                    ids.append(uuid.UUID(str(id_value)))
                    continue
                except Exception:
                    pass
            name_value = value.get("name") or value.get("full_name")
            email_value = value.get("email")
            if email_value:
                refs.append(str(email_value).strip())
            elif name_value:
                refs.append(str(name_value).strip())
            continue
        text = str(value or "").strip()
        if not text:
            continue
        try:
            ids.append(uuid.UUID(text))
            continue
        except Exception:
            refs.append(text)
    return ids, refs


def _normalize_schedule_items(action_payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Нормализовать payload расписания в список однотипных элементов.

    Args:
        action_payload: Action payload с событием или массивом `events`.

    Returns:
        Список payload-элементов событий.
    """
    items_raw = action_payload.get("events")
    if isinstance(items_raw, list) and items_raw:
        items: list[dict[str, Any]] = []
        for item in items_raw:
            if isinstance(item, dict):
                merged = dict(action_payload)
                merged.update(item)
                merged.pop("events", None)
                items.append(merged)
        return items
    return [action_payload]


async def handle_create_schedule_event_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать одно или несколько событий в расписании."""
    repo = AIRepository(uow.session)
    service = ScheduleService(uow.session)
    normalized_items = _normalize_schedule_items(action_payload)

    event_payloads: list[CreateEventRequest] = []
    day_buckets: Counter[datetime] = Counter()
    unresolved_participants: set[str] = set()
    org_users = await repo.list_org_users(org_id=org_id)

    for item in normalized_items:
        title = str(item.get("title") or item.get("name") or "").strip()[:500]
        if not title:
            return {"action": "create_schedule_event", "ok": False, "error": "title_required"}

        start_at, end_at = _extract_start_end(item)
        if start_at is None:
            return {"action": "create_schedule_event", "ok": False, "error": "start_at_required"}

        explicit_color = _normalize_color(
            str(item.get("color") or item.get("color_hex") or item.get("цвет") or "").strip() or None
        )
        inferred_color = _extract_color_from_text(user_message)
        color = explicit_color or inferred_color or _default_color_by_weekday(start_at)

        recurrence = _normalize_recurrence(
            str(item.get("recurrence") or item.get("repeat") or item.get("повтор") or "").strip() or None
        )
        all_day = bool(item.get("all_day") or item.get("весь_день") or False)
        reminders = _extract_reminders(item)
        if not reminders:
            reminders = _extract_reminders({"напомнить_за": user_message})

        assigned_to_raw = (
            item.get("assigned_to") or item.get("assignedTo") or item.get("assignee_id") or item.get("исполнитель")
        )
        assigned_to: uuid.UUID | None = None
        try:
            if assigned_to_raw:
                assigned_to = uuid.UUID(str(assigned_to_raw))
        except Exception:
            assigned_to = None
        if assigned_to is None:
            assigned_to = user_id

        participant_ids, participant_refs = _extract_participant_refs(item)
        if participant_refs:
            for ref in participant_refs:
                clean_ref = str(ref or "").strip().lower()
                if not clean_ref:
                    continue
                matched_id: uuid.UUID | None = None
                for candidate_id, email, first_name, last_name in org_users:
                    full_name = f"{first_name} {last_name}".strip().lower()
                    rev_name = f"{last_name} {first_name}".strip().lower()
                    if clean_ref in (
                        email.lower(),
                        first_name.lower(),
                        last_name.lower(),
                        full_name,
                        rev_name,
                    ):
                        matched_id = candidate_id
                        break
                if matched_id is None:
                    unresolved_participants.add(ref)
                elif matched_id not in participant_ids:
                    participant_ids.append(matched_id)

        if unresolved_participants:
            missing = ", ".join(sorted(unresolved_participants))
            return {
                "action": "create_schedule_event",
                "ok": False,
                "error": "participants_not_found",
                "message": f"Не нашли участников в организации: {missing}",
            }

        if assigned_to and assigned_to not in participant_ids:
            participant_ids.append(assigned_to)
        if user_id not in participant_ids:
            participant_ids.append(user_id)

        day_start, _ = service._day_bounds_utc(start_at)
        day_buckets[day_start] += 1

        event_payloads.append(
            CreateEventRequest(
                title=title,
                description=str(item.get("description") or item.get("описание") or "").strip() or None,
                start_at=start_at,
                end_at=end_at,
                all_day=all_day,
                color=color,
                assigned_to=assigned_to,
                participant_ids=participant_ids,
                reminder_offsets_minutes=reminders,
                recurrence=recurrence,
            )
        )

    # Strict pre-check: если пользователь запросил пачку событий, проверяем вместимость
    # по каждому дню заранее и не создаем ничего при переполнении.
    for day_start, requested_count in day_buckets.items():
        day_end = day_start + timedelta(days=1)
        existing_count = await service.repo.count_events_in_day(
            org_id=org_id,
            day_start=day_start,
            day_end=day_end,
            exclude_event_id=None,
        )
        remaining = max(0, service.MAX_EVENTS_PER_DAY - int(existing_count))
        if requested_count > remaining:
            return {
                "action": "create_schedule_event",
                "ok": False,
                "error": "DAY_LIMIT_EXCEEDED",
                "message": (
                    f"Нельзя создать {requested_count} событий на {day_start.date().isoformat()}: "
                    f"осталось слотов {remaining} из {service.MAX_EVENTS_PER_DAY}."
                ),
            }

    created_events: list[Event] = []
    try:
        async with uow.session.begin_nested():
            for payload in event_payloads:
                event = await service.create_event(
                    org_id=org_id,
                    user_id=user_id,
                    body=payload,
                )
                created_events.append(event)
    except ScheduleServiceError as exc:
        return {
            "action": "create_schedule_event",
            "ok": False,
            "error": exc.code,
            "message": exc.message,
        }

    first = created_events[0]
    return {
        "action": "create_schedule_event",
        "ok": True,
        "event": {
            "id": str(first.id),
            "title": first.title,
            "start_at": first.start_at.isoformat(),
            "end_at": first.end_at.isoformat() if first.end_at else None,
            "recurrence": first.recurrence,
        },
        "events": [
            {
                "id": str(event.id),
                "title": event.title,
                "start_at": event.start_at.isoformat(),
                "end_at": event.end_at.isoformat() if event.end_at else None,
                "recurrence": event.recurrence,
                "color": event.color,
                "participant_ids": [str(x) for x in event.participant_ids],
                "reminder_offsets_minutes": event.reminder_offsets_minutes,
            }
            for event in created_events
        ],
        "events_created": len(created_events),
    }


async def handle_create_kb_page_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Создать страницу(ы) базы знаний, включая древовидную структуру."""
    _ = user_message
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
        """Рекурсивно создать узел KB-дерева и его дочерние узлы.

        Args:
            node: Нормализованный узел страницы KB.
            parent: ID родительской страницы.

        Returns:
            None.
        """
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

        for child in node.get("children") or []:
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


async def handle_edit_kb_page_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Отредактировать существующую страницу базы знаний."""
    _ = (user_id, user_message)
    repo = AIRepository(uow.session)
    page_id_raw = action_payload.get("page_id") or action_payload.get("id")
    if not page_id_raw:
        return {"action": "edit_kb_page", "ok": False, "error": "page_id_required"}

    try:
        page_id = uuid.UUID(str(page_id_raw))
    except Exception:
        return {"action": "edit_kb_page", "ok": False, "error": "invalid_page_id"}

    page = await repo.get_kb_page_for_org(org_id=org_id, page_id=page_id)
    if not page:
        return {"action": "edit_kb_page", "ok": False, "error": "page_not_found"}

    updated = False
    if action_payload.get("title"):
        title_str = str(action_payload["title"])[:500]
        if page.title != title_str:
            page.title = title_str
            page.slug = _build_kb_slug(title_str)
            updated = True

    if "content" in action_payload:
        content_str = str(action_payload["content"]) if action_payload.get("content") is not None else None
        if page.content != content_str:
            page.content = content_str
            updated = True

    if "icon" in action_payload:
        icon_str = str(action_payload["icon"]).strip()[:50] if action_payload.get("icon") else None
        if page.icon != icon_str:
            page.icon = icon_str
            updated = True

    if updated:
        await uow.session.flush()

    return {
        "action": "edit_kb_page",
        "ok": True,
        "page": {"id": str(page.id), "title": page.title, "slug": page.slug},
        "updated": updated,
    }


async def _resolve_kb_limit(uow: UnitOfWork, *, org_id: uuid.UUID) -> int:
    """Получить лимит страниц KB для организации по тарифу.

    Args:
        uow: UnitOfWork с активной сессией.
        org_id: ID организации.

    Returns:
        Максимально допустимое число страниц KB (0 = без лимита в модели).
    """
    plan = await AIRepository(uow.session).resolve_effective_plan(org_id=org_id)
    # Для KB используем общий лимит записей тарифа.
    return int(getattr(plan, "max_records", 0) or 0)


def _normalize_kb_node(raw: Any) -> dict[str, Any] | None:
    """Нормализовать произвольный узел KB к стандартной структуре.

    Args:
        raw: Сырой объект узла.

    Returns:
        Нормализованный узел или None.
    """
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
    """Извлечь список корневых узлов KB из action payload.

    Args:
        action_payload: Action payload `create_kb_page`.

    Returns:
        Список нормализованных корневых узлов.
    """
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
    """Посчитать количество узлов в KB-поддереве.

    Args:
        node: Нормализованный узел KB.

    Returns:
        Общее число узлов (включая текущий).
    """
    children = node.get("children") or []
    if not isinstance(children, list):
        return 1
    return 1 + sum(_count_kb_nodes(child) for child in children if isinstance(child, dict))


def _build_kb_slug(title: str) -> str:
    """Построить slug страницы KB из заголовка.

    Args:
        title: Заголовок страницы.

    Returns:
        Безопасный slug ограниченной длины.
    """
    raw = (title or "").strip().lower()
    replaced = re.sub(r"\s+", "-", raw)
    cleaned = re.sub(r"[^a-z0-9\-а-яё]", "", replaced)
    collapsed = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if not collapsed:
        return "page"
    return collapsed[:200]
