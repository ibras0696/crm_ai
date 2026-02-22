import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_audit_logs_list_owner(client: AsyncClient):
    email_owner = f"audit-owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Audit Org",
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    resp = await client.get("/api/v1/audit/logs?limit=20&offset=0", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert isinstance(body["data"], list)

