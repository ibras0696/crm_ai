import uuid

import pytest
from httpx import AsyncClient


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
