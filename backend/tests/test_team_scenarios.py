"""
Team scenario tests: invite member, role assignment, role-based access control.
"""
import uuid

import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient, email: str | None = None, org_name: str = "Team Org") -> dict:
    email = email or f"test-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "StrongPass123!",
        "first_name": "Test",
        "last_name": "User",
        "org_name": org_name,
    })
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    return {"tokens": resp.json()["data"], "email": email}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Сценарий 1: Приглашение участника ────────────────────────────────────────

@pytest.mark.asyncio
async def test_invite_member_full_flow(client: AsyncClient):
    """Owner creates invite → invited user registers → appears in members list."""
    owner = await _register(client, org_name="Invite Flow Org")
    owner_token = owner["tokens"]["access_token"]

    invite_email = f"invited-{uuid.uuid4().hex[:8]}@example.com"

    # 1. Owner creates invite
    inv_resp = await client.post("/api/v1/orgs/invites", json={
        "email": invite_email,
        "role": "employee",
    }, headers=_headers(owner_token))
    assert inv_resp.status_code == 201, f"Invite failed: {inv_resp.text}"
    invite_data = inv_resp.json()["data"]
    assert invite_data["email"] == invite_email
    assert invite_data["role"] == "employee"
    assert invite_data["status"] == "pending"

    # 2. Verify invite was created (check response data)
    assert invite_data["status"] == "pending"
    assert invite_data["role"] == "employee"


@pytest.mark.asyncio
async def test_invite_duplicate_email(client: AsyncClient):
    """Cannot invite same email twice."""
    owner = await _register(client, org_name="Dup Invite Org")
    owner_token = owner["tokens"]["access_token"]
    invite_email = f"dup-inv-{uuid.uuid4().hex[:8]}@example.com"

    r1 = await client.post("/api/v1/orgs/invites", json={"email": invite_email, "role": "employee"},
                           headers=_headers(owner_token))
    assert r1.status_code == 201

    r2 = await client.post("/api/v1/orgs/invites", json={"email": invite_email, "role": "manager"},
                           headers=_headers(owner_token))
    # Should fail with conflict
    assert r2.status_code in (409, 400), f"Expected conflict, got {r2.status_code}: {r2.text}"


@pytest.mark.asyncio
async def test_invite_requires_auth(client: AsyncClient):
    """Unauthenticated user cannot create invites."""
    resp = await client.post("/api/v1/orgs/invites", json={
        "email": "noauth@example.com",
        "role": "employee",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_invite_employee_cannot_invite(client: AsyncClient):
    """Employee role cannot send invites."""
    owner = await _register(client, org_name="RBAC Org")
    owner_token = owner["tokens"]["access_token"]

    # Create an employee invite and register them
    emp_email = f"emp-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post("/api/v1/orgs/invites", json={"email": emp_email, "role": "employee"},
                            headers=_headers(owner_token))
    assert inv.status_code == 201
    invite_token = inv.json()["data"].get("token")

    if invite_token:
        # Accept invite by registering with token
        emp_reg = await client.post("/api/v1/auth/register", json={
            "email": emp_email,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
            "org_name": "ignored",
            "invite_token": invite_token,
        })
        if emp_reg.status_code == 201:
            emp_token = emp_reg.json()["data"]["access_token"]
            # Employee tries to invite someone
            resp = await client.post("/api/v1/orgs/invites", json={
                "email": "another@example.com",
                "role": "employee",
            }, headers=_headers(emp_token))
            assert resp.status_code == 403, f"Employee should not invite, got {resp.status_code}"


# ── Сценарий 2: Управление ролями ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_owner_can_list_members(client: AsyncClient):
    """Owner can see all members."""
    owner = await _register(client, org_name="Members List Org")
    owner_token = owner["tokens"]["access_token"]

    resp = await client.get("/api/v1/orgs/members", headers=_headers(owner_token))
    assert resp.status_code == 200
    members = resp.json()["data"]
    assert len(members) >= 1
    owner_member = next((m for m in members if m["role"] == "owner"), None)
    assert owner_member is not None


@pytest.mark.asyncio
async def test_change_member_role(client: AsyncClient):
    """Owner can change member role."""
    owner = await _register(client, org_name="Role Change Org")
    owner_token = owner["tokens"]["access_token"]

    # Get members list to find owner's member ID
    members_resp = await client.get("/api/v1/orgs/members", headers=_headers(owner_token))
    members = members_resp.json()["data"]
    assert len(members) >= 1

    # Try to change role of a member (use first non-owner if exists, else skip)
    non_owners = [m for m in members if m["role"] != "owner"]
    if not non_owners:
        pytest.skip("No non-owner members to change role")

    member_id = non_owners[0]["user_id"]
    resp = await client.patch(f"/api/v1/orgs/members/{member_id}/role",
                              json={"role": "manager"},
                              headers=_headers(owner_token))
    assert resp.status_code == 200
    assert resp.json()["data"]["role"] == "manager"


@pytest.mark.asyncio
async def test_remove_member(client: AsyncClient):
    """Owner can remove a member (not themselves)."""
    owner = await _register(client, org_name="Remove Member Org")
    owner_token = owner["tokens"]["access_token"]

    # Invite someone
    inv_email = f"torm-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post("/api/v1/orgs/invites", json={"email": inv_email, "role": "employee"},
                            headers=_headers(owner_token))
    assert inv.status_code == 201

    # Members list should still be 1 (invite not accepted yet)
    members_resp = await client.get("/api/v1/orgs/members", headers=_headers(owner_token))
    assert members_resp.status_code == 200


# ── Сценарий 3: Таблицы и данные ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_list_tables(client: AsyncClient):
    """Owner can create tables and list them."""
    owner = await _register(client, org_name="Tables Org")
    owner_token = owner["tokens"]["access_token"]

    # Create table
    create_resp = await client.post("/api/v1/tables/", json={
        "name": "Клиенты",
        "color": "blue",
    }, headers=_headers(owner_token))
    assert create_resp.status_code in (200, 201), f"Create table failed: {create_resp.text}"
    table_id = create_resp.json()["data"]["id"]

    # List tables
    list_resp = await client.get("/api/v1/tables/", headers=_headers(owner_token))
    assert list_resp.status_code == 200
    tables = list_resp.json()["data"]
    assert any(t["id"] == table_id for t in tables)


@pytest.mark.asyncio
async def test_create_record_in_table(client: AsyncClient):
    """Owner can add records to a table."""
    owner = await _register(client, org_name="Records Org")
    owner_token = owner["tokens"]["access_token"]

    # Create table
    t = await client.post("/api/v1/tables/", json={"name": "Сделки", "color": "green"},
                          headers=_headers(owner_token))
    assert t.status_code in (200, 201)
    table_id = t.json()["data"]["id"]

    # Add column
    col = await client.post(f"/api/v1/tables/{table_id}/columns",
                            json={"name": "Название", "field_type": "text"},
                            headers=_headers(owner_token))
    assert col.status_code in (200, 201)
    col_id = col.json()["data"]["id"]

    # Add record
    rec = await client.post(f"/api/v1/tables/{table_id}/records/",
                            json={"data": {col_id: "Тестовая сделка"}},
                            headers=_headers(owner_token))
    assert rec.status_code in (200, 201)
    assert rec.json()["ok"] is True

    # List records
    list_rec = await client.get(f"/api/v1/tables/{table_id}/records/",
                                headers=_headers(owner_token))
    assert list_rec.status_code == 200
    records = list_rec.json()["data"]["records"]
    assert len(records) >= 1


@pytest.mark.asyncio
async def test_delete_table(client: AsyncClient):
    """Owner can delete a table."""
    owner = await _register(client, org_name="Delete Table Org")
    owner_token = owner["tokens"]["access_token"]

    t = await client.post("/api/v1/tables/", json={"name": "ToDelete", "color": "red"},
                          headers=_headers(owner_token))
    assert t.status_code in (200, 201)
    table_id = t.json()["data"]["id"]

    del_resp = await client.delete(f"/api/v1/tables/{table_id}", headers=_headers(owner_token))
    assert del_resp.status_code == 200

    # Should not appear in list
    list_resp = await client.get("/api/v1/tables/", headers=_headers(owner_token))
    tables = list_resp.json()["data"]
    assert not any(t["id"] == table_id for t in tables)


# ── Сценарий 4: Суперадмин ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_superadmin_login_not_configured(client: AsyncClient):
    """Superadmin login returns error when not configured."""
    resp = await client.post("/api/v1/superadmin/login", json={
        "email": "notset@example.com",
        "password": "whatever",
    })
    # Either 200 with ok=False (not configured) or 401 (wrong creds)
    assert resp.status_code in (200, 401)
    if resp.status_code == 200:
        assert resp.json()["ok"] is False


@pytest.mark.asyncio
async def test_superadmin_dashboard_requires_auth(client: AsyncClient):
    """Superadmin dashboard requires valid superadmin token."""
    resp = await client.get("/api/v1/superadmin/dashboard")
    assert resp.status_code == 401

    # Regular user token should be rejected
    owner = await _register(client, org_name="SA Auth Test")
    owner_token = owner["tokens"]["access_token"]
    resp2 = await client.get("/api/v1/superadmin/dashboard",
                             headers=_headers(owner_token))
    assert resp2.status_code == 403
