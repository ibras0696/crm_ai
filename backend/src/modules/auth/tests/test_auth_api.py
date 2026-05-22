import uuid
from re import search

import pytest
from httpx import AsyncClient

from src.modules.notifications.public_api import NotificationEnqueueResult


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
async def test_register_uses_accept_language_for_user_locale(client: AsyncClient):
    email = f"locale-reg-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Locale",
            "last_name": "Register",
            "org_name": "Locale Org",
            "accepted_privacy_policy": True,
        },
        headers={"Accept-Language": "en-US,en;q=0.9,ru;q=0.5"},
    )
    assert reg.status_code == 201
    access_token = reg.json()["data"]["access_token"]

    profile = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert profile.status_code == 200
    assert profile.json()["data"]["locale"] == "en"


@pytest.mark.asyncio
async def test_register_falls_back_to_ru_for_unsupported_accept_language(client: AsyncClient):
    email = f"locale-fallback-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Locale",
            "last_name": "Fallback",
            "org_name": "Fallback Org",
            "accepted_privacy_policy": True,
        },
        headers={"Accept-Language": "de-DE,de;q=0.9"},
    )
    assert reg.status_code == 201
    access_token = reg.json()["data"]["access_token"]

    profile = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert profile.status_code == 200
    assert profile.json()["data"]["locale"] == "ru"


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
async def test_register_request_and_confirm_flow(client: AsyncClient):
    email = f"confirm-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "StrongPass123!",
        "first_name": "Mail",
        "last_name": "Confirm",
        "org_name": "Mail Confirm Org",
        "accepted_privacy_policy": True,
    }
    captured: dict[str, str] = {}

    def _capture_registration_email(
        *,
        to_email: str,
        subject: str,
        body: str,
        kind: str = "generic",
        locale: str | None = None,
    ):
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["kind"] = kind
        captured["locale"] = locale or "ru"
        match = search(r"confirm_token=([^\s]+)", body)
        if match:
            captured["token"] = match.group(1)
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.registration.queue_email_notification",
            _capture_registration_email,
        )
        request_resp = await client.post("/api/v1/auth/register/request", json=payload)

    assert request_resp.status_code == 202
    assert request_resp.json()["ok"] is True
    assert captured["to_email"] == email
    assert captured["kind"] == "registration_confirm"
    assert captured["locale"] == "ru"
    assert captured["token"]

    login_before_confirm = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": payload["password"]},
    )
    assert login_before_confirm.status_code == 401

    confirm_resp = await client.post("/api/v1/auth/register/confirm", json={"token": captured["token"]})
    assert confirm_resp.status_code == 201
    assert confirm_resp.json()["ok"] is True
    assert "access_token" in confirm_resp.json()["data"]
    assert "refresh_token" in confirm_resp.json()["data"]

    login_after_confirm = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": payload["password"]},
    )
    assert login_after_confirm.status_code == 200
    assert login_after_confirm.json()["ok"] is True


@pytest.mark.asyncio
async def test_register_request_confirm_preserves_locale(client: AsyncClient):
    email = f"confirm-locale-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "StrongPass123!",
        "first_name": "Locale",
        "last_name": "Confirm",
        "org_name": "Locale Confirm Org",
        "accepted_privacy_policy": True,
    }
    captured: dict[str, str] = {}

    def _capture_registration_email(
        *,
        to_email: str,
        subject: str,
        body: str,
        kind: str = "generic",
        locale: str | None = None,
    ):
        captured["to_email"] = to_email
        captured["subject"] = subject
        captured["kind"] = kind
        captured["locale"] = locale or "ru"
        match = search(r"confirm_token=([^\s]+)", body)
        if match:
            captured["token"] = match.group(1)
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.registration.queue_email_notification",
            _capture_registration_email,
        )
        request_resp = await client.post(
            "/api/v1/auth/register/request",
            json=payload,
            headers={"Accept-Language": "en-US,en;q=0.8"},
        )

    assert request_resp.status_code == 202
    assert captured["locale"] == "en"
    confirm_resp = await client.post("/api/v1/auth/register/confirm", json={"token": captured["token"]})
    assert confirm_resp.status_code == 201
    access_token = confirm_resp.json()["data"]["access_token"]

    profile = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})
    assert profile.status_code == 200
    assert profile.json()["data"]["locale"] == "en"


@pytest.mark.asyncio
async def test_register_request_rate_limit_per_email(client: AsyncClient):
    email = f"ratelimit-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "StrongPass123!",
        "first_name": "Rate",
        "last_name": "Limit",
        "org_name": "Rate Limit Org",
        "accepted_privacy_policy": True,
    }

    def _capture_registration_email(
        *,
        to_email: str,
        subject: str,
        body: str,
        kind: str = "generic",
        locale: str | None = None,
    ):
        _ = subject, body, locale
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.registration.queue_email_notification",
            _capture_registration_email,
        )
        monkeypatch.setattr(
            "src.modules.auth.services.registration.settings.AUTH_REGISTRATION_REQUEST_RPM_PER_EMAIL",
            1,
        )
        monkeypatch.setattr(
            "src.modules.auth.services.registration.settings.AUTH_REGISTRATION_REQUEST_RPM_PER_IP",
            1000,
        )
        first = await client.post("/api/v1/auth/register/request", json=payload)
        second = await client.post("/api/v1/auth/register/request", json=payload)

    assert first.status_code == 202
    assert second.status_code == 429
    assert second.json()["ok"] is False


@pytest.mark.asyncio
async def test_register_confirm_token_is_one_time(client: AsyncClient):
    email = f"confirm-once-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "StrongPass123!",
        "first_name": "One",
        "last_name": "Time",
        "org_name": "One Time Org",
        "accepted_privacy_policy": True,
    }
    captured: dict[str, str] = {}

    def _capture_registration_email(
        *,
        to_email: str,
        subject: str,
        body: str,
        kind: str = "generic",
        locale: str | None = None,
    ):
        _ = to_email, subject, kind, locale
        match = search(r"confirm_token=([^\s]+)", body)
        if match:
            captured["token"] = match.group(1)
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.registration.queue_email_notification",
            _capture_registration_email,
        )
        requested = await client.post("/api/v1/auth/register/request", json=payload)

    assert requested.status_code == 202
    assert captured["token"]

    first_confirm = await client.post("/api/v1/auth/register/confirm", json={"token": captured["token"]})
    second_confirm = await client.post("/api/v1/auth/register/confirm", json={"token": captured["token"]})
    assert first_confirm.status_code == 201
    assert second_confirm.status_code == 400


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
        json={
            "first_name": "New",
            "last_name": "User",
            "timezone": "Europe/Moscow",
            "locale": "en",
            "avatar_url": "/api/v1/files/fake-avatar-id/download",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert upd.status_code == 200
    body = upd.json()
    assert body["ok"] is True
    assert body["data"]["first_name"] == "New"
    assert body["data"]["last_name"] == "User"
    assert body["data"]["timezone"] == "Europe/Moscow"
    assert body["data"]["locale"] == "en"
    assert body["data"]["avatar_url"] == "/api/v1/files/fake-avatar-id/download"


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


@pytest.mark.asyncio
async def test_password_reset_flow_changes_password_and_revokes_refresh_tokens(client: AsyncClient):
    email = f"reset-{uuid.uuid4().hex[:8]}@example.com"
    old_password = "StrongPass123!"
    new_password = "NewStrongPass123!"

    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": old_password,
            "first_name": "Reset",
            "last_name": "User",
            "org_name": "Reset Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    old_refresh = reg.json()["data"]["refresh_token"]

    captured: dict[str, str] = {}

    def _capture_password_reset_email(
        *,
        to_email: str,
        reset_token: str,
        reset_url: str | None = None,
        locale: str | None = None,
    ):
        _ = reset_url
        captured["to_email"] = to_email
        captured["token"] = reset_token
        captured["locale"] = locale or "ru"

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.password.queue_password_reset_email",
            _capture_password_reset_email,
        )
        forgot = await client.post("/api/v1/auth/forgot-password", json={"email": email})

    assert forgot.status_code == 200
    assert forgot.json()["ok"] is True
    assert captured["to_email"] == email
    assert captured["locale"] == "ru"
    assert captured["token"]

    reset = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": captured["token"], "new_password": new_password},
    )
    assert reset.status_code == 200
    assert reset.json()["ok"] is True

    old_login = await client.post("/api/v1/auth/login", json={"email": email, "password": old_password})
    assert old_login.status_code == 401

    new_login = await client.post("/api/v1/auth/login", json={"email": email, "password": new_password})
    assert new_login.status_code == 200
    assert new_login.json()["ok"] is True

    old_refresh_resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert old_refresh_resp.status_code == 401


@pytest.mark.asyncio
async def test_password_reset_token_is_one_time(client: AsyncClient):
    email = f"reset-once-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Reset",
            "last_name": "Once",
            "org_name": "Reset Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201

    captured: dict[str, str] = {}

    def _capture_password_reset_email(
        *,
        to_email: str,
        reset_token: str,
        reset_url: str | None = None,
        locale: str | None = None,
    ):
        _ = to_email, reset_url, locale
        captured["token"] = reset_token

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.password.queue_password_reset_email",
            _capture_password_reset_email,
        )
        forgot = await client.post("/api/v1/auth/forgot-password", json={"email": email})

    assert forgot.status_code == 200
    assert captured["token"]

    first_reset = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": captured["token"], "new_password": "NewStrongPass123!"},
    )
    assert first_reset.status_code == 200

    second_reset = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": captured["token"], "new_password": "AnotherPass123!"},
    )
    assert second_reset.status_code == 400
    assert second_reset.json()["ok"] is False


@pytest.mark.asyncio
async def test_forgot_password_unknown_email_returns_success_and_sends_no_email(client: AsyncClient):
    calls: list[dict[str, str]] = []

    def _capture_password_reset_email(
        *,
        to_email: str,
        reset_token: str,
        reset_url: str | None = None,
        locale: str | None = None,
    ):
        _ = reset_url, locale
        calls.append({"to_email": to_email, "reset_token": reset_token})

    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(
            "src.modules.auth.services.password.queue_password_reset_email",
            _capture_password_reset_email,
        )
        forgot = await client.post("/api/v1/auth/forgot-password", json={"email": "unknown-user@example.com"})

    assert forgot.status_code == 200
    assert forgot.json()["ok"] is True
    assert calls == []
