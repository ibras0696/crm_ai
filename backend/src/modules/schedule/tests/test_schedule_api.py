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

