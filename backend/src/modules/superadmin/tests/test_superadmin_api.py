import pytest

from src.config import settings


@pytest.mark.asyncio
async def test_superadmin_requires_auth(client):
    r = await client.get("/api/v1/superadmin/overview")
    assert r.status_code == 401
    assert r.json()["ok"] is False


@pytest.mark.asyncio
async def test_superadmin_forbids_non_superadmin_token(client, random_email):
    # Register a normal user to obtain a non-superadmin token.
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "Password123!",
            "first_name": "User",
            "last_name": "One",
            "org_name": "Org",
        },
    )
    assert reg.status_code == 201
    user_token = reg.json()["data"]["access_token"]

    r = await client.get("/api/v1/superadmin/overview", headers={"Authorization": f"Bearer {user_token}"})
    assert r.status_code == 403
    assert r.json()["ok"] is False


@pytest.mark.asyncio
async def test_superadmin_login_and_overview(client, monkeypatch, random_email):
    monkeypatch.setattr(settings, "SUPERADMIN_EMAIL", "admin")
    monkeypatch.setattr(settings, "SUPERADMIN_PASSWORD", "12345678")

    # Create some data.
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "Password123!",
            "first_name": "Owner",
            "last_name": "One",
            "org_name": "Test Org",
        },
    )
    assert reg.status_code == 201

    login = await client.post("/api/v1/superadmin/login", json={"email": "admin", "password": "12345678"})
    assert login.status_code == 200
    assert login.json()["ok"] is True
    sa_token = login.json()["data"]["access_token"]

    ov = await client.get("/api/v1/superadmin/overview", headers={"Authorization": f"Bearer {sa_token}"})
    assert ov.status_code == 200
    payload = ov.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert "dashboard" in data and "orgs" in data and "generated_at" in data
    assert data["dashboard"]["totals"]["orgs"] >= 1
    assert data["dashboard"]["totals"]["users"] >= 1
    assert isinstance(data["orgs"], list)

