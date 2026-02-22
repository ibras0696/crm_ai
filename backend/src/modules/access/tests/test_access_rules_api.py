import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_access_rules_enforce_table_write_for_employee(client: AsyncClient):
    # Register owner (creates org)
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Org",
        },
    )
    assert reg.status_code == 201
    owner_token = reg.json()["data"]["access_token"]

    # Create a table (owner)
    t = await client.post("/api/v1/tables/", json={"name": "T", "description": None}, headers=_headers(owner_token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    # Invite employee
    invited_email = f"emp-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invited_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"]["token"]
    assert invite_token

    # Accept invite (employee token)
    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={"token": invite_token, "password": "StrongPass123!", "first_name": "Emp", "last_name": "User"},
    )
    assert acc.status_code == 200
    emp_token = acc.json()["data"]["access_token"]

    # Owner creates access rule: employees can read tables but cannot write.
    rule = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "resource_id": None,
            "role": "employee",
            "can_read": True,
            "can_write": False,
            "can_delete": False,
        },
        headers=_headers(owner_token),
    )
    assert rule.status_code == 200
    assert rule.json()["ok"] is True

    # Employee can list records (read)
    r_list = await client.get(f"/api/v1/tables/{table_id}/records/?limit=10&offset=0", headers=_headers(emp_token))
    assert r_list.status_code == 200

    # Employee cannot create record (write)
    r_create = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {}}, headers=_headers(emp_token))
    assert r_create.status_code == 403

