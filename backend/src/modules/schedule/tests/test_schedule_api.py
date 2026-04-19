import uuid

import pytest
from httpx import AsyncClient

from src.modules.notifications.public_api import NotificationEnqueueResult


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"schedule-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": f"Org-{uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_schedule_crud_with_recurrence_string(client: AsyncClient):
    token = await _register_owner(client)

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Lesson",
            "description": "Weekly lesson",
            "start_at": "2026-02-24T10:00:00Z",
            "end_at": "2026-02-24T11:00:00Z",
            "all_day": False,
            "recurrence": "RRULE:FREQ=WEEKLY;BYDAY=TU",
            "color": "#3b82f6",
        },
        headers=_headers(token),
    )
    assert create.status_code == 200
    event = create.json()["data"]
    event_id = event["id"]
    assert event["title"] == "Lesson"

    lst = await client.get("/api/v1/schedule/events", headers=_headers(token))
    assert lst.status_code == 200
    items = lst.json()["data"]
    assert any(e["id"] == event_id for e in items)

    upd = await client.patch(
        f"/api/v1/schedule/events/{event_id}",
        json={"title": "Lesson updated"},
        headers=_headers(token),
    )
    assert upd.status_code == 200
    assert upd.json()["data"]["title"] == "Lesson updated"

    get1 = await client.get(f"/api/v1/schedule/events/{event_id}", headers=_headers(token))
    assert get1.status_code == 200

    dele = await client.delete(f"/api/v1/schedule/events/{event_id}", headers=_headers(token))
    assert dele.status_code == 200


@pytest.mark.asyncio
async def test_schedule_event_participants_reminders_and_dispatch(client: AsyncClient):
    owner_token = await _register_owner(client)

    invite_email = f"schedule-emp-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"]["token"]
    assert invite_token

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
        },
    )
    assert acc.status_code == 200
    emp_token = acc.json()["data"]["access_token"]
    assert emp_token

    members = await client.get("/api/v1/orgs/members", headers=_headers(owner_token))
    assert members.status_code == 200
    member_items = members.json()["data"]
    owner_user_id = next(x["user_id"] for x in member_items if x["role"] == "owner")
    emp_user_id = next(x["user_id"] for x in member_items if x["role"] == "employee")

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Demo call",
            "description": "Reminder scenario",
            "start_at": "2026-02-26T12:00:00Z",
            "end_at": "2026-02-26T13:00:00Z",
            "all_day": False,
            "assigned_to": emp_user_id,
            "participant_ids": [owner_user_id, emp_user_id],
            "reminder_offsets_minutes": [60, 120, 1440],
        },
        headers=_headers(owner_token),
    )
    assert create.status_code == 200
    assert create.json()["ok"] is True
    event_id = create.json()["data"]["id"]
    assert sorted(create.json()["data"]["participant_ids"]) == sorted([owner_user_id, emp_user_id])

    # Too early: nothing should be created.
    d0 = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-02-25T11:59:00Z"},
        headers=_headers(owner_token),
    )
    assert d0.status_code == 200
    assert d0.json()["data"]["created_notifications"] == 0

    # 1 day before.
    d1 = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-02-25T12:00:00Z"},
        headers=_headers(owner_token),
    )
    assert d1.status_code == 200
    assert d1.json()["data"]["created_notifications"] == 2

    # Re-dispatch same point: no duplicates.
    d1_repeat = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-02-25T12:00:00Z"},
        headers=_headers(owner_token),
    )
    assert d1_repeat.status_code == 200
    assert d1_repeat.json()["data"]["created_notifications"] == 0

    # 2 hours before.
    d2 = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-02-26T10:00:00Z"},
        headers=_headers(owner_token),
    )
    assert d2.status_code == 200
    assert d2.json()["data"]["created_notifications"] == 2

    # 1 hour before.
    d3 = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-02-26T11:00:00Z"},
        headers=_headers(owner_token),
    )
    assert d3.status_code == 200
    assert d3.json()["data"]["created_notifications"] == 2

    owner_notifs = await client.get("/api/v1/notifications/?limit=50&offset=0", headers=_headers(owner_token))
    assert owner_notifs.status_code == 200
    owner_event_notifs = [n for n in owner_notifs.json()["data"] if (n.get("meta") or {}).get("event_id") == event_id]
    assert len(owner_event_notifs) == 3

    emp_notifs = await client.get("/api/v1/notifications/?limit=50&offset=0", headers=_headers(emp_token))
    assert emp_notifs.status_code == 200
    emp_event_notifs = [n for n in emp_notifs.json()["data"] if (n.get("meta") or {}).get("event_id") == event_id]
    assert len(emp_event_notifs) == 3


@pytest.mark.asyncio
async def test_schedule_dispatch_enqueues_email_notifications_for_each_offset_and_participant(client: AsyncClient):
    owner_token = await _register_owner(client)

    invite_email = f"schedule-rem-email-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"]["token"]

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "Email",
        },
    )
    assert acc.status_code == 200

    members = await client.get("/api/v1/orgs/members", headers=_headers(owner_token))
    assert members.status_code == 200
    member_items = members.json()["data"]
    owner_user_id = next(x["user_id"] for x in member_items if x["role"] == "owner")
    emp_user_id = next(x["user_id"] for x in member_items if x["role"] == "employee")

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Email reminder call",
            "description": "Detailed reminder body",
            "start_at": "2026-03-10T12:00:00Z",
            "end_at": "2026-03-10T13:30:00Z",
            "all_day": False,
            "participant_ids": [owner_user_id, emp_user_id],
            "reminder_offsets_minutes": [60, 120, 1440],
        },
        headers=_headers(owner_token),
    )
    assert create.status_code == 200

    calls: list[dict[str, str]] = []

    def _capture_schedule_email(
        *,
        to_email: str,
        subject: str,
        body: str,
        kind: str = "generic",
        locale: str | None = None,
    ):
        calls.append(
            {
                "to_email": to_email,
                "subject": subject,
                "body": body,
                "kind": kind,
                "locale": locale or "ru",
            }
        )
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.schedule.service.queue_email_notification",
            _capture_schedule_email,
        )
        d1 = await client.post(
            "/api/v1/schedule/events/dispatch-reminders",
            json={"now": "2026-03-09T12:00:00Z"},
            headers=_headers(owner_token),
        )
        d2 = await client.post(
            "/api/v1/schedule/events/dispatch-reminders",
            json={"now": "2026-03-10T10:00:00Z"},
            headers=_headers(owner_token),
        )
        d3 = await client.post(
            "/api/v1/schedule/events/dispatch-reminders",
            json={"now": "2026-03-10T11:00:00Z"},
            headers=_headers(owner_token),
        )

    assert d1.status_code == 200
    assert d2.status_code == 200
    assert d3.status_code == 200
    assert d1.json()["data"]["created_notifications"] == 2
    assert d2.json()["data"]["created_notifications"] == 2
    assert d3.json()["data"]["created_notifications"] == 2
    assert len(calls) == 6
    assert all(call["kind"] == "schedule_reminder" for call in calls)
    assert all(call["locale"] in {"ru", "en"} for call in calls)
    assert all("Email reminder call" in call["subject"] for call in calls)
    assert all(("Событие:" in call["body"]) or ("Event:" in call["body"]) for call in calls)


@pytest.mark.asyncio
async def test_schedule_list_hides_events_for_non_participants(client: AsyncClient):
    owner_token = await _register_owner(client)

    invite_email = f"schedule-visibility-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"]["token"]

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "Private",
        },
    )
    assert acc.status_code == 200
    emp_token = acc.json()["data"]["access_token"]

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Private owner event",
            "start_at": "2026-03-11T12:00:00Z",
            "end_at": "2026-03-11T13:00:00Z",
            "all_day": False,
            "participant_ids": [],
            "reminder_offsets_minutes": [60],
        },
        headers=_headers(owner_token),
    )
    assert create.status_code == 200
    event_id = create.json()["data"]["id"]

    owner_list = await client.get("/api/v1/schedule/events", headers=_headers(owner_token))
    assert owner_list.status_code == 200
    assert any(item["id"] == event_id for item in owner_list.json()["data"])

    emp_list = await client.get("/api/v1/schedule/events", headers=_headers(emp_token))
    assert emp_list.status_code == 200
    assert all(item["id"] != event_id for item in emp_list.json()["data"])

    emp_get = await client.get(f"/api/v1/schedule/events/{event_id}", headers=_headers(emp_token))
    assert emp_get.status_code == 200
    assert emp_get.json()["ok"] is False
    assert emp_get.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_schedule_day_limit_10_events(client: AsyncClient):
    token = await _register_owner(client)

    for i in range(10):
        resp = await client.post(
            "/api/v1/schedule/events",
            json={
                "title": f"Event {i}",
                "start_at": f"2026-03-01T{(8 + i):02d}:00:00Z",
                "end_at": f"2026-03-01T{(8 + i):02d}:30:00Z",
                "all_day": False,
            },
            headers=_headers(token),
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    over = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Event overflow",
            "start_at": "2026-03-01T23:00:00Z",
            "end_at": "2026-03-01T23:30:00Z",
            "all_day": False,
        },
        headers=_headers(token),
    )
    assert over.status_code == 200
    assert over.json()["ok"] is False
    assert over.json()["error"]["code"] == "DAY_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_schedule_rejects_invalid_participant_and_reminder_offset(client: AsyncClient):
    token = await _register_owner(client)

    invalid_participant = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Invalid participant",
            "start_at": "2026-03-02T10:00:00Z",
            "end_at": "2026-03-02T11:00:00Z",
            "participant_ids": [str(uuid.uuid4())],
            "all_day": False,
        },
        headers=_headers(token),
    )
    assert invalid_participant.status_code == 200
    assert invalid_participant.json()["ok"] is False
    assert invalid_participant.json()["error"]["code"] == "INVALID_PARTICIPANT"

    invalid_offset = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Invalid reminder",
            "start_at": "2026-03-02T12:00:00Z",
            "end_at": "2026-03-02T13:00:00Z",
            "reminder_offsets_minutes": [30],
            "all_day": False,
        },
        headers=_headers(token),
    )
    assert invalid_offset.status_code == 200
    assert invalid_offset.json()["ok"] is False
    assert invalid_offset.json()["error"]["code"] == "INVALID_REMINDER_OFFSET"


@pytest.mark.asyncio
async def test_schedule_dispatch_skips_unsupported_recurrence_events(client: AsyncClient):
    token = await _register_owner(client)

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Recurring meeting",
            "description": "Should not dispatch direct reminders",
            "start_at": "2026-03-03T12:00:00Z",
            "end_at": "2026-03-03T13:00:00Z",
            "all_day": False,
            "recurrence": "RRULE:FREQ=WEEKLY;BYDAY=TU",
            "reminder_offsets_minutes": [60, 120],
        },
        headers=_headers(token),
    )
    assert create.status_code == 200
    assert create.json()["ok"] is True

    dispatch = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-03-03T11:00:00Z"},
        headers=_headers(token),
    )
    assert dispatch.status_code == 200
    assert dispatch.json()["ok"] is True
    assert dispatch.json()["data"]["created_notifications"] == 0


@pytest.mark.asyncio
async def test_schedule_dispatch_supports_simple_daily_recurrence(client: AsyncClient):
    token = await _register_owner(client)

    create = await client.post(
        "/api/v1/schedule/events",
        json={
            "title": "Daily standup",
            "description": "Recurring reminders must work",
            "start_at": "2026-03-03T12:00:00Z",
            "end_at": "2026-03-03T12:30:00Z",
            "all_day": False,
            "recurrence": "daily",
            "reminder_offsets_minutes": [60],
        },
        headers=_headers(token),
    )
    assert create.status_code == 200
    assert create.json()["ok"] is True
    event_id = create.json()["data"]["id"]

    # Reminder for occurrence on 2026-03-04 12:00Z.
    d1 = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-03-04T11:00:00Z"},
        headers=_headers(token),
    )
    assert d1.status_code == 200
    assert d1.json()["ok"] is True
    assert d1.json()["data"]["created_notifications"] == 1

    # Re-dispatch same instant: no duplicates.
    d1_repeat = await client.post(
        "/api/v1/schedule/events/dispatch-reminders",
        json={"now": "2026-03-04T11:00:00Z"},
        headers=_headers(token),
    )
    assert d1_repeat.status_code == 200
    assert d1_repeat.json()["ok"] is True
    assert d1_repeat.json()["data"]["created_notifications"] == 0

    notifs = await client.get("/api/v1/notifications/?limit=50&offset=0", headers=_headers(token))
    assert notifs.status_code == 200
    event_notifs = [n for n in notifs.json()["data"] if (n.get("meta") or {}).get("event_id") == event_id]
    assert len(event_notifs) == 1
