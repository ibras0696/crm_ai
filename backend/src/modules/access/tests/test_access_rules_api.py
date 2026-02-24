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
            "accepted_privacy_policy": True,
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


@pytest.mark.asyncio
async def test_access_rules_crud_owner(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules CRUD Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    # create
    created = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "resource_id": None,
            "role": "employee",
            "can_read": True,
            "can_write": False,
            "can_delete": False,
        },
        headers=_headers(token),
    )
    assert created.status_code == 200
    rule_id = created.json()["data"]["id"]

    # list
    listed = await client.get("/api/v1/access/rules?resource_type=table", headers=_headers(token))
    assert listed.status_code == 200
    assert any(x["id"] == rule_id for x in listed.json()["data"])

    # update
    updated = await client.patch(
        f"/api/v1/access/rules/{rule_id}",
        json={"can_write": True},
        headers=_headers(token),
    )
    assert updated.status_code == 200
    assert updated.json()["data"]["can_write"] is True

    # delete
    deleted = await client.delete(f"/api/v1/access/rules/{rule_id}", headers=_headers(token))
    assert deleted.status_code == 200

    listed2 = await client.get("/api/v1/access/rules?resource_type=table", headers=_headers(token))
    assert listed2.status_code == 200
    assert all(x["id"] != rule_id for x in listed2.json()["data"])


@pytest.mark.asyncio
async def test_access_rules_create_validation_errors_are_api_response(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Validation Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    # invalid type
    bad_type = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "bad", "role": "employee"},
        headers=_headers(token),
    )
    assert bad_type.status_code == 422
    assert bad_type.json()["ok"] is False

    # missing target (role/user_id)
    missing_target = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "role": None, "user_id": None},
        headers=_headers(token),
    )
    assert missing_target.status_code == 422
    assert missing_target.json()["ok"] is False

    # both role and user_id are set (XOR validation)
    both_subjects = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "role": "employee",
            "user_id": str(uuid.uuid4()),
        },
        headers=_headers(token),
    )
    assert both_subjects.status_code == 422
    assert both_subjects.json()["ok"] is False

    # extra field must be rejected by schema (extra=forbid)
    extra_field = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "role": "employee", "unexpected_field": True},
        headers=_headers(token),
    )
    assert extra_field.status_code == 422
    # Pydantic request validation returns standard FastAPI 422 payload ("detail").
    assert "detail" in extra_field.json()


@pytest.mark.asyncio
async def test_access_rules_default_deny_when_rules_exist_but_no_match(client: AsyncClient):
    # Owner
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Default Deny Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    owner_token = reg.json()["data"]["access_token"]

    # Create table
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

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={"token": invite_token, "password": "StrongPass123!", "first_name": "Emp", "last_name": "User"},
    )
    assert acc.status_code == 200
    emp_token = acc.json()["data"]["access_token"]

    # Add a rule for another role; now rules exist for resource_type=table, so default becomes DENY for employees.
    rule = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "resource_id": None, "role": "manager", "can_read": True, "can_write": True},
        headers=_headers(owner_token),
    )
    assert rule.status_code == 200

    # Employee now should be denied even for read.
    r_list = await client.get(f"/api/v1/tables/{table_id}/records/?limit=10&offset=0", headers=_headers(emp_token))
    assert r_list.status_code == 403


@pytest.mark.asyncio
async def test_access_rules_duplicate_scope_subject_rejected(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Unique Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    payload = {
        "resource_type": "table",
        "resource_id": None,
        "role": "employee",
        "can_read": True,
        "can_write": False,
        "can_delete": False,
    }
    first = await client.post("/api/v1/access/rules", json=payload, headers=_headers(token))
    assert first.status_code == 200

    second = await client.post("/api/v1/access/rules", json=payload, headers=_headers(token))
    assert second.status_code == 422
    assert second.json()["ok"] is False


@pytest.mark.asyncio
async def test_access_rules_list_includes_global_for_specific_resource(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules List Scope Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    target_resource_id = str(uuid.uuid4())
    global_rule = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "resource_id": None,
            "role": "employee",
            "can_read": True,
            "can_write": False,
            "can_delete": False,
        },
        headers=_headers(token),
    )
    assert global_rule.status_code == 200
    global_rule_id = global_rule.json()["data"]["id"]

    specific_rule = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "resource_id": target_resource_id,
            "role": "manager",
            "can_read": True,
            "can_write": True,
            "can_delete": False,
        },
        headers=_headers(token),
    )
    assert specific_rule.status_code == 200
    specific_rule_id = specific_rule.json()["data"]["id"]

    listed = await client.get(
        f"/api/v1/access/rules?resource_type=table&resource_id={target_resource_id}",
        headers=_headers(token),
    )
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.json()["data"]}
    assert global_rule_id in ids
    assert specific_rule_id in ids


@pytest.mark.asyncio
async def test_access_rules_list_pagination(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Pagination Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    r1 = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "role": "employee", "can_read": True, "can_write": False},
        headers=_headers(token),
    )
    assert r1.status_code == 200
    r2 = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "role": "manager", "can_read": True, "can_write": True},
        headers=_headers(token),
    )
    assert r2.status_code == 200

    page1 = await client.get("/api/v1/access/rules?resource_type=table&limit=1&offset=0", headers=_headers(token))
    assert page1.status_code == 200
    assert len(page1.json()["data"]) == 1

    page2 = await client.get("/api/v1/access/rules?resource_type=table&limit=1&offset=1", headers=_headers(token))
    assert page2.status_code == 200
    assert len(page2.json()["data"]) == 1

    ids = {page1.json()["data"][0]["id"], page2.json()["data"][0]["id"]}
    assert r1.json()["data"]["id"] in ids
    assert r2.json()["data"]["id"] in ids


@pytest.mark.asyncio
async def test_access_rules_update_empty_payload_rejected(client: AsyncClient):
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Access Rules Update Empty Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    created = await client.post(
        "/api/v1/access/rules",
        json={"resource_type": "table", "role": "employee", "can_read": True, "can_write": False},
        headers=_headers(token),
    )
    assert created.status_code == 200
    rule_id = created.json()["data"]["id"]

    empty_update = await client.patch(f"/api/v1/access/rules/{rule_id}", json={}, headers=_headers(token))
    assert empty_update.status_code == 422
    assert empty_update.json()["ok"] is False
