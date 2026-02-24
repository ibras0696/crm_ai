import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.common.enums import PlanTier, SubscriptionStatus
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.service import BillingService
from src.modules.org.models import Membership, Subscription
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
