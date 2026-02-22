"""
Integration scenario tests: invite member, role assignment, role-based access control.

These tests intentionally cross module boundaries (auth/org/tables/...),
so they live in backend/tests/integration.
"""

import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient, email: str | None = None, org_name: str = "Team Org") -> dict:
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
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    return {"tokens": resp.json()["data"], "email": email}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_invite_member_full_flow(client: AsyncClient):
    owner = await _register(client, org_name="Invite Flow Org")
    owner_token = owner["tokens"]["access_token"]

    invite_email = f"invited-{uuid.uuid4().hex[:8]}@example.com"

    inv_resp = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv_resp.status_code == 201, f"Invite failed: {inv_resp.text}"
    invite_data = inv_resp.json()["data"]
    assert invite_data["email"] == invite_email
    assert invite_data["role"] == "employee"
    assert invite_data["status"] == "pending"


@pytest.mark.asyncio
async def test_invite_duplicate_email(client: AsyncClient):
    owner = await _register(client, org_name="Dup Invite Org")
    owner_token = owner["tokens"]["access_token"]
    invite_email = f"dup-inv-{uuid.uuid4().hex[:8]}@example.com"

    r1 = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert r1.status_code == 201

    r2 = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "manager"},
        headers=_headers(owner_token),
    )
    assert r2.status_code in (409, 400), f"Expected conflict, got {r2.status_code}: {r2.text}"


@pytest.mark.asyncio
async def test_invite_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/orgs/invites", json={"email": "noauth@example.com", "role": "employee"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_invite_employee_cannot_invite(client: AsyncClient):
    owner = await _register(client, org_name="RBAC Org")
    owner_token = owner["tokens"]["access_token"]

    emp_email = f"emp-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": emp_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"].get("token")
    assert invite_token

    emp_reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": emp_email,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
            "org_name": "ignored",
            "invite_token": invite_token,
        },
    )
    assert emp_reg.status_code == 201
    emp_token = emp_reg.json()["data"]["access_token"]

    resp = await client.post(
        "/api/v1/orgs/invites",
        json={"email": "another@example.com", "role": "employee"},
        headers=_headers(emp_token),
    )
    assert resp.status_code == 403, f"Employee should not invite, got {resp.status_code}"


@pytest.mark.asyncio
async def test_create_and_list_tables(client: AsyncClient):
    owner = await _register(client, org_name="Tables Org")
    owner_token = owner["tokens"]["access_token"]

    create_resp = await client.post(
        "/api/v1/tables/",
        json={"name": "Клиенты", "color": "blue"},
        headers=_headers(owner_token),
    )
    assert create_resp.status_code in (200, 201), f"Create table failed: {create_resp.text}"
    table_id = create_resp.json()["data"]["id"]

    list_resp = await client.get("/api/v1/tables/", headers=_headers(owner_token))
    assert list_resp.status_code == 200
    tables = list_resp.json()["data"]
    assert any(t["id"] == table_id for t in tables)

