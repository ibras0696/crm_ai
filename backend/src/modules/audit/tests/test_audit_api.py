import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, *, org_name: str) -> dict:
    email = f"audit-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Audit",
            "last_name": "User",
            "org_name": org_name,
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]


async def _invite_and_accept(client: AsyncClient, *, owner_token: str, role: str) -> str:
    invite_email = f"audit-invite-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": role},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    token = inv.json()["data"]["token"]

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": token,
            "password": "StrongPass123!",
            "first_name": "Invited",
            "last_name": role.capitalize(),
        },
    )
    assert acc.status_code == 200
    return acc.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_audit_logs_list_owner(client: AsyncClient):
    tokens = await _register(client, org_name="Audit Org")
    token = tokens["access_token"]

    resp = await client.get("/api/v1/audit/logs?limit=20&offset=0", headers=_headers(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert isinstance(body["data"], list)


@pytest.mark.asyncio
async def test_audit_logs_allow_readonly_and_deny_employee(client: AsyncClient):
    owner = await _register(client, org_name="Audit RBAC Org")
    owner_token = owner["access_token"]

    readonly_token = await _invite_and_accept(client, owner_token=owner_token, role="readonly")
    employee_token = await _invite_and_accept(client, owner_token=owner_token, role="employee")

    readonly_resp = await client.get("/api/v1/audit/logs?limit=20&offset=0", headers=_headers(readonly_token))
    assert readonly_resp.status_code == 200
    assert readonly_resp.json()["ok"] is True

    employee_resp = await client.get("/api/v1/audit/logs?limit=20&offset=0", headers=_headers(employee_token))
    assert employee_resp.status_code == 403


@pytest.mark.asyncio
async def test_audit_logs_are_isolated_between_organizations(client: AsyncClient):
    org1 = await _register(client, org_name="Audit Org One")
    org2 = await _register(client, org_name="Audit Org Two")

    logs1 = await client.get("/api/v1/audit/logs?limit=50&offset=0", headers=_headers(org1["access_token"]))
    assert logs1.status_code == 200
    items1 = logs1.json()["data"]
    assert len(items1) > 0
    # Create event in registration writes org_name to meta. Ensure foreign org does not leak.
    assert all((item.get("meta") or {}).get("org_name") != "Audit Org Two" for item in items1)

    logs2 = await client.get("/api/v1/audit/logs?limit=50&offset=0", headers=_headers(org2["access_token"]))
    assert logs2.status_code == 200
    items2 = logs2.json()["data"]
    assert len(items2) > 0
    assert all((item.get("meta") or {}).get("org_name") != "Audit Org One" for item in items2)
