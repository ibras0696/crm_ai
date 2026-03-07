import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
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
            "accepted_privacy_policy": True,
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


async def _login_sa(client: AsyncClient) -> str:
    r = await client.post("/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True, body
    return body["data"]["access_token"]


@pytest.mark.asyncio
async def test_superadmin_orgs_pagination_and_filters(client: AsyncClient):
    sa = await _login_sa(client)

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
async def test_superadmin_org_detail_and_members(client: AsyncClient):
    sa = await _login_sa(client)
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
async def test_superadmin_plan_change_writes_audit_and_superadmin_can_list_audit(client: AsyncClient):
    sa = await _login_sa(client)
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
async def test_superadmin_ai_quick_actions_reset_usage_and_kill_switch(client: AsyncClient):
    sa = await _login_sa(client)
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
                created_at=datetime.now(UTC),
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


@pytest.mark.asyncio
async def test_superadmin_can_set_subscription_period_by_days(client: AsyncClient):
    sa = await _login_sa(client)
    _, org_id = await _register_owner(client, org_name="Timed Subscription Org")

    resp = await client.patch(
        f"/api/v1/superadmin/orgs/{org_id}/subscription",
        json={"plan": "team", "period_days": 30},
        headers=_h(sa),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    data = body["data"]
    assert data["plan"] == "team"
    assert data["status"] == "active"
    assert data["current_period_start"] is not None
    assert data["current_period_end"] is not None

    detail = await client.get(f"/api/v1/superadmin/orgs/{org_id}", headers=_h(sa))
    assert detail.status_code == 200
    sub = detail.json()["data"]["subscription"]
    assert sub is not None
    assert sub["plan"] == "team"
    assert sub["status"] == "active"
    assert sub["current_period_end"] is not None


@pytest.mark.asyncio
async def test_superadmin_set_subscription_period_validation(client: AsyncClient):
    sa = await _login_sa(client)
    _, org_id = await _register_owner(client, org_name="Timed Subscription Validation Org")

    both = await client.patch(
        f"/api/v1/superadmin/orgs/{org_id}/subscription",
        json={
            "plan": "team",
            "period_days": 30,
            "current_period_end": (datetime.now(UTC) + timedelta(days=45)).isoformat(),
        },
        headers=_h(sa),
    )
    assert both.status_code == 422

    past = await client.patch(
        f"/api/v1/superadmin/orgs/{org_id}/subscription",
        json={
            "plan": "team",
            "current_period_end": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
        },
        headers=_h(sa),
    )
    assert past.status_code == 200
    assert past.json()["ok"] is False
    assert past.json()["error"]["code"] == "INVALID_PERIOD"


@pytest.mark.asyncio
async def test_superadmin_can_manage_billing_config_plans_and_token_packages(client: AsyncClient):
    sa = await _login_sa(client)
    owner_token, owner_org_id = await _register_owner(client, org_name="Billing Org")

    from src.modules.billing.seed import upsert_default_plans, upsert_default_token_packages
    from src.modules.billing.models import TokenPackage

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await upsert_default_token_packages(uow.session)
        pkg = (
            await uow.session.execute(
                select(TokenPackage).where(TokenPackage.code == "pack_50k")
            )
        ).scalars().first()
        assert pkg is not None
        pkg.price_rub_cents = 0
        await uow.commit()

    # Seed one purchase to validate superadmin purchases table.
    purchased = await client.post(
        "/api/v1/billing/tokens/purchase",
        json={"package_code": "pack_50k"},
        headers=_h(owner_token),
    )
    assert purchased.status_code == 200
    assert purchased.json()["ok"] is True

    cfg = await client.get("/api/v1/superadmin/billing/config", headers=_h(sa))
    assert cfg.status_code == 200
    assert cfg.json()["ok"] is True
    data = cfg.json()["data"]
    assert any(p["name"] == "free" for p in data["plans"])
    assert any(p["code"] == "pack_50k" for p in data["token_packages"])
    assert any(p["code"] == "pack_50k" and p["button_text"] == "Перейти к оплате" for p in data["token_packages"])
    assert "yookassa" in data
    assert "recent_purchases" in data
    assert any(p["org_id"] == owner_org_id for p in data["recent_purchases"])

    upd_plan = await client.patch(
        "/api/v1/superadmin/billing/plans/team",
        json={"price_monthly": 159000, "ai_tokens_per_day": 250000, "max_tables": 120},
        headers=_h(sa),
    )
    assert upd_plan.status_code == 200
    assert upd_plan.json()["ok"] is True
    assert upd_plan.json()["data"]["price_monthly"] == 159000
    assert upd_plan.json()["data"]["ai_tokens_per_day"] == 250000
    assert upd_plan.json()["data"]["max_tables"] == 120

    upd_pkg = await client.put(
        "/api/v1/superadmin/billing/token-packages/pack_100k",
        json={
            "display_name": "Пакет 100k PRO",
            "badge_text": "Хит",
            "description": "Подходит для активной команды.",
            "button_text": "Оплатить пакет",
            "payment_note": "Токены поступят сразу после оплаты.",
            "price_caption": "17 ₽ за 1 000 токенов",
            "tokens": 120000,
            "price_rub_cents": 199000,
            "sort_order": 22,
        },
        headers=_h(sa),
    )
    assert upd_pkg.status_code == 200
    assert upd_pkg.json()["ok"] is True
    assert upd_pkg.json()["data"]["tokens"] == 120000
    assert upd_pkg.json()["data"]["price_rub_cents"] == 199000
    assert upd_pkg.json()["data"]["badge_text"] == "Хит"
    assert upd_pkg.json()["data"]["button_text"] == "Оплатить пакет"

    del_pkg = await client.delete("/api/v1/superadmin/billing/token-packages/pack_100k", headers=_h(sa))
    assert del_pkg.status_code == 200
    assert del_pkg.json()["ok"] is True
    assert del_pkg.json()["data"]["is_active"] is False

    upd_yk = await client.patch(
        "/api/v1/superadmin/billing/yookassa",
        json={
            "yookassa_shop_id": "shop-runtime-001",
            "yookassa_secret_key": "runtime-secret-001",
            "yookassa_return_url": "https://example.com/return",
            "yookassa_webhook_url": "https://example.com/webhook",
        },
        headers=_h(sa),
    )
    assert upd_yk.status_code == 200
    assert upd_yk.json()["ok"] is True
    assert upd_yk.json()["data"]["shop_id"] == "shop-runtime-001"
    assert upd_yk.json()["data"]["secret_key_configured"] is True
    assert upd_yk.json()["data"]["secret_key_masked"].startswith("runt")

    import httpx

    class _MockResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("GET", "https://api.yookassa.ru/v3/me")
                resp = httpx.Response(self.status_code, request=req)
                raise httpx.HTTPStatusError("mock error", request=req, response=resp)

        def json(self):
            return self._payload

    class _MockAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str, auth=None):
            assert url == "https://api.yookassa.ru/v3/me"
            assert auth == ("shop-runtime-001", "runtime-secret-001")
            return _MockResponse(200, {"account_id": "acc-1", "test": True})

    from src.modules.superadmin.services import billing as sa_billing_module

    old_async_client = sa_billing_module.httpx.AsyncClient
    sa_billing_module.httpx.AsyncClient = _MockAsyncClient
    try:
        test_yk = await client.post("/api/v1/superadmin/billing/yookassa/test", headers=_h(sa))
    finally:
        sa_billing_module.httpx.AsyncClient = old_async_client

    assert test_yk.status_code == 200
    assert test_yk.json()["ok"] is True
    assert test_yk.json()["data"]["connected"] is True
    assert test_yk.json()["data"]["account_id"] == "acc-1"


@pytest.mark.asyncio
async def test_superadmin_can_update_ai_runtime_config(client: AsyncClient):
    sa = await _login_sa(client)

    before = await client.get("/api/v1/superadmin/ai-config", headers=_h(sa))
    assert before.status_code == 200
    assert before.json()["ok"] is True
    assert "runtime" in before.json()["data"]

    patch = await client.patch(
        "/api/v1/superadmin/ai-config",
        json={
            "model": "gpt-4.1-mini",
            "ai_base_url": "https://example.ai/v1",
            "ai_provider_mode": "openai_compatible",
            "ai_bearer_token": "runtime-secret-token",
            "system_prompt": "Отвечай кратко и по делу.",
            "temperature": 0.4,
            "max_tokens_per_request": 1800,
            "strict_actions": True,
        },
        headers=_h(sa),
    )
    assert patch.status_code == 200
    assert patch.json()["ok"] is True
    runtime = patch.json()["data"]["runtime"]
    assert runtime["model"] == "gpt-4.1-mini"
    assert runtime["ai_base_url"] == "https://example.ai/v1"
    assert runtime["ai_provider_mode"] == "openai_compatible"
    assert runtime["ai_bearer_token_configured"] is True
    assert runtime["ai_bearer_token_masked"].startswith("runt")
    assert runtime["system_prompt"] == "Отвечай кратко и по делу."
    assert float(runtime["temperature"]) == 0.4
    assert int(runtime["max_tokens_per_request"]) == 1800
    assert runtime["strict_actions"] is True
    assert patch.json()["data"]["audit"]
    assert "ai_bearer_token" in (patch.json()["data"]["audit"][0]["changed_fields"] or [])
