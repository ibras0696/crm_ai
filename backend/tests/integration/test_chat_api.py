import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient, org_name: str = "Chat Core Org") -> str:
    email = f"chat-core-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Test",
            "last_name": "User",
            "org_name": org_name,
            "accepted_privacy_policy": True,
        },
    )
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    return resp.json()["data"]["access_token"]


async def _invite_and_accept_employee(client: AsyncClient, owner_token: str, *, label: str) -> str:
    email = f"chat-{label}-{uuid.uuid4().hex[:8]}@example.com"
    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201, f"Invite failed: {inv.text}"
    invite_token = inv.json()["data"]["token"]
    assert invite_token

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
        },
    )
    assert acc.status_code == 200, f"Accept invite failed: {acc.text}"
    return acc.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_chat_core_flow_with_members_messages_and_read_cursor(client: AsyncClient):
    token = await _register_owner(client, org_name="Chat CRUD Org")
    emp1_token = await _invite_and_accept_employee(client, token, label="e1")
    emp2_token = await _invite_and_accept_employee(client, token, label="e2")

    members = await client.get("/api/v1/orgs/members", headers=_headers(token))
    assert members.status_code == 200, f"Members list failed: {members.text}"
    items = members.json()["data"]
    owner_id = next(x["user_id"] for x in items if x["role"] == "owner")
    employee_ids = [x["user_id"] for x in items if x["role"] == "employee"]
    assert len(employee_ids) >= 2
    emp1_id = employee_ids[0]
    emp2_id = employee_ids[1]

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Проектный чат",
            "member_ids": [emp1_id],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    assert created.json()["ok"] is True
    chat = created.json()["data"]
    chat_id = chat["id"]
    assert chat["title"] == "Проектный чат"
    assert owner_id in chat["member_ids"]
    assert emp1_id in chat["member_ids"]

    listed = await client.get("/api/v1/chat/chats", headers=_headers(token))
    assert listed.status_code == 200, f"List chats failed: {listed.text}"
    assert any(item["id"] == chat_id for item in listed.json()["data"])

    add_member = await client.post(
        f"/api/v1/chat/chats/{chat_id}/members",
        json={"user_id": emp2_id, "role": "member"},
        headers=_headers(token),
    )
    assert add_member.status_code == 200, f"Add member failed: {add_member.text}"
    assert add_member.json()["ok"] is True
    assert add_member.json()["data"]["user_id"] == emp2_id

    msg_owner = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "Привет от owner"},
        headers=_headers(token),
    )
    assert msg_owner.status_code == 200, f"Owner message failed: {msg_owner.text}"
    assert msg_owner.json()["ok"] is True
    owner_message_id = msg_owner.json()["data"]["id"]
    assert msg_owner.json()["data"]["seq_no"] == 1

    msg_emp1 = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "Привет от emp1"},
        headers=_headers(emp1_token),
    )
    assert msg_emp1.status_code == 200, f"Employee message failed: {msg_emp1.text}"
    assert msg_emp1.json()["ok"] is True
    assert msg_emp1.json()["data"]["seq_no"] == 2

    messages = await client.get(f"/api/v1/chat/chats/{chat_id}/messages?limit=50&offset=0", headers=_headers(token))
    assert messages.status_code == 200, f"List messages failed: {messages.text}"
    assert messages.json()["ok"] is True
    payload = messages.json()["data"]
    assert len(payload) == 2
    assert payload[0]["seq_no"] == 1
    assert payload[1]["seq_no"] == 2

    read_cursor = await client.post(
        f"/api/v1/chat/chats/{chat_id}/read-cursor",
        json={"last_read_seq_no": 2},
        headers=_headers(emp2_token),
    )
    assert read_cursor.status_code == 200, f"Read cursor update failed: {read_cursor.text}"
    assert read_cursor.json()["ok"] is True
    assert read_cursor.json()["data"]["last_read_seq_no"] == 2

    deleted_message = await client.delete(f"/api/v1/chat/messages/{owner_message_id}", headers=_headers(token))
    assert deleted_message.status_code == 200, f"Delete message failed: {deleted_message.text}"
    assert deleted_message.json()["ok"] is True

    deleted_chat = await client.delete(f"/api/v1/chat/chats/{chat_id}", headers=_headers(token))
    assert deleted_chat.status_code == 200, f"Delete chat failed: {deleted_chat.text}"
    assert deleted_chat.json()["ok"] is True

    after_delete = await client.get(f"/api/v1/chat/chats/{chat_id}", headers=_headers(token))
    assert after_delete.status_code == 200
    assert after_delete.json()["ok"] is False
    assert after_delete.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_chat_message_length_and_empty_validation(client: AsyncClient):
    token = await _register_owner(client, org_name="Chat Validation Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Validation Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    too_long = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "a" * 501},
        headers=_headers(token),
    )
    assert too_long.status_code == 422, f"Expected 422 for too long message, got: {too_long.text}"

    only_spaces = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "   "},
        headers=_headers(token),
    )
    assert only_spaces.status_code == 200, f"Spaces-only message request failed: {only_spaces.text}"
    payload = only_spaces.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"
