from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from src.config import settings


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_auth_cookie_session_flow(client, random_email):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "Password123!",
            "first_name": "Cookie",
            "last_name": "User",
            "org_name": "Cookie Org",
        },
    )
    assert reg.status_code == 201
    set_cookies = reg.headers.get_list("set-cookie")
    assert any(settings.AUTH_ACCESS_COOKIE_NAME in c and "HttpOnly" in c for c in set_cookies)
    assert any(settings.AUTH_REFRESH_COOKIE_NAME in c and "HttpOnly" in c for c in set_cookies)

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["ok"] is True
    assert me.json()["data"]["email"] == random_email


@pytest.mark.asyncio
async def test_user_endpoint_rejects_bad_access_claims(client):
    now = datetime.now(UTC)
    secret = (settings.JWT_USER_SECRET_KEY or "").strip() or settings.SECRET_KEY

    token_bad_aud = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "type": "access",
            "iss": settings.JWT_ISSUER,
            "aud": "wrong-audience",
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )
    r1 = await client.get("/api/v1/auth/me", headers=_auth(token_bad_aud))
    assert r1.status_code == 401

    token_bad_type = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "type": "refresh",
            "iss": settings.JWT_ISSUER,
            "aud": settings.JWT_AUDIENCE_USER,
            "iat": now,
            "exp": now + timedelta(minutes=5),
        },
        secret,
        algorithm=settings.JWT_ALGORITHM,
    )
    r2 = await client.get("/api/v1/auth/me", headers=_auth(token_bad_type))
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_tenant_isolation_for_tables(client):
    reg1 = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"tenant-a-{uuid.uuid4().hex[:8]}@example.com",
            "password": "Password123!",
            "first_name": "Tenant",
            "last_name": "A",
            "org_name": "Tenant A Org",
        },
    )
    token1 = reg1.json()["data"]["access_token"]

    reg2 = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"tenant-b-{uuid.uuid4().hex[:8]}@example.com",
            "password": "Password123!",
            "first_name": "Tenant",
            "last_name": "B",
            "org_name": "Tenant B Org",
        },
    )
    token2 = reg2.json()["data"]["access_token"]

    created = await client.post("/api/v1/tables/", json={"name": "Private Table"}, headers=_auth(token1))
    assert created.status_code == 200
    table_id = created.json()["data"]["id"]

    denied = await client.get(f"/api/v1/tables/{table_id}", headers=_auth(token2))
    assert denied.status_code == 200
    assert denied.json()["ok"] is False
    assert denied.json()["error"]["code"] in {"NOT_FOUND", "FORBIDDEN"}


@pytest.mark.asyncio
async def test_acl_deny_rule_blocks_employee_read(client):
    owner_email = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg_owner = await client.post(
        "/api/v1/auth/register",
        json={
            "email": owner_email,
            "password": "Password123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "ACL Org",
        },
    )
    owner_token = reg_owner.json()["data"]["access_token"]

    created = await client.post("/api/v1/tables/", json={"name": "ACL Table"}, headers=_auth(owner_token))
    assert created.status_code == 200
    table_id = created.json()["data"]["id"]

    employee_email = f"employee-{uuid.uuid4().hex[:8]}@example.com"
    invite = await client.post(
        "/api/v1/orgs/invites",
        json={"email": employee_email, "role": "employee"},
        headers=_auth(owner_token),
    )
    assert invite.status_code == 201
    invite_token = invite.json()["data"]["token"]

    accepted = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "Password123!",
            "first_name": "Emp",
            "last_name": "Loyee",
        },
    )
    assert accepted.status_code == 200
    employee_token = accepted.json()["data"]["access_token"]

    deny = await client.post(
        "/api/v1/access/rules",
        json={
            "resource_type": "table",
            "resource_id": table_id,
            "role": "employee",
            "can_read": False,
            "can_write": False,
            "can_delete": False,
        },
        headers=_auth(owner_token),
    )
    assert deny.status_code == 200

    denied = await client.get(f"/api/v1/tables/{table_id}", headers=_auth(employee_token))
    assert denied.status_code == 403
