import uuid
from typing import ClassVar

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.common.runtime_secret import encrypt_runtime_secret
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import BillingRuntimeSecret, BillingRuntimeSettings, Plan
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
        membership = (
            (await uow.session.execute(select(Membership).where(Membership.user_id == user_id))).scalars().first()
        )
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


async def _configure_runtime_yookassa() -> None:
    async with UnitOfWork() as uow:
        uow.session.add(
            BillingRuntimeSettings(
                yookassa_shop_id="wallet-shop-1",
                yookassa_return_url="https://runtime.example/billing/success",
                yookassa_webhook_url="https://runtime.example/webhook",
            )
        )
        uow.session.add(BillingRuntimeSecret(yookassa_secret_key_encrypted=encrypt_runtime_secret("wallet-secret-1")))
        await uow.commit()


class _MockYooKassaResponse:
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


class _MockYooKassaClient:
    payments: ClassVar[dict[str, dict]] = {}

    def __init__(self, *_args, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url: str, json=None, auth=None, headers=None):
        _ = headers
        assert url == "https://api.yookassa.ru/v3/payments"
        assert auth == ("wallet-shop-1", "wallet-secret-1")
        package_code = (json or {}).get("metadata", {}).get("package_code") or "pack_50k"
        return _MockYooKassaResponse(
            200,
            {
                "id": f"pay-{package_code}",
                "status": "pending",
                "confirmation": {"confirmation_url": f"https://pay.example/{package_code}"},
            },
        )

    async def get(self, url: str, auth=None, headers=None):
        _ = headers
        assert auth == ("wallet-shop-1", "wallet-secret-1")
        payment_id = url.rsplit("/", 1)[-1]
        payload = self.payments.get(payment_id)
        if payload is None:
            return _MockYooKassaResponse(404, {"id": payment_id})
        return _MockYooKassaResponse(200, payload)


@pytest.mark.asyncio
async def test_token_packages_balance_and_purchase_api(client: AsyncClient):
    token = await _register_owner(client)
    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        await uow.commit()
    await _configure_runtime_yookassa()

    from src.modules.billing import service as billing_service_module

    old_async_client = billing_service_module.httpx.AsyncClient
    _MockYooKassaClient.payments = {}
    billing_service_module.httpx.AsyncClient = _MockYooKassaClient
    try:
        packages = await client.get("/api/v1/billing/tokens/packages", headers=_headers(token))
        assert packages.status_code == 200
        assert packages.json()["ok"] is True
        codes = {row["code"] for row in packages.json()["data"]}
        assert {"pack_50k", "pack_100k", "pack_500k"}.issubset(codes)
        first = next(row for row in packages.json()["data"] if row["code"] == "pack_50k")
        assert first["badge_text"] == "На пробу"
        assert first["button_text"] == "Перейти к оплате"
        assert first["price_caption"] == "20 ₽ за 1 000 токенов"

        before = await client.get("/api/v1/billing/tokens/balance", headers=_headers(token))
        assert before.status_code == 200
        before_data = before.json()["data"]

        current_org = await client.get("/api/v1/orgs/current", headers=_headers(token))
        assert current_org.status_code == 200
        org_id = current_org.json()["data"]["id"]

        buy = await client.post(
            "/api/v1/billing/tokens/purchase", json={"package_code": "pack_50k"}, headers=_headers(token)
        )
        assert buy.status_code == 200
        assert buy.json()["ok"] is True
        assert buy.json()["data"]["requires_payment"] is True
        _MockYooKassaClient.payments["pay-pack_50k"] = {
            "id": "pay-pack_50k",
            "status": "succeeded",
            "paid": True,
            "metadata": {
                "org_id": org_id,
                "purchase_kind": "token_package",
                "package_code": "pack_50k",
            },
        }

        webhook = await client.post(
            "/api/v1/billing/webhook/yookassa",
            json={
                "event": "payment.succeeded",
                "object": {
                    "id": "pay-pack_50k",
                    "status": "succeeded",
                    "metadata": {
                        "org_id": org_id,
                        "purchase_kind": "token_package",
                        "package_code": "pack_50k",
                    },
                },
            },
        )
        assert webhook.status_code == 200

        after = await client.get("/api/v1/billing/tokens/balance", headers=_headers(token))
        assert after.status_code == 200
        after_data = after.json()["data"]
        assert int(after_data["addon_tokens_remaining"]) >= int(before_data["addon_tokens_remaining"]) + 50000
    finally:
        billing_service_module.httpx.AsyncClient = old_async_client


@pytest.mark.asyncio
async def test_wallet_spend_prefers_addon_then_plan_and_idempotency(client: AsyncClient):
    token = await _register_owner(client)
    user_id, org_id = await _owner_identity(client, token)
    async with UnitOfWork() as uow:
        await upsert_default_token_packages(uow.session)
        await uow.commit()
    await _configure_runtime_yookassa()

    # Делаем маленькую плановую квоту для предсказуемых проверок.
    await _ensure_free_plan(100)

    from src.modules.billing import service as billing_service_module

    old_async_client = billing_service_module.httpx.AsyncClient
    _MockYooKassaClient.payments = {}
    billing_service_module.httpx.AsyncClient = _MockYooKassaClient
    try:
        # Покупаем addon-пакет и подтверждаем его webhook'ом.
        buy = await client.post(
            "/api/v1/billing/tokens/purchase", json={"package_code": "pack_50k"}, headers=_headers(token)
        )
        assert buy.status_code == 200
        assert buy.json()["ok"] is True
        assert buy.json()["data"]["requires_payment"] is True
        _MockYooKassaClient.payments["pay-pack_50k"] = {
            "id": "pay-pack_50k",
            "status": "succeeded",
            "paid": True,
            "metadata": {
                "org_id": str(org_id),
                "user_id": str(user_id),
                "purchase_kind": "token_package",
                "package_code": "pack_50k",
            },
        }

        webhook = await client.post(
            "/api/v1/billing/webhook/yookassa",
            json={
                "event": "payment.succeeded",
                "object": {
                    "id": "pay-pack_50k",
                    "status": "succeeded",
                    "metadata": {
                        "org_id": str(org_id),
                        "user_id": str(user_id),
                        "purchase_kind": "token_package",
                        "package_code": "pack_50k",
                    },
                },
            },
        )
        assert webhook.status_code == 200

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
    finally:
        billing_service_module.httpx.AsyncClient = old_async_client


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


@pytest.mark.asyncio
async def test_wallet_updates_current_cycle_quota_when_superadmin_changes_plan_limit(client: AsyncClient):
    token = await _register_owner(client)
    _, org_id = await _owner_identity(client, token)

    await _ensure_free_plan(100)

    async with UnitOfWork() as uow:
        balance = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        balance.plan_tokens_remaining = 70
        await uow.commit()

    await _ensure_free_plan(150)

    async with UnitOfWork() as uow:
        increased = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        assert increased.plan_tokens_monthly_quota == 150
        assert increased.plan_tokens_remaining == 120
        await uow.commit()

    await _ensure_free_plan(50)

    async with UnitOfWork() as uow:
        decreased = await ensure_token_balance(uow.session, org_id=org_id, lock=True)
        assert decreased.plan_tokens_monthly_quota == 50
        assert decreased.plan_tokens_remaining == 20
        await uow.commit()
