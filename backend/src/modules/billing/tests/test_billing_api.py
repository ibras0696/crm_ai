import uuid

import pytest
from httpx import AsyncClient


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

