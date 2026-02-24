import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str | None = None, org_name: str = "Test Org") -> dict:
    email = email or f"test-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Test",
            "last_name": "User",
            "org_name": org_name,
        },
    )
    assert resp.status_code == 201
    return resp.json()["data"]


@pytest.mark.asyncio
async def test_get_current_org(client: AsyncClient):
    tokens = await _register(client, org_name="Current Org Test")
    resp = await client.get("/api/v1/orgs/current", headers=_headers(tokens["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["name"] == "Current Org Test"


@pytest.mark.asyncio
async def test_update_current_org_name(client: AsyncClient):
    tokens = await _register(client, org_name="Org Before Rename")
    resp = await client.patch(
        "/api/v1/orgs/current",
        json={"name": "Org After Rename"},
        headers=_headers(tokens["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["name"] == "Org After Rename"


@pytest.mark.asyncio
async def test_get_my_orgs(client: AsyncClient):
    tokens = await _register(client, org_name="My Orgs Test")
    resp = await client.get("/api/v1/orgs/my", headers=_headers(tokens["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert len(body["data"]) >= 1
    assert body["data"][0]["org_name"] == "My Orgs Test"


@pytest.mark.asyncio
async def test_list_members(client: AsyncClient):
    tokens = await _register(client, org_name="Members Test")
    resp = await client.get("/api/v1/orgs/members", headers=_headers(tokens["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert len(body["data"]) == 1
    assert body["data"][0]["role"] == "owner"


@pytest.mark.asyncio
async def test_create_invite_and_accept(client: AsyncClient):
    owner_tokens = await _register(client, org_name="Invite Test Org")
    invite_email = f"invited-{uuid.uuid4().hex[:8]}@example.com"

    inv_resp = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_tokens["access_token"]),
    )
    assert inv_resp.status_code == 201
    invite = inv_resp.json()["data"]
    assert invite["email"] == invite_email
    assert invite["role"] == "employee"
    assert invite["status"] == "pending"
    assert invite.get("token")
    assert invite["invitee_exists"] is False

    # Accept via dedicated endpoint.
    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite["token"],
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
        },
    )
    assert acc.status_code == 200
    emp_token = acc.json()["data"]["access_token"]
    assert emp_token

    # Ensure members list has 2 people now.
    members = await client.get("/api/v1/orgs/members", headers=_headers(owner_tokens["access_token"]))
    assert members.status_code == 200
    assert len(members.json()["data"]) == 2


@pytest.mark.asyncio
async def test_create_invite_marks_registered_user(client: AsyncClient):
    owner_tokens = await _register(client, org_name="Invite Existing User Org")
    existing_email = f"existing-{uuid.uuid4().hex[:8]}@example.com"
    # Create user in another org, so the email exists in system but not in this org.
    await _register(client, email=existing_email, org_name="Another Org")

    inv_resp = await client.post(
        "/api/v1/orgs/invites",
        json={"email": existing_email, "role": "employee"},
        headers=_headers(owner_tokens["access_token"]),
    )
    assert inv_resp.status_code == 201
    invite = inv_resp.json()["data"]
    assert invite["email"] == existing_email
    assert invite["invitee_exists"] is True


@pytest.mark.asyncio
async def test_create_invite_forbidden_for_employee(client: AsyncClient):
    owner_tokens = await _register(client, org_name="RBAC Invite Test")
    emp_email = f"emp-{uuid.uuid4().hex[:8]}@example.com"

    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": emp_email, "role": "employee"},
        headers=_headers(owner_tokens["access_token"]),
    )
    assert inv.status_code == 201
    token = inv.json()["data"]["token"]
    assert token

    # Employee registers into the org using invite_token (supported by auth/register).
    emp_reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": emp_email,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
            "org_name": "ignored",
            "invite_token": token,
        },
    )
    assert emp_reg.status_code == 201
    emp_token = emp_reg.json()["data"]["access_token"]

    # Employee must not be able to invite.
    resp = await client.post(
        "/api/v1/orgs/invites",
        json={"email": "another@example.com", "role": "employee"},
        headers=_headers(emp_token),
    )
    assert resp.status_code == 403
