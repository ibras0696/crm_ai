import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import Plan
from src.modules.billing.seed import upsert_default_token_packages
from src.modules.billing.token_wallet import ensure_token_balance, spend_tokens
from src.modules.org.models import Membership


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"token-{uuid.uuid4().hex[:8]}@example.com"
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


async def _owner_identity(client: AsyncClient, token: str) -> tuple[uuid.UUID, uuid.UUID]:
    me = await client.get("/api/v1/auth/me", headers=_headers(token))
    assert me.status_code == 200
    user_id = uuid.UUID(me.json()["data"]["id"])
    async with UnitOfWork() as uow:
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user_id))).scalars().first()
        assert membership is not None
        return user_id, membership.org_id


async def _ensure_free_plan(ai_tokens_per_day: int) -> None:
    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalars().first()
        if not free_plan:
            free_plan = Plan(
                name="free",
                display_name="Бесплатный",
                price_monthly=0,
                price_yearly=0,
                max_members=10,
                max_tables=10,
                max_records=10000,
                max_storage_mb=500,
                has_ai=True,
                features={"ai": True},
                is_active=True,
                ai_max_tokens_per_request=2000,
                ai_tokens_per_day=ai_tokens_per_day,
                ai_rpm_per_user=30,
            )
            uow.session.add(free_plan)
        else:
            free_plan.ai_tokens_per_day = ai_tokens_per_day
            free_plan.is_active = True
        await uow.commit()


@pytest.mark.asyncio
async def test_token_packages_balance_and_purchase_api(client: AsyncClient):
    token = await _register_owner(client)
    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        await uow.commit()

    packages = await client.get("/api/v1/billing/tokens/packages", headers=_headers(token))
    assert packages.status_code == 200
    assert packages.json()["ok"] is True
    codes = {row["code"] for row in packages.json()["data"]}
    assert {"pack_50k", "pack_100k", "pack_500k"}.issubset(codes)

    before = await client.get("/api/v1/billing/tokens/balance", headers=_headers(token))
    assert before.status_code == 200
    before_data = before.json()["data"]

    buy = await client.post("/api/v1/billing/tokens/purchase", json={"package_code": "pack_50k"}, headers=_headers(token))
    assert buy.status_code == 200
    assert buy.json()["ok"] is True
    assert int(buy.json()["data"]["tokens_added"]) == 50000

    after = await client.get("/api/v1/billing/tokens/balance", headers=_headers(token))
    assert after.status_code == 200
    after_data = after.json()["data"]
    assert int(after_data["addon_tokens_remaining"]) >= int(before_data["addon_tokens_remaining"]) + 50000


@pytest.mark.asyncio
async def test_wallet_spend_prefers_addon_then_plan_and_idempotency(client: AsyncClient):
    token = await _register_owner(client)
    user_id, org_id = await _owner_identity(client, token)
    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        await uow.commit()

    # Делаем маленькую плановую квоту для предсказуемых проверок.
    await _ensure_free_plan(100)

    # Покупаем addon-пакет и тратим токены.
    buy = await client.post("/api/v1/billing/tokens/purchase", json={"package_code": "pack_50k"}, headers=_headers(token))
    assert buy.status_code == 200
    assert buy.json()["ok"] is True

    async with UnitOfWork() as uow:
        before = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        plan_before = int(before.plan_tokens_remaining)
        addon_before = int(before.addon_tokens_remaining)
        assert addon_before >= 50000

        first = await spend_tokens(
            uow.session,
            org_id=org_id,
            user_id=user_id,
            tokens=30,
            request_id="req-1",
            meta={"test": "wallet"},
        )
        assert first.spent_addon == 30
        assert first.spent_plan == 0

        replay = await spend_tokens(
            uow.session,
            org_id=org_id,
            user_id=user_id,
            tokens=30,
            request_id="req-1",
            meta={"test": "wallet"},
        )
        assert replay.idempotent_replay is True
        assert replay.spent_total == 30

        after = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        assert int(after.plan_tokens_remaining) == plan_before
        assert int(after.addon_tokens_remaining) == addon_before - 30
        await uow.commit()


@pytest.mark.asyncio
async def test_wallet_monthly_cycle_resets_plan_tokens_without_carryover(client: AsyncClient):
    token = await _register_owner(client)
    _, org_id = await _owner_identity(client, token)

    await _ensure_free_plan(222)

    async with UnitOfWork() as uow:
        balance = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        balance.plan_tokens_remaining = 17
        balance.plan_cycle_key = "2000-01"
        await uow.commit()

    async with UnitOfWork() as uow:
        rotated = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        assert rotated.plan_tokens_monthly_quota == 222
        assert rotated.plan_tokens_remaining == 222
        assert rotated.plan_cycle_key != "2000-01"
        await uow.commit()
