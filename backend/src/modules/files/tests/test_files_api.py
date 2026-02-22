import uuid

import pytest
from httpx import AsyncClient


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
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    mem_storage: dict[tuple[str, str], tuple[bytes, str]] = {}

    def _fake_upload(data: bytes, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
        ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
        key = f"{org_id}/{uuid.uuid4().hex}.{ext}"
        bucket = "test-bucket"
        mem_storage[(bucket, key)] = (data, content_type)
        return key, bucket

    def _fake_download(s3_key: str, bucket: str) -> tuple[bytes, str]:
        return mem_storage[(bucket, s3_key)]

    def _fake_delete(s3_key: str, bucket: str) -> None:
        mem_storage.pop((bucket, s3_key), None)

    monkeypatch.setattr("src.modules.files.service.storage.upload_file", _fake_upload)
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

