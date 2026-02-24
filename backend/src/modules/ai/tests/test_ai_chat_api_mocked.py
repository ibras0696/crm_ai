import uuid

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import select


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"ai-chat-{uuid.uuid4().hex[:8]}@example.com"
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
async def test_ai_chat_executes_action_with_mocked_provider(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)

    from src.config import settings
    from src.modules.ai.internal import chat_controller as ai_chat_controller

    old_token = settings.OPENAI_BEARER_TOKEN
    settings.OPENAI_BEARER_TOKEN = "test-token"

    async def _fake_call(*args, **kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            "Создам таблицу.\n"
                            "```crm_action\n"
                            "{\"action\":\"create_table\",\"name\":\"Mocked\",\"columns\":[{\"name\":\"Name\",\"field_type\":\"text\",\"is_primary\":true}],\"records\":[{\"Name\":\"A\"},{\"Name\":\"B\"}]}\n"
                            "```"
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }

    monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _fake_call)

    resp = await client.post(
        "/api/v1/ai/chat",
        json={"message": "create table", "include_context": False},
        headers=_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["action_result"] is not None
    ar = body["data"]["action_result"]
    assert ar["action"] == "create_table"
    assert ar["ok"] is True
    assert ar["table"]["name"] == "Mocked"

    chat_id = body["data"]["chat_id"]
    assert isinstance(chat_id, str) and chat_id

    chats = await client.get("/api/v1/ai/chats", headers=_headers(token))
    assert chats.status_code == 200
    assert any(c["id"] == chat_id for c in chats.json()["data"])

    msgs = await client.get(f"/api/v1/ai/chats/{chat_id}/messages", headers=_headers(token))
    assert msgs.status_code == 200
    assert len(msgs.json()["data"]) >= 2

    est = await client.post(
        "/api/v1/ai/context-estimate",
        json={"include_context": False, "user_message": "hi"},
        headers=_headers(token),
    )
    assert est.status_code == 200
    assert "estimated_prompt_tokens" in est.json()["data"]

    d = await client.delete(f"/api/v1/ai/chats/{chat_id}", headers=_headers(token))
    assert d.status_code == 200

    settings.OPENAI_BEARER_TOKEN = old_token


@pytest.mark.asyncio
async def test_ai_chat_does_not_execute_action_without_explicit_request(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)

    from src.config import settings
    from src.modules.ai.internal import chat_controller as ai_chat_controller

    old_token = settings.OPENAI_BEARER_TOKEN
    settings.OPENAI_BEARER_TOKEN = "test-token"

    async def _fake_call(*args, **kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            "Привет!\n"
                            "```crm_action\n"
                            "{\"action\":\"create_table\",\"name\":\"ShouldNotRun\",\"columns\":[{\"name\":\"Name\",\"field_type\":\"text\"}]}\n"
                            "```"
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        }

    monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _fake_call)

    resp = await client.post(
        "/api/v1/ai/chat",
        json={"message": "привет, как дела?", "include_context": False},
        headers=_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["action_result"] is not None
    action_result = body["data"]["action_result"]
    assert action_result["ok"] is False
    assert action_result["error"] == "action_not_requested"

    settings.OPENAI_BEARER_TOKEN = old_token


@pytest.mark.asyncio
async def test_ai_chat_rejects_when_ai_disabled(client: AsyncClient):
    token = await _register_owner(client)
    from src.config import settings

    old_enabled = settings.ENABLE_AI
    settings.ENABLE_AI = False
    try:
        resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "AI_DISABLED"
    finally:
        settings.ENABLE_AI = old_enabled


@pytest.mark.asyncio
async def test_ai_chat_rejects_when_provider_token_missing(client: AsyncClient):
    token = await _register_owner(client)
    from src.config import settings

    old_bearer = settings.OPENAI_BEARER_TOKEN
    old_api_key = settings.OPENAI_API_KEY
    settings.OPENAI_BEARER_TOKEN = ""
    settings.OPENAI_API_KEY = ""
    try:
        resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "AI_NOT_CONFIGURED"
    finally:
        settings.OPENAI_BEARER_TOKEN = old_bearer
        settings.OPENAI_API_KEY = old_api_key


@pytest.mark.asyncio
async def test_ai_chat_handles_provider_error_variants(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)
    from src.config import settings
    from src.modules.ai.internal import chat_controller as ai_chat_controller

    old_token = settings.OPENAI_BEARER_TOKEN
    settings.OPENAI_BEARER_TOKEN = "test-token"
    try:
        async def _bad_payload(*args, **kwargs):
            return {"choices": []}

        monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _bad_payload)
        bad_payload_resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert bad_payload_resp.status_code == 200
        bad_payload_body = bad_payload_resp.json()
        assert bad_payload_body["ok"] is False
        assert bad_payload_body["error"]["code"] == "AI_BAD_PROVIDER_RESPONSE"

        async def _unauthorized(*args, **kwargs):
            request = httpx.Request("POST", "https://provider.local/chat")
            response = httpx.Response(status_code=401, request=request)
            raise httpx.HTTPStatusError("unauthorized", request=request, response=response)

        monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _unauthorized)
        unauthorized_resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert unauthorized_resp.status_code == 200
        unauthorized_body = unauthorized_resp.json()
        assert unauthorized_body["ok"] is False
        assert unauthorized_body["error"]["code"] == "AI_PROVIDER_UNAUTHORIZED"

        async def _provider_error(*args, **kwargs):
            request = httpx.Request("POST", "https://provider.local/chat")
            response = httpx.Response(status_code=500, request=request)
            raise httpx.HTTPStatusError("server error", request=request, response=response)

        monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _provider_error)
        provider_error_resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert provider_error_resp.status_code == 200
        provider_error_body = provider_error_resp.json()
        assert provider_error_body["ok"] is False
        assert provider_error_body["error"]["code"] == "AI_ERROR"
        assert "500" not in provider_error_body["error"]["message"]
    finally:
        settings.OPENAI_BEARER_TOKEN = old_token


@pytest.mark.asyncio
async def test_ai_chat_rejects_on_limit_before_provider_call(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)
    from src.config import settings
    from src.modules.ai.internal import chat_controller as ai_chat_controller

    old_token = settings.OPENAI_BEARER_TOKEN
    settings.OPENAI_BEARER_TOKEN = "test-token"
    try:
        async def _deny_limit(*args, **kwargs):
            return False, {"code": "AI_DAILY_LIMIT", "message": "limit reached"}

        async def _provider_should_not_be_called(*args, **kwargs):
            raise AssertionError("provider should not be called when limits reject request")

        monkeypatch.setattr(ai_chat_controller, "check_ai_limits", _deny_limit)
        monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _provider_should_not_be_called)

        resp = await client.post(
            "/api/v1/ai/chat",
            json={"message": "hello", "include_context": False},
            headers=_headers(token),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "AI_DAILY_LIMIT"
    finally:
        settings.OPENAI_BEARER_TOKEN = old_token


@pytest.mark.asyncio
async def test_ai_chat_uses_request_id_idempotency_for_token_spend(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)

    from src.config import settings
    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.internal import chat_controller as ai_chat_controller
    from src.modules.auth.models import User
    from src.modules.billing.models import Plan
    from src.modules.billing.token_wallet import get_token_balance_view
    from src.modules.org.models import Membership

    old_token = settings.OPENAI_BEARER_TOKEN
    settings.OPENAI_BEARER_TOKEN = "test-token"
    try:
        async with UnitOfWork() as uow:
            me = (
                await uow.session.execute(select(User).where(User.email.like("ai-chat-%@example.com")).order_by(User.created_at.desc()))
            ).scalars().first()
            assert me is not None
            membership = (await uow.session.execute(select(Membership).where(Membership.user_id == me.id))).scalars().first()
            assert membership is not None
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
                    ai_tokens_per_day=1000,
                    ai_rpm_per_user=30,
                )
                uow.session.add(free_plan)
            else:
                free_plan.ai_tokens_per_day = 1000
            await uow.commit()

        await client.post("/api/v1/billing/tokens/purchase", json={"package_code": "pack_50k"}, headers=_headers(token))

        async def _fake_call(*args, **kwargs):
            return {
                "choices": [{"message": {"content": "Готово"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12},
            }

        monkeypatch.setattr(ai_chat_controller, "call_openai_compatible_api", _fake_call)

        req_id = "idem-chat-1"
        first = await client.post(
            "/api/v1/ai/chat",
            json={"message": "привет", "include_context": False, "request_id": req_id},
            headers=_headers(token),
        )
        assert first.status_code == 200
        assert first.json()["ok"] is True

        second = await client.post(
            "/api/v1/ai/chat",
            json={"message": "привет", "include_context": False, "request_id": req_id},
            headers=_headers(token),
        )
        assert second.status_code == 200
        assert second.json()["ok"] is True

        async with UnitOfWork() as uow:
            me = (
                await uow.session.execute(select(User).where(User.email.like("ai-chat-%@example.com")).order_by(User.created_at.desc()))
            ).scalars().first()
            assert me is not None
            membership = (await uow.session.execute(select(Membership).where(Membership.user_id == me.id))).scalars().first()
            assert membership is not None
            wallet = await get_token_balance_view(uow.session, org_id=membership.org_id)
            # Списали только 1 раз (12 токенов) из addon-корзины.
            assert int(wallet["addon_tokens_remaining"]) <= 50000 - 12
            assert int(wallet["addon_tokens_remaining"]) >= 50000 - 20
    finally:
        settings.OPENAI_BEARER_TOKEN = old_token
