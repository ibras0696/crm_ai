import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient) -> str:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"appearance-{uuid.uuid4().hex[:8]}@example.com",
            "password": "StrongPass123!",
            "first_name": "Theme",
            "last_name": "User",
            "org_name": "Theme Org",
            "accepted_privacy_policy": True,
        },
    )
    assert response.status_code == 201
    return response.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_appearance_get_and_update(client: AsyncClient):
    token = await _register(client)
    headers = {"Authorization": f"Bearer {token}"}

    defaults = await client.get("/api/v1/appearance", headers=headers)
    assert defaults.status_code == 200
    assert defaults.json()["data"]["mode"] == "dark"

    updated = await client.put(
        "/api/v1/appearance",
        headers=headers,
        json={
            "mode": "light",
            "accent": "violet",
            "custom_enabled": True,
            "primary_h": 260,
            "primary_s": 70,
            "primary_l": 55,
            "radius": 0.75,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["mode"] == "light"

    saved = await client.get("/api/v1/appearance", headers=headers)
    assert saved.status_code == 200
    assert saved.json()["data"]["accent"] == "violet"
