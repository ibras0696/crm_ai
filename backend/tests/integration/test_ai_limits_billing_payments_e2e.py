"""E2E integration scenarios for AI limits + billing + payments.

Сценарии покрывают сразу несколько модулей:
- superadmin (billing/yookassa/plan tuning),
- org admin limits,
- ai chat + action execution + rate-limit,
- billing token purchase + payment creation + webhook activation.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from src.common.runtime_secret import encrypt_runtime_secret
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.security import hash_password
from src.modules.billing.models import BillingRuntimeSecret, BillingRuntimeSettings, Plan
from src.modules.billing.seed import upsert_default_plans, upsert_default_token_packages

if TYPE_CHECKING:
    from httpx import AsyncClient


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _runtime_test_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "AI_PROVIDER_MODE", "openai_compatible")
    monkeypatch.setattr(settings, "OPENAI_BEARER_TOKEN", "test-openai-token")
    monkeypatch.setattr(settings, "SUPERADMIN_EMAIL", "admin@test.local")
    monkeypatch.setattr(settings, "SUPERADMIN_PASSWORD_HASH", hash_password("12345678"))


async def _register_owner(client: AsyncClient, *, org_name: str) -> str:
    email = f"e2e-{uuid.uuid4().hex[:8]}@example.com"
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
    assert reg.status_code == 201, reg.text
    return reg.json()["data"]["access_token"]


async def _owner_identity(client: AsyncClient, *, owner_token: str) -> tuple[str, str]:
    me = await client.get("/api/v1/auth/me", headers=_h(owner_token))
    assert me.status_code == 200, me.text
    me_data = me.json()["data"]

    org = await client.get("/api/v1/orgs/current", headers=_h(owner_token))
    assert org.status_code == 200, org.text
    org_data = org.json()["data"]
    return str(me_data["id"]), str(org_data["id"])


async def _login_superadmin(client: AsyncClient) -> str:
    # Доп. страховка для интеграционного контура: superadmin должен быть
    # доступен независимо от внешнего env.
    from src.modules.superadmin.services import auth as sa_auth_module

    if not settings.SUPERADMIN_EMAIL:
        settings.SUPERADMIN_EMAIL = "admin@test.local"
    if not settings.SUPERADMIN_PASSWORD_HASH:
        settings.SUPERADMIN_PASSWORD_HASH = hash_password("12345678")

    sa_auth_module.settings.SUPERADMIN_EMAIL = settings.SUPERADMIN_EMAIL
    sa_auth_module.settings.SUPERADMIN_PASSWORD_HASH = settings.SUPERADMIN_PASSWORD_HASH

    resp = await client.post(
        "/api/v1/superadmin/login",
        json={"email": "admin@test.local", "password": "12345678"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True, body
    return str(body["data"]["access_token"])


@pytest.mark.asyncio
async def test_e2e_ai_limits_billing_payments_flow(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await upsert_default_token_packages(uow.session)
        await uow.commit()

    owner_token = await _register_owner(client, org_name="E2E AI Billing Org")
    owner_user_id, owner_org_id = await _owner_identity(client, owner_token=owner_token)

    # Org-wide and personal limits (owner as employee in this context).
    org_limits = await client.patch(
        "/api/v1/orgs/ai/limits",
        json={"daily_tokens_limit": 500000, "monthly_tokens_limit": 2000000},
        headers=_h(owner_token),
    )
    assert org_limits.status_code == 200, org_limits.text
    assert org_limits.json()["ok"] is True

    user_limits = await client.put(
        f"/api/v1/orgs/ai/limits/users/{owner_user_id}",
        json={"daily_tokens_limit": 500000, "rpm_limit": 1},
        headers=_h(owner_token),
    )
    assert user_limits.status_code == 200, user_limits.text
    assert user_limits.json()["ok"] is True

    from src.modules.ai.internal import chat_controller as ai_chat_controller

    async def _fake_ai_call(*_args, **_kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            "Создаю страницу в базе знаний.\n"
                            "```crm_action\n"
                            '{"action":"create_kb_page","title":"E2E курс","content":"Модуль 1"}\n'
                            "```"
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 30, "completion_tokens": 20, "total_tokens": 50},
        }

    monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _fake_ai_call)

    first = await client.post(
        "/api/v1/ai/chat",
        json={"message": "создай курс в базе знаний", "include_context": False},
        headers=_h(owner_token),
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["ok"] is True
    assert first_body["data"]["action_result"] is not None
    assert first_body["data"]["action_result"]["ok"] is True
    assert first_body["data"]["action_result"]["action"] == "create_kb_page"
    chat_id = first_body["data"]["chat_id"]
    assert chat_id

    pages = await client.get("/api/v1/knowledge/pages", headers=_h(owner_token))
    assert pages.status_code == 200, pages.text
    assert any(p["title"] == "E2E курс" for p in pages.json()["data"])

    # rpm_limit=1 => второй запрос в течение минуты должен быть отклонен.
    second = await client.post(
        "/api/v1/ai/chat",
        json={"message": "еще что-нибудь", "chat_id": chat_id, "include_context": False},
        headers=_h(owner_token),
    )
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["ok"] is False
    assert second_body["error"]["code"] == "AI_USER_RATE_LIMIT"

    # Superadmin configures YooKassa runtime settings.
    sa_token = await _login_superadmin(client)
    yk_cfg = await client.patch(
        "/api/v1/superadmin/billing/yookassa",
        json={
            "yookassa_shop_id": "shop-e2e-1",
            "yookassa_secret_key": "secret-e2e-1",
            "yookassa_return_url": "https://example.com/return",
            "yookassa_webhook_url": "https://example.com/webhook",
        },
        headers=_h(sa_token),
    )
    assert yk_cfg.status_code == 200, yk_cfg.text
    assert yk_cfg.json()["ok"] is True
    assert yk_cfg.json()["data"]["secret_key_configured"] is True

    from src.modules.billing import service as billing_service_module

    class _MockYooResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError("mock-http-error")

        def json(self):
            return self._payload

    class _MockYooAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url: str, json=None, auth=None, headers=None):
            assert url == "https://api.yookassa.ru/v3/payments"
            assert auth == ("shop-e2e-1", "secret-e2e-1")
            assert (json or {}).get("confirmation", {}).get("return_url") == "https://example.com/return"
            assert "Idempotence-Key" in (headers or {})
            metadata = (json or {}).get("metadata", {})
            if metadata.get("purchase_kind") == "token_package":
                return _MockYooResponse(
                    200,
                    {
                        "id": "pay-e2e-token-1",
                        "status": "pending",
                        "confirmation": {"confirmation_url": "https://pay.example/token-confirm"},
                    },
                )
            return _MockYooResponse(
                200,
                {
                    "id": "pay-e2e-1",
                    "status": "pending",
                    "confirmation": {"confirmation_url": "https://pay.example/confirm"},
                },
            )

        async def get(self, url: str, auth=None, headers=None):
            _ = headers
            assert auth == ("shop-e2e-1", "secret-e2e-1")
            payment_id = url.rsplit("/", 1)[-1]
            if payment_id == "pay-e2e-token-1":
                return _MockYooResponse(
                    200,
                    {
                        "id": payment_id,
                        "status": "succeeded",
                        "paid": True,
                        "metadata": {
                            "org_id": owner_org_id,
                            "purchase_kind": "token_package",
                            "package_code": "pack_50k",
                        },
                    },
                )
            if payment_id == "pay-e2e-webhook":
                return _MockYooResponse(
                    200,
                    {
                        "id": payment_id,
                        "status": "succeeded",
                        "paid": True,
                        "metadata": {"org_id": owner_org_id, "plan_name": "team", "period": "monthly"},
                    },
                )
            return _MockYooResponse(404, {"id": payment_id})

    monkeypatch.setattr(billing_service_module.httpx, "AsyncClient", _MockYooAsyncClient)

    # Billing: purchase addon tokens via payment + webhook.
    purchase = await client.post(
        "/api/v1/billing/tokens/purchase",
        json={"package_code": "pack_50k"},
        headers=_h(owner_token),
    )
    assert purchase.status_code == 200, purchase.text
    assert purchase.json()["ok"] is True
    assert purchase.json()["data"]["requires_payment"] is True
    assert purchase.json()["data"]["payment_id"] == "pay-e2e-token-1"

    token_webhook = await client.post(
        "/api/v1/billing/webhook/yookassa",
        json={
            "event": "payment.succeeded",
            "object": {
                "id": "pay-e2e-token-1",
                "metadata": {
                    "org_id": owner_org_id,
                    "purchase_kind": "token_package",
                    "package_code": "pack_50k",
                },
            },
        },
    )
    assert token_webhook.status_code == 200, token_webhook.text
    token_balance = await client.get("/api/v1/billing/tokens/balance", headers=_h(owner_token))
    assert token_balance.status_code == 200, token_balance.text
    assert int(token_balance.json()["data"]["addon_tokens_remaining"]) >= 50000

    create_payment = await client.post(
        "/api/v1/billing/create-payment",
        json={"plan_name": "team", "period": "monthly"},
        headers=_h(owner_token),
    )
    assert create_payment.status_code == 200, create_payment.text
    create_payment_body = create_payment.json()
    assert create_payment_body["ok"] is True
    assert create_payment_body["data"]["payment_id"] == "pay-e2e-1"
    assert create_payment_body["data"]["confirmation_url"] == "https://pay.example/confirm"

    # Payment webhook activates subscription.
    webhook = await client.post(
        "/api/v1/billing/webhook/yookassa",
        json={
            "event": "payment.succeeded",
            "object": {
                "id": "pay-e2e-webhook",
                "metadata": {"org_id": owner_org_id, "plan_name": "team", "period": "monthly"},
            },
        },
    )
    assert webhook.status_code == 200, webhook.text
    assert webhook.json()["status"] == "ok"

    sub = await client.get("/api/v1/billing/subscription", headers=_h(owner_token))
    assert sub.status_code == 200, sub.text
    sub_data = sub.json()["data"]
    assert sub_data["plan"] == "team"
    assert sub_data["status"] == "active"
    assert sub_data["external_id"] == "pay-e2e-webhook"


@pytest.mark.asyncio
async def test_e2e_token_limit_then_addon_purchase_unblocks_ai(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    async with UnitOfWork() as uow:
        await upsert_default_plans(uow.session)
        await upsert_default_token_packages(uow.session)
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalars().first()
        assert free_plan is not None
        free_plan.ai_tokens_per_day = 1
        free_plan.ai_max_tokens_per_request = 64
        await uow.commit()

    owner_token = await _register_owner(client, org_name="E2E Token Limit Org")
    _, owner_org_id = await _owner_identity(client, owner_token=owner_token)

    from src.modules.ai.internal import chat_controller as ai_chat_controller

    async def _fake_ai_call(*_args, **_kwargs):
        return {
            "choices": [{"message": {"content": "Привет!"}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
        }

    monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _fake_ai_call)

    blocked = await client.post(
        "/api/v1/ai/chat",
        json={"message": "привет", "include_context": False},
        headers=_h(owner_token),
    )
    assert blocked.status_code == 200, blocked.text
    blocked_body = blocked.json()
    assert blocked_body["ok"] is False
    assert blocked_body["error"]["code"] == "AI_TOKEN_LIMIT_EXCEEDED"

    async with UnitOfWork() as uow:
        settings_row = (await uow.session.execute(select(BillingRuntimeSettings).limit(1))).scalars().first()
        secret_row = (await uow.session.execute(select(BillingRuntimeSecret).limit(1))).scalars().first()
        if settings_row is None:
            settings_row = BillingRuntimeSettings()
            uow.session.add(settings_row)
            await uow.session.flush()
        if secret_row is None:
            secret_row = BillingRuntimeSecret()
            uow.session.add(secret_row)
            await uow.session.flush()
        settings_row.yookassa_shop_id = "shop-e2e-token-2"
        settings_row.yookassa_return_url = "https://example.com/return-token-2"
        settings_row.yookassa_webhook_url = "https://example.com/webhook-token-2"
        secret_row.yookassa_secret_key_encrypted = encrypt_runtime_secret("secret-e2e-token-2")
        await uow.commit()

    from src.modules.billing import service as billing_service_module

    class _MockYooResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError("mock-http-error")

        def json(self):
            return self._payload

    class _MockYooAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url: str, json=None, auth=None, headers=None):
            _ = headers
            assert url == "https://api.yookassa.ru/v3/payments"
            assert auth == ("shop-e2e-token-2", "secret-e2e-token-2")
            assert (json or {}).get("metadata", {}).get("package_code") == "pack_50k"
            return _MockYooResponse(
                200,
                {
                    "id": "pay-e2e-token-unblock",
                    "status": "pending",
                    "confirmation": {"confirmation_url": "https://pay.example/token-unblock"},
                },
            )

        async def get(self, url: str, auth=None, headers=None):
            _ = headers
            assert auth == ("shop-e2e-token-2", "secret-e2e-token-2")
            payment_id = url.rsplit("/", 1)[-1]
            if payment_id == "pay-e2e-token-unblock":
                return _MockYooResponse(
                    200,
                    {
                        "id": payment_id,
                        "status": "succeeded",
                        "paid": True,
                        "metadata": {
                            "org_id": owner_org_id,
                            "purchase_kind": "token_package",
                            "package_code": "pack_50k",
                        },
                    },
                )
            return _MockYooResponse(404, {"id": payment_id})

    monkeypatch.setattr(billing_service_module.httpx, "AsyncClient", _MockYooAsyncClient)

    buy = await client.post(
        "/api/v1/billing/tokens/purchase",
        json={"package_code": "pack_50k"},
        headers=_h(owner_token),
    )
    assert buy.status_code == 200, buy.text
    assert buy.json()["ok"] is True
    assert buy.json()["data"]["requires_payment"] is True
    assert buy.json()["data"]["payment_id"] == "pay-e2e-token-unblock"

    webhook = await client.post(
        "/api/v1/billing/webhook/yookassa",
        json={
            "event": "payment.succeeded",
            "object": {
                "id": "pay-e2e-token-unblock",
                "metadata": {
                    "org_id": owner_org_id,
                    "purchase_kind": "token_package",
                    "package_code": "pack_50k",
                },
            },
        },
    )
    assert webhook.status_code == 200, webhook.text

    unblocked = await client.post(
        "/api/v1/ai/chat",
        json={"message": "привет", "include_context": False},
        headers=_h(owner_token),
    )
    assert unblocked.status_code == 200, unblocked.text
    unblocked_body = unblocked.json()
    assert unblocked_body["ok"] is True
    assert unblocked_body["data"]["action_result"] is None
