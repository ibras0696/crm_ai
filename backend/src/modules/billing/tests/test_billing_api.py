import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.common.enums import NotificationType, PlanTier, SubscriptionStatus
from src.common.runtime_secret import encrypt_runtime_secret
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import BillingRuntimeSecret, BillingRuntimeSettings, TokenPurchase
from src.modules.billing.service import BillingService
from src.modules.notifications.models import Notification
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.tables.models import Table


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"billing-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": f"Org-{uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_billing_plans_and_usage_and_payment_not_configured(client: AsyncClient):
    token = await _register_owner(client)

    # Ensure default plans exist in the test DB (tests create schema from metadata only).
    from src.infrastructure.uow import UnitOfWork
    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await uow.commit()

    plans = await client.get("/api/v1/billing/plans", headers=_headers(token))
    assert plans.status_code == 200
    assert plans.json()["ok"] is True
    items = plans.json()["data"]
    assert isinstance(items, list)
    assert any(p["name"] == "free" for p in items)

    usage = await client.get("/api/v1/billing/usage", headers=_headers(token))
    assert usage.status_code == 200
    data = usage.json()["data"]
    assert "members" in data
    assert "tables" in data
    assert "records" in data
    assert "files" in data

    pay = await client.post(
        "/api/v1/billing/create-payment",
        json={"plan_name": "team", "period": "monthly"},
        headers=_headers(token),
    )
    assert pay.status_code == 200
    body = pay.json()
    assert body["ok"] is False
    assert body["error"]["code"] in {"BILLING_NOT_CONFIGURED", "INVALID_PERIOD"}


@pytest.mark.asyncio
async def test_billing_rejects_yearly_period(client: AsyncClient):
    token = await _register_owner(client)
    pay = await client.post(
        "/api/v1/billing/create-payment",
        json={"plan_name": "team", "period": "yearly"},
        headers=_headers(token),
    )
    assert pay.status_code == 422


@pytest.mark.asyncio
async def test_billing_payment_status_uses_runtime_yookassa_config(client: AsyncClient):
    token = await _register_owner(client)

    async with UnitOfWork() as uow:
        runtime_settings = BillingRuntimeSettings(
            yookassa_shop_id="runtime-shop-status",
            yookassa_return_url="https://runtime.example/return-status",
            yookassa_webhook_url="https://runtime.example/webhook-status",
        )
        runtime_secret = BillingRuntimeSecret(
            yookassa_secret_key_encrypted=encrypt_runtime_secret("runtime-secret-status")
        )
        uow.session.add(runtime_settings)
        uow.session.add(runtime_secret)
        await uow.commit()

    import httpx

    class _MockResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("GET", "https://api.yookassa.ru/v3/payments/pay-status-1")
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

        async def get(self, url: str, auth=None, headers=None):
            assert url == "https://api.yookassa.ru/v3/payments/pay-status-1"
            assert auth == ("runtime-shop-status", "runtime-secret-status")
            return _MockResponse(
                200,
                {
                    "id": "pay-status-1",
                    "status": "succeeded",
                    "paid": True,
                    "amount": {"value": "990.00", "currency": "RUB"},
                    "description": "Пакет AI токенов",
                    "metadata": {"purchase_kind": "token_package"},
                },
            )

    from src.modules.billing import service as billing_service_module

    old_async_client = billing_service_module.httpx.AsyncClient
    billing_service_module.httpx.AsyncClient = _MockAsyncClient
    try:
        resp = await client.get("/api/v1/billing/payments/pay-status-1", headers=_headers(token))
    finally:
        billing_service_module.httpx.AsyncClient = old_async_client

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["payment_id"] == "pay-status-1"
    assert body["data"]["status"] == "succeeded"
    assert body["data"]["paid"] is True


@pytest.mark.asyncio
async def test_billing_create_payment_uses_runtime_yookassa_config(client: AsyncClient):
    token = await _register_owner(client)

    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        runtime_settings = BillingRuntimeSettings(
            yookassa_shop_id="runtime-shop-777",
            yookassa_return_url="https://runtime.example/return",
            yookassa_webhook_url="https://runtime.example/webhook",
        )
        runtime_secret = BillingRuntimeSecret(
            yookassa_secret_key_encrypted=encrypt_runtime_secret("runtime-secret-777")
        )
        uow.session.add(runtime_settings)
        uow.session.add(runtime_secret)
        await uow.commit()

    import httpx

    class _MockResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("POST", "https://api.yookassa.ru/v3/payments")
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

        async def post(self, url: str, json=None, auth=None, headers=None):
            assert url == "https://api.yookassa.ru/v3/payments"
            assert auth == ("runtime-shop-777", "runtime-secret-777")
            assert (json or {}).get("confirmation", {}).get("return_url") == "https://runtime.example/return"
            assert "Idempotence-Key" in (headers or {})
            return _MockResponse(
                200,
                {
                    "id": "pay-runtime-1",
                    "status": "pending",
                    "confirmation": {"confirmation_url": "https://pay.example/redirect"},
                },
            )

    from src.modules.billing import service as billing_service_module

    old_async_client = billing_service_module.httpx.AsyncClient
    billing_service_module.httpx.AsyncClient = _MockAsyncClient
    try:
        pay = await client.post(
            "/api/v1/billing/create-payment",
            json={"plan_name": "team", "period": "monthly"},
            headers=_headers(token),
        )
    finally:
        billing_service_module.httpx.AsyncClient = old_async_client

    assert pay.status_code == 200
    body = pay.json()
    assert body["ok"] is True
    assert body["data"]["payment_id"] == "pay-runtime-1"
    assert body["data"]["confirmation_url"] == "https://pay.example/redirect"


@pytest.mark.asyncio
async def test_purchase_tokens_creates_yookassa_payment_link(client: AsyncClient):
    token = await _register_owner(client)

    from src.modules.billing.seed import upsert_default_token_packages

    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        runtime_settings = BillingRuntimeSettings(
            yookassa_shop_id="runtime-shop-888",
            yookassa_return_url="https://runtime.example/return-token",
            yookassa_webhook_url="https://runtime.example/webhook-token",
        )
        runtime_secret = BillingRuntimeSecret(
            yookassa_secret_key_encrypted=encrypt_runtime_secret("runtime-secret-888")
        )
        uow.session.add(runtime_settings)
        uow.session.add(runtime_secret)
        await uow.commit()

    import httpx

    class _MockResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                req = httpx.Request("POST", "https://api.yookassa.ru/v3/payments")
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

        async def post(self, url: str, json=None, auth=None, headers=None):
            assert url == "https://api.yookassa.ru/v3/payments"
            assert auth == ("runtime-shop-888", "runtime-secret-888")
            assert (json or {}).get("metadata", {}).get("purchase_kind") == "token_package"
            assert (json or {}).get("metadata", {}).get("package_code") == "pack_50k"
            assert "Idempotence-Key" in (headers or {})
            return _MockResponse(
                200,
                {
                    "id": "pay-token-1",
                    "status": "pending",
                    "confirmation": {"confirmation_url": "https://pay.example/token-redirect"},
                },
            )

    from src.modules.billing import service as billing_service_module

    old_async_client = billing_service_module.httpx.AsyncClient
    billing_service_module.httpx.AsyncClient = _MockAsyncClient
    try:
        pay = await client.post(
            "/api/v1/billing/tokens/purchase",
            json={"package_code": "pack_50k"},
            headers=_headers(token),
        )
    finally:
        billing_service_module.httpx.AsyncClient = old_async_client

    assert pay.status_code == 200
    body = pay.json()
    assert body["ok"] is True
    assert body["data"]["requires_payment"] is True
    assert body["data"]["purchase_applied"] is False
    assert body["data"]["payment_id"] == "pay-token-1"
    assert body["data"]["confirmation_url"] == "https://pay.example/token-redirect"


@pytest.mark.asyncio
async def test_token_purchase_webhook_adds_tokens_once(client: AsyncClient):
    token = await _register_owner(client)

    from src.modules.billing.seed import upsert_default_token_packages

    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        await uow.commit()

    current_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
    assert current_org.status_code == 200
    org_id = current_org.json()["data"]["id"]

    payment_id = f"pay-token-{uuid.uuid4().hex[:8]}"
    webhook_payload = {
        "event": "payment.succeeded",
        "object": {
            "id": payment_id,
            "status": "succeeded",
            "metadata": {
                "org_id": org_id,
                "purchase_kind": "token_package",
                "package_code": "pack_50k",
            },
        },
    }
    webhook_resp = await client.post("/api/v1/billing/webhook/yookassa", json=webhook_payload)
    assert webhook_resp.status_code == 200

    balance_resp = await client.get("/api/v1/billing/tokens/balance", headers=_headers(token))
    assert balance_resp.status_code == 200
    balance_data = balance_resp.json()["data"]
    assert int(balance_data["addon_tokens_remaining"]) >= 50_000

    # Повторный webhook с тем же payment_id не должен продублировать начисление.
    webhook_resp_2 = await client.post("/api/v1/billing/webhook/yookassa", json=webhook_payload)
    assert webhook_resp_2.status_code == 200

    async with UnitOfWork() as uow:
        purchases = (
            await uow.session.execute(
                select(TokenPurchase).where(TokenPurchase.payment_id == payment_id)
            )
        ).scalars().all()
        assert len(purchases) == 1
        assert purchases[0].package_code == "pack_50k"
        assert purchases[0].tokens_total == 50_000


@pytest.mark.asyncio
async def test_subscription_lifecycle_grace_downgrade_and_purge(client: AsyncClient):
    token = await _register_owner(client)

    # Ensure plans exist.
    from src.modules.billing.seed import upsert_default_plans

    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await uow.commit()

    # Create one table to verify purge.
    table_resp = await client.post("/api/v1/tables/", json={"name": "To be purged"}, headers=_headers(token))
    assert table_resp.status_code == 200
    assert table_resp.json()["ok"] is True

    # Resolve org id.
    me_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
    assert me_org.status_code == 200
    org_id = uuid.UUID(me_org.json()["data"]["id"])

    # Seed paid subscription that already ended yesterday.
    now = datetime.now(UTC)
    ended_at = now - timedelta(days=1)
    async with UnitOfWork() as uow:
        sub = (
            await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))
        ).scalar_one_or_none()
        if sub is None:
            sub = Subscription(org_id=org_id, plan=PlanTier.TEAM, status=SubscriptionStatus.ACTIVE)
            uow.session.add(sub)
        sub.plan = PlanTier.TEAM
        sub.status = SubscriptionStatus.ACTIVE
        sub.current_period_start = ended_at - timedelta(days=30)
        sub.current_period_end = ended_at
        await uow.commit()

    service = BillingService()
    first = await service.process_subscription_lifecycle(now=now)
    assert first["post_expiry_notifications"] >= 1

    async with UnitOfWork() as uow:
        sub = (
            await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))
        ).scalar_one()
        assert sub.status == SubscriptionStatus.PAST_DUE
        assert sub.grace_period_end is not None
        await uow.commit()

    # After grace period org should be downgraded.
    downgrade_now = ended_at + timedelta(days=8)
    second = await service.process_subscription_lifecycle(now=downgrade_now)
    assert second["downgraded_orgs"] >= 1

    async with UnitOfWork() as uow:
        sub = (
            await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))
        ).scalar_one()
        assert sub.status == SubscriptionStatus.CANCELLED
        assert sub.plan == PlanTier.FREE
        await uow.commit()

    # After 30 days from end date, business data is purged.
    purge_now = ended_at + timedelta(days=31)
    third = await service.process_subscription_lifecycle(now=purge_now)
    assert third["purged_orgs"] >= 1

    async with UnitOfWork() as uow:
        table_count = (
            await uow.session.execute(select(Table).where(Table.org_id == org_id))
        ).scalars().all()
        assert len(table_count) == 0
        members = (
            await uow.session.execute(select(Membership).where(Membership.org_id == org_id))
        ).scalars().all()
        # org + memberships are still present, only business data is purged.
        assert len(members) >= 1
        await uow.commit()


@pytest.mark.asyncio
async def test_billing_webhook_upgrades_subscription_and_org_plan(client: AsyncClient):
    token = await _register_owner(client)

    current_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
    assert current_org.status_code == 200
    org_id = current_org.json()["data"]["id"]

    webhook_payload = {
        "event": "payment.succeeded",
        "object": {
            "id": f"pay-{uuid.uuid4().hex[:8]}",
            "metadata": {
                "org_id": org_id,
                "plan_name": "business",
                "period": "monthly",
            },
        },
    }
    webhook_resp = await client.post("/api/v1/billing/webhook/yookassa", json=webhook_payload)
    assert webhook_resp.status_code == 200
    assert webhook_resp.json()["status"] == "ok"

    subscription_resp = await client.get("/api/v1/billing/subscription", headers=_headers(token))
    assert subscription_resp.status_code == 200
    data = subscription_resp.json()["data"]
    assert data["plan"] == "business"
    assert data["status"] == "active"
    assert data["external_id"] == webhook_payload["object"]["id"]
    assert data["current_period_start"] is not None
    assert data["current_period_end"] is not None
    assert data["grace_period_end"] is None
    assert data["data_purge_at"] is None

    async with UnitOfWork() as uow:
        membership = (
            await uow.session.execute(select(Membership).where(Membership.org_id == uuid.UUID(org_id)))
        ).scalars().first()
        assert membership is not None
        org = await uow.session.get(Organization, uuid.UUID(org_id))
        assert org is not None
        assert org.plan == PlanTier.BUSINESS


@pytest.mark.asyncio
async def test_billing_cancel_subscription_downgrades_to_free(client: AsyncClient):
    token = await _register_owner(client)

    # First upgrade by webhook to have a non-free state.
    current_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
    assert current_org.status_code == 200
    org_id = current_org.json()["data"]["id"]
    await client.post(
        "/api/v1/billing/webhook/yookassa",
        json={
            "event": "payment.succeeded",
            "object": {
                "id": f"pay-{uuid.uuid4().hex[:8]}",
                "metadata": {"org_id": org_id, "plan_name": "team", "period": "monthly"},
            },
        },
    )

    cancel_resp = await client.post("/api/v1/billing/cancel-subscription", headers=_headers(token))
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["ok"] is True
    assert cancel_resp.json()["data"]["plan"] == "free"
    assert cancel_resp.json()["data"]["status"] == "cancelled"

    sub_resp = await client.get("/api/v1/billing/subscription", headers=_headers(token))
    assert sub_resp.status_code == 200
    sub_data = sub_resp.json()["data"]
    assert sub_data["plan"] == "free"
    assert sub_data["status"] == "cancelled"


@pytest.mark.asyncio
async def test_subscription_lifecycle_notifications_are_idempotent(client: AsyncClient):
    token = await _register_owner(client)
    service = BillingService()

    me_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
    assert me_org.status_code == 200
    org_id = uuid.UUID(me_org.json()["data"]["id"])

    now = datetime.now(UTC)
    period_end = now + timedelta(hours=1)
    async with UnitOfWork() as uow:
        sub = (
            await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))
        ).scalar_one_or_none()
        if sub is None:
            sub = Subscription(org_id=org_id, plan=PlanTier.TEAM, status=SubscriptionStatus.ACTIVE)
            uow.session.add(sub)
        sub.plan = PlanTier.TEAM
        sub.status = SubscriptionStatus.ACTIVE
        sub.current_period_start = now - timedelta(days=29)
        sub.current_period_end = period_end
        sub.pre_expiry_notified_at = None
        sub.post_expiry_notified_at = None
        await uow.commit()

    first = await service.process_subscription_lifecycle(now=now)
    assert first["pre_expiry_notifications"] >= 1

    second = await service.process_subscription_lifecycle(now=now + timedelta(minutes=10))
    assert second["pre_expiry_notifications"] == 0

    after_end = period_end + timedelta(minutes=1)
    third = await service.process_subscription_lifecycle(now=after_end)
    assert third["post_expiry_notifications"] >= 1

    fourth = await service.process_subscription_lifecycle(now=after_end + timedelta(minutes=5))
    assert fourth["post_expiry_notifications"] == 0

    async with UnitOfWork() as uow:
        notifications = (
            await uow.session.execute(
                select(Notification).where(
                    Notification.org_id == org_id,
                    Notification.type == NotificationType.IN_APP,
                )
            )
        ).scalars().all()
        kinds = [(n.meta or {}).get("kind") for n in notifications]
        assert kinds.count("subscription_pre_expiry") >= 1
        assert kinds.count("subscription_post_expiry") >= 1
