import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import Plan


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_files_upload_list_download_delete(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    email = f"files-owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Files API Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    mem_storage: dict[tuple[str, str], tuple[bytes, str]] = {}

    def _store_payload(payload: bytes, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
        key = f"{org_id}/{uuid.uuid4().hex}.{ext}"
        bucket = "test-bucket"
        mem_storage[(bucket, key)] = (payload, content_type)
        return key, bucket

    def _fake_upload(data: bytes, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        return _store_payload(data, content_type, org_id, original_name)

    def _fake_upload_fileobj(fileobj, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        fileobj.seek(0)
        payload = fileobj.read()
        return _store_payload(payload, content_type, org_id, original_name)

    def _fake_download(s3_key: str, bucket: str) -> tuple[bytes, str]:
        return mem_storage[(bucket, s3_key)]

    def _fake_delete(s3_key: str, bucket: str) -> None:
        mem_storage.pop((bucket, s3_key), None)

    monkeypatch.setattr("src.modules.files.service.storage.upload_file", _fake_upload)
    monkeypatch.setattr("src.modules.files.service.storage.upload_fileobj", _fake_upload_fileobj)
    monkeypatch.setattr("src.modules.files.service.storage.download_file", _fake_download)
    monkeypatch.setattr("src.modules.files.service.storage.delete_file", _fake_delete)

    upload = await client.post(
        "/api/v1/files/upload",
        files={"file": ("spec.txt", b"hello-files", "text/plain")},
        headers=_headers(token),
    )
    assert upload.status_code == 200
    assert upload.json()["ok"] is True
    file_id = upload.json()["data"]["id"]

    listed = await client.get("/api/v1/files/?limit=50&offset=0", headers=_headers(token))
    assert listed.status_code == 200
    assert listed.json()["ok"] is True
    assert any(x["id"] == file_id for x in listed.json()["data"])

    downloaded = await client.get(f"/api/v1/files/{file_id}/download", headers=_headers(token))
    assert downloaded.status_code == 200
    assert downloaded.content == b"hello-files"
    assert downloaded.headers.get("content-type", "").startswith("text/plain")

    deleted = await client.delete(f"/api/v1/files/{file_id}", headers=_headers(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = await client.get(f"/api/v1/files/{file_id}/download", headers=_headers(token))
    assert missing.status_code == 200
    assert missing.json()["ok"] is False
    assert missing.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_upload_respects_plan_storage_limit(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    email = f"files-limit-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": "Files Limit Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one_or_none()
        if free_plan is None:
            from src.modules.billing.seed import upsert_default_plans

            await upsert_default_plans(uow.session)
            free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one()
        free_plan.max_storage_mb = 1
        await uow.commit()

    mem_storage: dict[tuple[str, str], tuple[bytes, str]] = {}

    def _store_payload(payload: bytes, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
        key = f"{org_id}/{uuid.uuid4().hex}.{ext}"
        bucket = "test-bucket"
        mem_storage[(bucket, key)] = (payload, content_type)
        return key, bucket

    def _fake_upload_fileobj(fileobj, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        fileobj.seek(0)
        payload = fileobj.read()
        return _store_payload(payload, content_type, org_id, original_name)

    monkeypatch.setattr("src.modules.files.service.storage.upload_fileobj", _fake_upload_fileobj)
    monkeypatch.setattr("src.modules.files.service.storage.delete_file", lambda *_args, **_kwargs: None)

    payload = b"a" * (700 * 1024)
    first = await client.post(
        "/api/v1/files/upload",
        files={"file": ("one.txt", payload, "text/plain")},
        headers=_headers(token),
    )
    assert first.status_code == 200
    assert first.json()["ok"] is True

    second = await client.post(
        "/api/v1/files/upload",
        files={"file": ("two.txt", payload, "text/plain")},
        headers=_headers(token),
    )
    assert second.status_code == 200
    assert second.json()["ok"] is False
    assert second.json()["error"]["code"] == "STORAGE_LIMIT_REACHED"
