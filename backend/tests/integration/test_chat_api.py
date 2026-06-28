import asyncio
import uuid
from datetime import UTC, datetime

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
    assert payload[0]["client_message_id"] is None
    assert payload[1]["client_message_id"] is None

    delta = await client.get(
        f"/api/v1/chat/chats/{chat_id}/messages?limit=50&after_seq_no=1",
        headers=_headers(token),
    )
    assert delta.status_code == 200, f"Delta list failed: {delta.text}"
    assert delta.json()["ok"] is True
    delta_payload = delta.json()["data"]
    assert [row["seq_no"] for row in delta_payload] == [2]

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
async def test_employee_chat_owner_can_manage_members_and_delete_chat(client: AsyncClient):
    owner_token = await _register_owner(client, org_name="Chat Employee Admin Org")
    emp_owner_token = await _invite_and_accept_employee(client, owner_token, label="owner-emp")
    member_emp_token = await _invite_and_accept_employee(client, owner_token, label="member-emp")
    target_emp_token = await _invite_and_accept_employee(client, owner_token, label="target-emp")

    emp_owner_me = await client.get("/api/v1/auth/me", headers=_headers(emp_owner_token))
    assert emp_owner_me.status_code == 200, f"Employee-owner profile fetch failed: {emp_owner_me.text}"
    emp_owner_id = emp_owner_me.json()["data"]["id"]

    member_emp_me = await client.get("/api/v1/auth/me", headers=_headers(member_emp_token))
    assert member_emp_me.status_code == 200, f"Member employee profile fetch failed: {member_emp_me.text}"
    member_emp_id = member_emp_me.json()["data"]["id"]

    target_emp_me = await client.get("/api/v1/auth/me", headers=_headers(target_emp_token))
    assert target_emp_me.status_code == 200, f"Target employee profile fetch failed: {target_emp_me.text}"
    target_emp_id = target_emp_me.json()["data"]["id"]

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Employee Managed Chat",
            "member_ids": [member_emp_id],
        },
        headers=_headers(emp_owner_token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    assert created.json()["ok"] is True
    chat_id = created.json()["data"]["id"]
    assert emp_owner_id in created.json()["data"]["member_ids"]

    add_member_by_employee_owner = await client.post(
        f"/api/v1/chat/chats/{chat_id}/members",
        json={"user_id": target_emp_id, "role": "member"},
        headers=_headers(emp_owner_token),
    )
    assert add_member_by_employee_owner.status_code == 200, add_member_by_employee_owner.text
    assert add_member_by_employee_owner.json()["ok"] is True
    assert add_member_by_employee_owner.json()["data"]["user_id"] == target_emp_id

    add_member_by_regular_member = await client.post(
        f"/api/v1/chat/chats/{chat_id}/members",
        json={"user_id": target_emp_id, "role": "member"},
        headers=_headers(member_emp_token),
    )
    assert add_member_by_regular_member.status_code == 403, add_member_by_regular_member.text
    assert add_member_by_regular_member.json()["ok"] is False
    assert add_member_by_regular_member.json()["error"]["code"] == "FORBIDDEN"

    delete_by_regular_member = await client.delete(
        f"/api/v1/chat/chats/{chat_id}",
        headers=_headers(member_emp_token),
    )
    assert delete_by_regular_member.status_code == 403, delete_by_regular_member.text
    assert delete_by_regular_member.json()["ok"] is False
    assert delete_by_regular_member.json()["error"]["code"] == "FORBIDDEN"

    delete_by_employee_owner = await client.delete(
        f"/api/v1/chat/chats/{chat_id}",
        headers=_headers(emp_owner_token),
    )
    assert delete_by_employee_owner.status_code == 200, delete_by_employee_owner.text
    assert delete_by_employee_owner.json()["ok"] is True


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


@pytest.mark.asyncio
async def test_chat_send_message_idempotency_by_client_message_id(client: AsyncClient):
    token = await _register_owner(client, org_name="Chat Idempotency Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Idempotency Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    client_message_id = f"cmid-{uuid.uuid4().hex}"
    first = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "hello once", "client_message_id": client_message_id},
        headers=_headers(token),
    )
    second = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "hello once", "client_message_id": client_message_id},
        headers=_headers(token),
    )
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_data = first.json()["data"]
    second_data = second.json()["data"]
    assert first_data["id"] == second_data["id"]
    assert first_data["seq_no"] == second_data["seq_no"]
    assert first_data["client_message_id"] == client_message_id

    listed = await client.get(
        f"/api/v1/chat/chats/{chat_id}/messages?limit=100&offset=0",
        headers=_headers(token),
    )
    assert listed.status_code == 200, listed.text
    payload = listed.json()["data"]
    assert len(payload) == 1
    assert payload[0]["client_message_id"] == client_message_id


@pytest.mark.asyncio
async def test_chat_concurrent_send_assigns_unique_contiguous_seq_no(client: AsyncClient):
    token = await _register_owner(client, org_name="Chat Seq Concurrency Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Concurrency Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    count = 30

    async def _send(index: int):
        return await client.post(
            f"/api/v1/chat/chats/{chat_id}/messages",
            json={
                "body": f"m-{index}",
                "client_message_id": f"concurrent-{index}-{uuid.uuid4().hex[:8]}",
            },
            headers=_headers(token),
        )

    responses = await asyncio.gather(*[_send(i) for i in range(count)])
    for response in responses:
        assert response.status_code == 200, response.text
        assert response.json()["ok"] is True

    listed = await client.get(
        f"/api/v1/chat/chats/{chat_id}/messages?limit=200&offset=0",
        headers=_headers(token),
    )
    assert listed.status_code == 200, listed.text
    payload = listed.json()["data"]
    assert len(payload) == count
    seq_nos = [row["seq_no"] for row in payload]
    assert seq_nos == list(range(1, count + 1))
    assert len(set(seq_nos)) == count


@pytest.mark.asyncio
async def test_chat_attachment_init_finish_send_and_download_url(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client, org_name="Chat Attachments Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Attachments Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {
            "ContentLength": 13,
            "ContentType": "image/png",
            "ETag": '"preview-etag"',
            "LastModified": datetime(2026, 1, 1, tzinfo=UTC),
        },
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_get_url",
        lambda **_kwargs: "https://download.example.com/get",
    )

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "preview.png",
            "size_bytes": 13,
            "content_type": "image/png",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    upload_data = init_upload.json()["data"]
    file_id = upload_data["file_id"]
    assert upload_data["upload_url"] == "https://upload.example.com/put"

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 13},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True
    assert finish_upload.json()["data"]["status"] == "ready"
    assert finish_upload.json()["data"]["filename"] == "preview.png"
    assert finish_upload.json()["data"]["original_name"] == "preview.png"

    send_message = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "", "meta": {"attachment_ids": [file_id]}},
        headers=_headers(token),
    )
    assert send_message.status_code == 200, f"Send message with attachment failed: {send_message.text}"
    assert send_message.json()["ok"] is True
    message_meta = send_message.json()["data"]["meta"]
    assert isinstance(message_meta, dict)
    assert message_meta["attachment_ids"] == [file_id]
    assert len(message_meta["attachments"]) == 1
    assert message_meta["attachments"][0]["file_id"] == file_id
    assert message_meta["attachments"][0]["filename"] == "preview.png"
    assert message_meta["attachments"][0]["original_name"] == "preview.png"

    download_url = await client.get(
        f"/api/v1/chat/chats/{chat_id}/attachments/{file_id}/download-url",
        headers=_headers(token),
    )
    assert download_url.status_code == 200, f"Get download URL failed: {download_url.text}"
    assert download_url.json()["ok"] is True
    assert download_url.json()["data"]["url"] == "https://download.example.com/get"

    monkeypatch.setattr(
        "src.modules.chat.routes.files_storage.stream_file",
        lambda _s3_key, _bucket: (iter([b"preview-bytes"]), {"ContentLength": 13}),
    )
    preview = await client.get(
        f"/api/v1/chat/chats/{chat_id}/attachments/{file_id}/preview",
        headers=_headers(token),
    )
    assert preview.status_code == 200, f"Get preview failed: {preview.text}"
    assert preview.headers["cache-control"].startswith("private")
    assert preview.headers["etag"] == '"preview-etag"'
    assert preview.content == b"preview-bytes"

    cached_preview = await client.get(
        f"/api/v1/chat/chats/{chat_id}/attachments/{file_id}/preview",
        headers={**_headers(token), "If-None-Match": '"preview-etag"'},
    )
    assert cached_preview.status_code == 304


@pytest.mark.asyncio
async def test_chat_attachment_limits_one_file_and_10mb(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client, org_name="Chat Attachments Limits Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Attachments Limits Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )

    plain_file = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "note.txt",
            "size_bytes": 10,
            "content_type": "text/plain",
        },
        headers=_headers(token),
    )
    assert plain_file.status_code == 200, f"Plain file request failed: {plain_file.text}"
    assert plain_file.json()["ok"] is True

    too_large = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "big.mp4",
            "size_bytes": 11 * 1024 * 1024,
            "content_type": "video/mp4",
        },
        headers=_headers(token),
    )
    assert too_large.status_code == 200, f"Too large request failed: {too_large.text}"
    assert too_large.json()["ok"] is False
    assert too_large.json()["error"]["code"] == "FILE_TOO_LARGE"

    too_many_attachment_ids = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={
            "body": "has attachments",
            "meta": {
                "attachment_ids": [
                    str(uuid.uuid4()),
                    str(uuid.uuid4()),
                ],
            },
        },
        headers=_headers(token),
    )
    assert too_many_attachment_ids.status_code == 200, f"Too many attachment IDs failed: {too_many_attachment_ids.text}"
    assert too_many_attachment_ids.json()["ok"] is False
    assert too_many_attachment_ids.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_chat_voice_note_allows_audio_up_to_1_minute(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client, org_name="Chat Voice Note Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Voice Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {"ContentLength": 2048},
    )

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "voice-note.ogg",
            "size_bytes": 2048,
            "content_type": "audio/ogg",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 2048},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True

    send_voice = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={
            "body": "",
            "meta": {
                "attachment_ids": [file_id],
                "voice_note": {"file_id": file_id, "duration_ms": 59_000},
            },
        },
        headers=_headers(token),
    )
    assert send_voice.status_code == 200, f"Send voice message failed: {send_voice.text}"
    assert send_voice.json()["ok"] is True


@pytest.mark.asyncio
async def test_chat_voice_note_rejects_duration_over_1_minute(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client, org_name="Chat Voice Note Limit Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Voice Chat Limit",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {"ContentLength": 4096},
    )

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "voice-limit.ogg",
            "size_bytes": 4096,
            "content_type": "audio/ogg",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 4096},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True

    send_voice = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={
            "body": "",
            "meta": {
                "attachment_ids": [file_id],
                "voice_note": {"file_id": file_id, "duration_ms": 61_000},
            },
        },
        headers=_headers(token),
    )
    assert send_voice.status_code == 200, f"Voice limit request failed: {send_voice.text}"
    assert send_voice.json()["ok"] is False
    assert send_voice.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_chat_delete_message_removes_attachment_from_s3(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client, org_name="Chat Delete Message Attachments Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Delete Message Attachment Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    deleted_from_s3: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {"ContentLength": 3210},
    )

    def _fake_delete_file(s3_key: str, bucket: str) -> None:
        deleted_from_s3.append((s3_key, bucket))

    monkeypatch.setattr("src.modules.chat.service.files_storage.delete_file", _fake_delete_file)

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "photo.png",
            "size_bytes": 3210,
            "content_type": "image/png",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 3210},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True

    send_message = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={"body": "", "meta": {"attachment_ids": [file_id]}},
        headers=_headers(token),
    )
    assert send_message.status_code == 200, f"Send message failed: {send_message.text}"
    assert send_message.json()["ok"] is True
    message_id = send_message.json()["data"]["id"]

    deleted_message = await client.delete(f"/api/v1/chat/messages/{message_id}", headers=_headers(token))
    assert deleted_message.status_code == 200, f"Delete message failed: {deleted_message.text}"
    assert deleted_message.json()["ok"] is True
    assert len(deleted_from_s3) == 1

    no_download = await client.get(
        f"/api/v1/chat/chats/{chat_id}/attachments/{file_id}/download-url",
        headers=_headers(token),
    )
    assert no_download.status_code == 200
    assert no_download.json()["ok"] is False
    assert no_download.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_chat_delete_chat_enqueues_background_attachment_cleanup(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    token = await _register_owner(client, org_name="Chat Delete Chat Attachments Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Delete Chat Attachment Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat_id = created.json()["data"]["id"]

    cleanup_calls: list[dict[str, object]] = []

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {"ContentLength": 4096},
    )

    class _DummyTaskResult:
        id = "chat-cleanup-task-1"

    def _fake_delay(*, org_id: str, file_ids: list[str]):
        cleanup_calls.append({"org_id": org_id, "file_ids": file_ids})
        return _DummyTaskResult()

    monkeypatch.setattr("src.modules.chat.routes.chat_cleanup_attachments.delay", _fake_delay)

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "voice.ogg",
            "size_bytes": 4096,
            "content_type": "audio/ogg",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 4096},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True

    send_message = await client.post(
        f"/api/v1/chat/chats/{chat_id}/messages",
        json={
            "body": "",
            "meta": {
                "attachment_ids": [file_id],
                "voice_note": {"file_id": file_id, "duration_ms": 3000},
            },
        },
        headers=_headers(token),
    )
    assert send_message.status_code == 200, f"Send message failed: {send_message.text}"
    assert send_message.json()["ok"] is True

    deleted_chat = await client.delete(f"/api/v1/chat/chats/{chat_id}", headers=_headers(token))
    assert deleted_chat.status_code == 200, f"Delete chat failed: {deleted_chat.text}"
    assert deleted_chat.json()["ok"] is True
    assert len(cleanup_calls) == 1
    assert cleanup_calls[0]["file_ids"] == [file_id]


@pytest.mark.asyncio
async def test_chat_cleanup_task_removes_orphan_chat_attachments(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from src.modules.chat.tasks import chat_cleanup_attachments

    token = await _register_owner(client, org_name="Chat Task Cleanup Attachments Org")

    created = await client.post(
        "/api/v1/chat/chats",
        json={
            "chat_type": "group",
            "title": "Cleanup Task Attachment Chat",
            "member_ids": [],
        },
        headers=_headers(token),
    )
    assert created.status_code == 200, f"Create chat failed: {created.text}"
    chat = created.json()["data"]
    chat_id = chat["id"]
    org_id = chat["org_id"]

    deleted_from_s3: list[tuple[str, str]] = []

    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.generate_presigned_put_url",
        lambda **kwargs: ("https://upload.example.com/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.chat.service.files_storage.head_object",
        lambda _s3_key, _bucket: {"ContentLength": 4096},
    )
    def _fake_delete_file(s3_key: str, bucket: str) -> None:
        deleted_from_s3.append((s3_key, bucket))

    monkeypatch.setattr("src.modules.chat.tasks.files_storage.delete_file", _fake_delete_file)

    init_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/init-upload",
        json={
            "filename": "voice.ogg",
            "size_bytes": 4096,
            "content_type": "audio/ogg",
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200, f"Init upload failed: {init_upload.text}"
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish_upload = await client.post(
        f"/api/v1/chat/chats/{chat_id}/attachments/finish-upload",
        json={"file_id": file_id, "size_bytes": 4096},
        headers=_headers(token),
    )
    assert finish_upload.status_code == 200, f"Finish upload failed: {finish_upload.text}"
    assert finish_upload.json()["ok"] is True

    result = chat_cleanup_attachments.run(org_id=org_id, file_ids=[file_id])
    assert result["received"] == 1
    assert result["deleted"] in {0, 1}
    assert result["skipped"] in {0, 1}
    assert result["deleted"] + result["skipped"] == 1
    if result["deleted"] == 1:
        assert len(deleted_from_s3) == 1


@pytest.mark.asyncio
async def test_chat_client_config_rollout_flags(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from src.config import settings

    token = await _register_owner(client, org_name="Chat Client Config Org")

    monkeypatch.setattr(settings, "CHAT_REALTIME_ROLLOUT_ENABLED", True)
    monkeypatch.setattr(settings, "CHAT_REALTIME_ROLLOUT_PERCENT", 0)
    monkeypatch.setattr(settings, "CHAT_TELEMETRY_ENABLED", False)

    response = await client.get("/api/v1/chat/client-config", headers=_headers(token))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["realtime_enabled"] is False
    assert payload["data"]["realtime_rollout_percent"] == 0
    assert payload["data"]["telemetry_enabled"] is False

    monkeypatch.setattr(settings, "CHAT_REALTIME_ROLLOUT_PERCENT", 100)
    monkeypatch.setattr(settings, "CHAT_TELEMETRY_ENABLED", True)

    response2 = await client.get("/api/v1/chat/client-config", headers=_headers(token))
    assert response2.status_code == 200, response2.text
    payload2 = response2.json()
    assert payload2["ok"] is True
    assert payload2["data"]["realtime_enabled"] is True
    assert payload2["data"]["realtime_rollout_percent"] == 100
    assert payload2["data"]["telemetry_enabled"] is True


@pytest.mark.asyncio
async def test_chat_telemetry_endpoint_accepts_events(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    from src.config import settings

    token = await _register_owner(client, org_name="Chat Telemetry Org")
    monkeypatch.setattr(settings, "CHAT_TELEMETRY_ENABLED", True)

    response = await client.post(
        "/api/v1/chat/telemetry",
        json={
            "event": "message_lag",
            "value": 1.25,
            "meta": {"source": "integration-test"},
        },
        headers=_headers(token),
    )
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True

    monkeypatch.setattr(settings, "CHAT_TELEMETRY_ENABLED", False)
    response2 = await client.post(
        "/api/v1/chat/telemetry",
        json={"event": "ws_reconnect", "value": 0.3},
        headers=_headers(token),
    )
    assert response2.status_code == 200, response2.text
    assert response2.json()["ok"] is True
