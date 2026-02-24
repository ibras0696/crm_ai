import uuid

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient, random_email: str):
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "StrongPass123!",
            "first_name": "Test",
            "last_name": "User",
            "org_name": "Test Org",
            "accepted_privacy_policy": True,
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["ok"] is True
    assert "access_token" in body["data"]
    assert "refresh_token" in body["data"]
    assert body["data"]["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_register_requires_privacy_consent(client: AsyncClient, random_email: str):
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "StrongPass123!",
            "first_name": "No",
            "last_name": "Consent",
            "org_name": "No Consent Org",
            "accepted_privacy_policy": False,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    email = f"dup-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "StrongPass123!",
        "first_name": "Test",
        "last_name": "User",
        "org_name": "Dup Org",
            "accepted_privacy_policy": True,
    }
    resp1 = await client.post("/api/v1/auth/register", json=payload)
    assert resp1.status_code == 201

    resp2 = await client.post("/api/v1/auth/register", json=payload)
    assert resp2.status_code == 409
    assert resp2.json()["ok"] is False
    assert resp2.json()["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    email = f"login-{uuid.uuid4().hex[:8]}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Login",
            "last_name": "Test",
            "org_name": "Login Org",
            "accepted_privacy_policy": True,
        },
    )

    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "access_token" in body["data"]


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    email = f"badpw-{uuid.uuid4().hex[:8]}@example.com"
    await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Bad",
            "last_name": "PW",
            "org_name": "Bad PW Org",
            "accepted_privacy_policy": True,
        },
    )

    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword!"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_login_short_password_validation(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login", json={"email": "short@example.com", "password": "1234567"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_me_endpoint(client: AsyncClient):
    email = f"me-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Me",
            "last_name": "Test",
            "org_name": "Me Org",
            "accepted_privacy_policy": True,
        },
    )
    token = reg.json()["data"]["access_token"]

    resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["email"] == email


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_update_me_profile(client: AsyncClient):
    email = f"upd-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Old",
            "last_name": "Name",
            "org_name": "Upd Org",
            "accepted_privacy_policy": True,
        },
    )
    token = reg.json()["data"]["access_token"]

    upd = await client.patch(
        "/api/v1/auth/me",
        json={"first_name": "New", "last_name": "User", "timezone": "Europe/Moscow"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upd.status_code == 200
    body = upd.json()
    assert body["ok"] is True
    assert body["data"]["first_name"] == "New"
    assert body["data"]["last_name"] == "User"
    assert body["data"]["timezone"] == "Europe/Moscow"


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    email = f"refresh-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Refresh",
            "last_name": "Test",
            "org_name": "Refresh Org",
            "accepted_privacy_policy": True,
        },
    )
    refresh_tok = reg.json()["data"]["refresh_token"]

    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_tok})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "access_token" in body["data"]
    assert body["data"]["refresh_token"] != refresh_tok  # rotated


@pytest.mark.asyncio
async def test_logout(client: AsyncClient):
    email = f"logout-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Logout",
            "last_name": "Test",
            "org_name": "Logout Org",
            "accepted_privacy_policy": True,
        },
    )
    refresh_tok = reg.json()["data"]["refresh_token"]

    resp = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh_tok})
    assert resp.status_code == 200

    # Refresh should fail after logout.
    resp2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_tok})
    assert resp2.status_code == 401
