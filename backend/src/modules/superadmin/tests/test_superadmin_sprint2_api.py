import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.security import hash_password
from src.modules.ai.models import AIUsageLog


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient, *, org_name: str) -> tuple[str, str]:
    email = f"sa-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": org_name,
        },
    )
    assert reg.status_code == 201
    data = reg.json()["data"]
    # Org id is available via /orgs/current; token belongs to created org.
    token = data["access_token"]
    org = await client.get("/api/v1/orgs/current", headers=_h(token))
    assert org.status_code == 200
    org_id = org.json()["data"]["id"]
    return token, org_id


async def _login_sa(client: AsyncClient, monkeypatch) -> str:
    monkeypatch.setattr(settings, "SUPERADMIN_EMAIL", "admin")
    monkeypatch.setattr(settings, "SUPERADMIN_PASSWORD_HASH", hash_password("12345678"))
    r = await client.post("/api/v1/superadmin/login", json={"email": "admin", "password": "12345678"})
    assert r.status_code == 200
    return r.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_superadmin_orgs_pagination_and_filters(client: AsyncClient, monkeypatch):
    sa = await _login_sa(client, monkeypatch)

    # Create 3 orgs
    _, org1 = await _register_owner(client, org_name="Alpha Org")
    tok2, org2 = await _register_owner(client, org_name="Beta Org")
    tok3, org3 = await _register_owner(client, org_name="Gamma Org")

    # Ensure plans exist (test DB uses metadata-only schema).
    from src.infrastructure.uow import UnitOfWork
    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await uow.commit()

    # Cancel subscription for org3 -> sub_status=cancelled
    cancel = await client.post("/api/v1/billing/cancel-subscription", headers=_h(tok3))
    assert cancel.status_code == 200

    # Set org2 plan to business via superadmin
    sp = await client.patch(f"/api/v1/superadmin/orgs/{org2}/plan", json={"plan": "business"}, headers=_h(sa))
    assert sp.status_code == 200

    # Basic page
    page = await client.get("/api/v1/superadmin/orgs?limit=2&offset=0", headers=_h(sa))
    assert page.status_code == 200
    data = page.json()["data"]
    assert data["limit"] == 2
    assert data["offset"] == 0
    assert data["total"] >= 3
    assert len(data["items"]) == 2

    # q filter
    q = await client.get("/api/v1/superadmin/orgs?q=Alpha", headers=_h(sa))
    assert q.status_code == 200
    items = q.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["id"] == org1

    # plan filter
    p = await client.get("/api/v1/superadmin/orgs?plan=business", headers=_h(sa))
    assert p.status_code == 200
    items = p.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["id"] == org2

    # sub_status filter
    s = await client.get("/api/v1/superadmin/orgs?sub_status=cancelled", headers=_h(sa))
    assert s.status_code == 200
    items = s.json()["data"]["items"]
    assert any(x["id"] == org3 for x in items)


@pytest.mark.asyncio
async def test_superadmin_org_detail_and_members(client: AsyncClient, monkeypatch):
    sa = await _login_sa(client, monkeypatch)
    owner_token, org_id = await _register_owner(client, org_name="Detail Org")

    from src.infrastructure.uow import UnitOfWork
    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await uow.commit()

    detail = await client.get(f"/api/v1/superadmin/orgs/{org_id}", headers=_h(sa))
    assert detail.status_code == 200
    d = detail.json()["data"]
    assert d["org"]["id"] == org_id
    assert "usage" in d and d["usage"]["members"] >= 1
    assert "plan_limits" in d

    mem = await client.get(f"/api/v1/superadmin/orgs/{org_id}/members?limit=50&offset=0", headers=_h(sa))
    assert mem.status_code == 200
    md = mem.json()["data"]
    assert md["total"] >= 1
    assert any(x["user"]["email"] for x in md["items"])

    # org audit endpoint should still be accessible for org admins and show plan-change entries later
    org_audit = await client.get("/api/v1/audit/logs?limit=10&offset=0", headers=_h(owner_token))
    assert org_audit.status_code == 200


@pytest.mark.asyncio
async def test_superadmin_plan_change_writes_audit_and_superadmin_can_list_audit(client: AsyncClient, monkeypatch):
    sa = await _login_sa(client, monkeypatch)
    owner_token, org_id = await _register_owner(client, org_name="Audit Org")

    from src.infrastructure.uow import UnitOfWork
    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await uow.commit()

    sp = await client.patch(f"/api/v1/superadmin/orgs/{org_id}/plan", json={"plan": "team"}, headers=_h(sa))
    assert sp.status_code == 200

    # Org-level audit should show it (actor_id is null, meta.superadmin=true)
    logs = await client.get("/api/v1/audit/logs?limit=50&offset=0", headers=_h(owner_token))
    assert logs.status_code == 200
    items = logs.json()["data"]
    assert any((x["entity_type"] == "org_plan" and (x.get("meta") or {}).get("superadmin") is True) for x in items)

    # Superadmin audit endpoint
    sa_logs = await client.get(f"/api/v1/superadmin/audit/logs?org_id={org_id}&limit=50&offset=0", headers=_h(sa))
    assert sa_logs.status_code == 200
    page = sa_logs.json()["data"]
    assert page["total"] >= 1
    assert any(x["entity_type"] == "org_plan" for x in page["items"])


@pytest.mark.asyncio
async def test_superadmin_ai_quick_actions_reset_usage_and_kill_switch(client: AsyncClient, monkeypatch):
    sa = await _login_sa(client, monkeypatch)
    owner_token, org_id = await _register_owner(client, org_name="AI Quick Actions Org")

    # Add a usage row for today.
    async with UnitOfWork() as uow:
        uow.session.add(
            AIUsageLog(
                org_id=uuid.UUID(org_id),
                user_id=None,
                model="test-model",
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                message_preview="quick-actions-test",
                created_at=datetime.now(timezone.utc),
            )
        )
        await uow.commit()

    # Reset org AI usage for today.
    reset = await client.post(f"/api/v1/superadmin/orgs/{org_id}/ai/reset-usage", headers=_h(sa))
    assert reset.status_code == 200
    reset_data = reset.json()["data"]
    assert reset_data["removed_requests"] >= 1
    assert reset_data["removed_tokens"] >= 150

    detail = await client.get(f"/api/v1/superadmin/orgs/{org_id}", headers=_h(sa))
    assert detail.status_code == 200
    assert detail.json()["data"]["ai_usage_today"]["tokens_used"] == 0

    # Disable AI for org and verify /ai/chat is blocked with AI_DISABLED.
    disable = await client.patch(
        f"/api/v1/superadmin/orgs/{org_id}/ai-enabled",
        json={"enabled": False},
        headers=_h(sa),
    )
    assert disable.status_code == 200
    assert disable.json()["data"]["ai_enabled"] is False

    chat = await client.post(
        "/api/v1/ai/chat",
        json={"message": "test", "include_context": False},
        headers=_h(owner_token),
    )
    assert chat.status_code == 200
    assert chat.json()["ok"] is False
    assert chat.json()["error"]["code"] == "AI_DISABLED"

    # Re-enable for completeness.
    enable = await client.patch(
        f"/api/v1/superadmin/orgs/{org_id}/ai-enabled",
        json={"enabled": True},
        headers=_h(sa),
    )
    assert enable.status_code == 200
    assert enable.json()["data"]["ai_enabled"] is True
