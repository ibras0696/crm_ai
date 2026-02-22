import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_knowledge_pages_crud_flow(client: AsyncClient):
    email = f"kb-owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Owner",
            "org_name": "Knowledge Org",
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    create = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Первая страница", "content": "Контент"},
        headers=_headers(token),
    )
    assert create.status_code == 200
    assert create.json()["ok"] is True
    page_id = create.json()["data"]["id"]
    assert create.json()["data"]["slug"] == "первая-страница"

    listed = await client.get("/api/v1/knowledge/pages", headers=_headers(token))
    assert listed.status_code == 200
    assert listed.json()["ok"] is True
    assert any(x["id"] == page_id for x in listed.json()["data"])

    loaded = await client.get(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert loaded.status_code == 200
    assert loaded.json()["ok"] is True
    assert loaded.json()["data"]["title"] == "Первая страница"

    updated = await client.patch(
        f"/api/v1/knowledge/pages/{page_id}",
        json={"title": "Обновленная страница", "is_published": False},
        headers=_headers(token),
    )
    assert updated.status_code == 200
    assert updated.json()["ok"] is True
    assert updated.json()["data"]["title"] == "Обновленная страница"
    assert updated.json()["data"]["slug"] == "обновленная-страница"
    assert updated.json()["data"]["is_published"] is False

    deleted = await client.delete(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = await client.get(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert missing.status_code == 200
    assert missing.json()["ok"] is False
    assert missing.json()["error"]["code"] == "NOT_FOUND"
