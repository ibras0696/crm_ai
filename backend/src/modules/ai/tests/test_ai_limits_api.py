import uuid
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_resolve_plan_limits_prefers_db_overrides():
    from src.common.enums import PlanTier
    from src.modules.ai.limits import resolve_plan_limits

    plan_db = SimpleNamespace(ai_tokens_per_day=1500, ai_rpm_per_user=19, ai_max_tokens_per_request=777)
    limits = resolve_plan_limits(PlanTier.FREE, plan_db)

    assert int(limits["daily_tokens"]) == 1500
    assert int(limits["rpm_per_user"]) == 19
    assert int(limits["max_tokens_per_request"]) == 777


@pytest.mark.asyncio
async def test_ai_status_uses_plan_limits_from_db(client: AsyncClient):
    # Register owner (org default plan = free)
    email_owner = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "AI Limits Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    owner_token = reg.json()["data"]["access_token"]

    from src.infrastructure.uow import UnitOfWork
    from src.modules.billing.models import Plan

    async with UnitOfWork() as uow:
        # Ensure plan exists then override limits.
        plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalars().first()
        if not plan:
            plan = Plan(
                name="free",
                display_name="Free",
                price_monthly=0,
                price_yearly=0,
                max_members=10,
                max_tables=10,
                max_records=10000,
                max_storage_mb=500,
                has_ai=True,
                features={"ai": True},
                is_active=True,
                ai_tokens_per_day=0,
                ai_rpm_per_user=0,
                ai_max_tokens_per_request=0,
            )
            uow.session.add(plan)
            await uow.session.flush()

        plan.ai_tokens_per_day = 1234
        plan.ai_rpm_per_user = 17
        plan.ai_max_tokens_per_request = 999
        await uow.commit()

    st = await client.get("/api/v1/ai/status", headers=_headers(owner_token))
    assert st.status_code == 200
    data = st.json()["data"]
    assert int(data["limits"]["daily_tokens"]) == 1234
    assert int(data["limits"]["rpm_per_user"]) == 17
    assert int(data["limits"]["max_tokens_per_request"]) == 999


@pytest.mark.asyncio
async def test_ai_status_uses_active_subscription_plan_over_org_plan(client: AsyncClient):
    email_owner = f"owner2-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": f"AI Limits Org {uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    owner_token = reg.json()["data"]["access_token"]

    from src.common.enums import PlanTier, SubscriptionStatus
    from src.infrastructure.uow import UnitOfWork
    from src.modules.auth.models import User
    from src.modules.billing.models import Plan
    from src.modules.org.models import Membership, Subscription

    async with UnitOfWork() as uow:
        user = (await uow.session.execute(select(User).where(User.email == email_owner))).scalars().first()
        assert user is not None
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        assert membership is not None
        org_id = membership.org_id

        # Ensure team plan exists and has limits.
        plan = (await uow.session.execute(select(Plan).where(Plan.name == "team"))).scalars().first()
        if not plan:
            plan = Plan(
                name="team",
                display_name="Team",
                price_monthly=0,
                price_yearly=0,
                max_members=10,
                max_tables=10,
                max_records=10000,
                max_storage_mb=500,
                has_ai=True,
                features={"ai": True},
                is_active=True,
                ai_tokens_per_day=0,
                ai_rpm_per_user=0,
                ai_max_tokens_per_request=0,
            )
            uow.session.add(plan)
            await uow.session.flush()

        plan.ai_tokens_per_day = 4321
        plan.ai_rpm_per_user = 23
        plan.ai_max_tokens_per_request = 1111

        sub = (await uow.session.execute(select(Subscription).where(Subscription.org_id == org_id))).scalars().first()
        if not sub:
            sub = Subscription(org_id=org_id, plan=PlanTier.TEAM, status=SubscriptionStatus.ACTIVE)
            uow.session.add(sub)
        else:
            sub.plan = PlanTier.TEAM
            sub.status = SubscriptionStatus.ACTIVE

        await uow.commit()

    st = await client.get("/api/v1/ai/status", headers=_headers(owner_token))
    assert st.status_code == 200
    data = st.json()["data"]
    assert data["plan"] == "team"
    assert int(data["limits"]["daily_tokens"]) == 4321
    assert int(data["limits"]["rpm_per_user"]) == 23
    assert int(data["limits"]["max_tokens_per_request"]) == 1111


@pytest.mark.asyncio
async def test_check_ai_limits_rejects_projected_monthly_wallet_overflow(client: AsyncClient):
    email_owner = f"owner3-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email_owner,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": f"AI Limits Org {uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201

    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.limits import check_ai_limits
    from src.modules.auth.models import User
    from src.modules.billing.models import Plan
    from src.modules.org.models import Membership

    async with UnitOfWork() as uow:
        user = (await uow.session.execute(select(User).where(User.email == email_owner))).scalars().first()
        assert user is not None
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        assert membership is not None
        org_id = membership.org_id

        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalars().first()
        if not free_plan:
            free_plan = Plan(
                name="free",
                display_name="Free",
                price_monthly=0,
                price_yearly=0,
                max_members=10,
                max_tables=10,
                max_records=10000,
                max_storage_mb=500,
                has_ai=True,
                features={"ai": True},
                is_active=True,
                ai_tokens_per_day=0,
                ai_rpm_per_user=0,
                ai_max_tokens_per_request=0,
            )
            uow.session.add(free_plan)
            await uow.session.flush()
        free_plan.ai_tokens_per_day = 100
        free_plan.ai_rpm_per_user = 1000
        await uow.commit()

    async with UnitOfWork() as uow:
        ok, err = await check_ai_limits(
            uow.session,
            org_id=org_id,
            user_id=user.id,
            estimated_request_tokens=120,
        )
        assert ok is False
        assert err is not None
        assert err["code"] == "AI_TOKEN_LIMIT_EXCEEDED"
