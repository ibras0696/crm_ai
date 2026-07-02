import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient, org_name: str = "Calls Org") -> str:
    email = f"calls-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Test",
            "last_name": "User",
            "org_name": org_name,
            "accepted_privacy_policy": True,
        },
    )
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    return resp.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_create_room(client: AsyncClient):
    token = await _register_owner(client, org_name="Calls Create Org")

    resp = await client.post(
        "/api/v1/calls/rooms",
        json={"title": "Team Standup", "max_participants": 10},
        headers=_headers(token),
    )
    assert resp.status_code == 200, f"Create room failed: {resp.text}"
    data = resp.json()
    assert data["ok"] is True
    room = data["data"]
    assert room["title"] == "Team Standup"
    assert room["max_participants"] == 10
    assert room["status"] == "waiting"
    assert "slug" in room
    assert len(room["slug"]) > 0


@pytest.mark.asyncio
async def test_get_room_by_slug(client: AsyncClient):
    token = await _register_owner(client, org_name="Calls Get Org")

    create_resp = await client.post(
        "/api/v1/calls/rooms",
        json={"title": "Daily Sync"},
        headers=_headers(token),
    )
    assert create_resp.status_code == 200, f"Create room failed: {create_resp.text}"
    slug = create_resp.json()["data"]["slug"]

    get_resp = await client.get(
        f"/api/v1/calls/rooms/{slug}",
        headers=_headers(token),
    )
    assert get_resp.status_code == 200, f"Get room failed: {get_resp.text}"
    data = get_resp.json()
    assert data["ok"] is True
    assert data["data"]["slug"] == slug
    assert data["data"]["title"] == "Daily Sync"


@pytest.mark.asyncio
async def test_list_rooms_empty(client: AsyncClient):
    token = await _register_owner(client, org_name="Calls List Org")

    resp = await client.get("/api/v1/calls/rooms", headers=_headers(token))
    assert resp.status_code == 200, f"List rooms failed: {resp.text}"
    data = resp.json()
    assert data["ok"] is True
    assert isinstance(data["data"], list)


@pytest.mark.asyncio
async def test_delete_room(client: AsyncClient):
    token = await _register_owner(client, org_name="Calls Delete Org")

    create_resp = await client.post(
        "/api/v1/calls/rooms",
        json={"title": "Room to Delete"},
        headers=_headers(token),
    )
    assert create_resp.status_code == 200
    slug = create_resp.json()["data"]["slug"]

    del_resp = await client.delete(
        f"/api/v1/calls/rooms/{slug}",
        headers=_headers(token),
    )
    assert del_resp.status_code == 200, f"Delete room failed: {del_resp.text}"
    assert del_resp.json()["ok"] is True

    # Room is permanently gone
    get_resp = await client.get(
        f"/api/v1/calls/rooms/{slug}",
        headers=_headers(token),
    )
    assert get_resp.status_code == 404
