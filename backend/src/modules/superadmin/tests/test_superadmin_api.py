import pytest


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    user_token = reg.json()["data"]["access_token"]

    r = await client.get("/api/v1/superadmin/overview", headers={"Authorization": f"Bearer {user_token}"})
    # User token is signed with user JWT secret/audience, so for superadmin gateway it is invalid auth token.
    assert r.status_code == 401
    assert r.json()["ok"] is False


@pytest.mark.asyncio
async def test_superadmin_login_and_overview(client, random_email):
    # Create some data.
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": random_email,
            "password": "Password123!",
            "first_name": "Owner",
            "last_name": "One",
            "org_name": "Test Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201

    login = await client.post("/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"})
    assert login.status_code == 200
    payload = login.json()
    assert payload["ok"] is True, payload
    sa_token = payload["data"]["access_token"]

    ov = await client.get("/api/v1/superadmin/overview", headers={"Authorization": f"Bearer {sa_token}"})
    assert ov.status_code == 200
    payload = ov.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert "dashboard" in data and "orgs" in data and "generated_at" in data
    assert data["dashboard"]["totals"]["orgs"] >= 1
    assert data["dashboard"]["totals"]["users"] >= 1
    assert isinstance(data["orgs"], list)


@pytest.mark.asyncio
async def test_superadmin_login_short_password_validation(client):
    r = await client.post("/api/v1/superadmin/login", json={"email": "admin", "password": "1234567"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_superadmin_profile_can_update_email_and_password(client):
    login = await client.post("/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"})
    assert login.status_code == 200
    token = login.json()["data"]["access_token"]

    profile = await client.get("/api/v1/superadmin/profile", headers=_h(token))
    assert profile.status_code == 200
    assert profile.json()["data"]["email"] == "admin@test.local"

    update = await client.patch(
        "/api/v1/superadmin/profile",
        json={
            "email": "owner.runtime@example.com",
            "current_password": "12345678",
            "new_password": "NewStrong123!",
        },
        headers=_h(token),
    )
    assert update.status_code == 200
    body = update.json()
    assert body["ok"] is True
    assert body["data"]["email"] == "owner.runtime@example.com"
    assert body["data"]["runtime_email_overridden"] is True
    assert body["data"]["runtime_password_overridden"] is True

    old_login = await client.post(
        "/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"}
    )
    assert old_login.status_code == 200
    assert old_login.json()["ok"] is False

    new_login = await client.post(
        "/api/v1/superadmin/login",
        json={"email": "owner.runtime@example.com", "password": "NewStrong123!"},
    )
    assert new_login.status_code == 200
    assert new_login.json()["ok"] is True


@pytest.mark.asyncio
async def test_superadmin_profile_rejects_wrong_current_password(client):
    login = await client.post("/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"})
    assert login.status_code == 200
    token = login.json()["data"]["access_token"]

    update = await client.patch(
        "/api/v1/superadmin/profile",
        json={
            "email": "blocked.runtime@example.com",
            "current_password": "wrong-password",
        },
        headers=_h(token),
    )
    assert update.status_code == 200
    body = update.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "INVALID_CURRENT_PASSWORD"
