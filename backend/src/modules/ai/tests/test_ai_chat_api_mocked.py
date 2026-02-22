import uuid

import pytest
from httpx import AsyncClient


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
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_ai_chat_executes_action_with_mocked_provider(client: AsyncClient, monkeypatch):
    token = await _register_owner(client)

    from src.config import settings
    from src.modules.ai import routes as ai_routes

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

    monkeypatch.setattr(ai_routes, "call_openai_compatible_api", _fake_call)

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
