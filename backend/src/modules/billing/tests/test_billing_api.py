import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.common.enums import NotificationType, PlanTier, SubscriptionStatus
from src.infrastructure.uow import UnitOfWork
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
        sub = (await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))).scalar_one_or_none()
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
