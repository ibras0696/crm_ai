"""Регрессионные и интеграционные тесты Sprint 2 для модуля Docs."""

from __future__ import annotations

import asyncio
import base64
import os
import uuid
from contextlib import contextmanager
from datetime import timedelta
from io import BytesIO
from urllib.parse import parse_qs, urlparse, urlsplit, urlunsplit
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest
from httpx import AsyncClient
from PIL import Image, ImageDraw
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.models import AuditLog
from src.modules.billing.models import Plan
from src.modules.docs.ai_generator import AIGeneratedDocument, AIGenerationRuntime
from src.modules.docs.models import FileVersion
from src.modules.docs.tasks import cleanup_old_doc_versions, pdf_stamp_sign, run_ai_generate_inline, scan_version
from src.modules.files.models import File


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _disable_scan_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.modules.docs.routes.scan_version.delay", lambda *_args, **_kwargs: None)


def _with_db(url: str, db_name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{db_name}", parts.query, parts.fragment))


def _build_test_sync_session_factory():
    test_db_name = f"{getattr(settings, 'POSTGRES_DB', 'crm_db')}_test"
    sync_url = os.getenv("TEST_DATABASE_URL_SYNC") or _with_db(settings.DATABASE_URL_SYNC, test_db_name)
    engine = create_engine(sync_url, future=True, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    @contextmanager
    def _factory():
        session: Session = session_factory()
        try:
            yield session
        finally:
            session.close()

    return _factory


async def _register_owner(client: AsyncClient) -> str:
    email = f"docs-owner-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Docs",
            "last_name": "Owner",
            "org_name": f"Docs Org {uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert response.status_code == 201
    return response.json()["data"]["access_token"]


async def _create_ready_txt_file(
    client: AsyncClient,
    token: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    size_bytes: int = 9,
) -> str:
    """Создать TXT-файл и перевести его в READY через scan task."""
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())
    monkeypatch.setattr(
        "src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes",
        lambda **_kwargs: b"seed text",
    )

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "editable.txt",
            "content_type": "text/plain",
            "size_bytes": size_bytes,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True

    file_id = init_upload.json()["data"]["file_id"]
    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": size_bytes},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    version_id = finish.json()["data"]["current_version_id"]
    result = scan_version.run(version_id)
    assert result["status"] == "ready"
    return str(file_id)


def _make_pdf_bytes(text: str = "Docs PDF") -> bytes:
    """Сгенерировать минимальный валидный PDF для тестов."""
    stream = BytesIO()
    c = canvas.Canvas(stream, pagesize=(595, 842))
    c.drawString(72, 780, text)
    c.showPage()
    c.drawString(72, 780, f"{text} page 2")
    c.showPage()
    c.drawString(72, 780, f"{text} page 3")
    c.showPage()
    c.drawString(72, 780, f"{text} page 4")
    c.showPage()
    c.drawString(72, 780, f"{text} page 5")
    c.showPage()
    c.save()
    return stream.getvalue()


def _make_signature_data_url() -> str:
    """Сгенерировать валидную PNG-подпись (data-url)."""
    image = Image.new("RGBA", (220, 90), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.line((8, 60, 70, 20, 120, 70, 210, 30), fill=(20, 20, 20, 255), width=4)
    stream = BytesIO()
    image.save(stream, format="PNG")
    encoded = base64.b64encode(stream.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _make_docx_bytes(text: str = "Hello DOCX") -> bytes:
    """Сгенерировать минимальный валидный DOCX."""
    stream = BytesIO()
    with ZipFile(stream, mode="w", compression=ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                "</Types>"
            ),
        )
        archive.writestr(
            "_rels/.rels",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/>'
                "</Relationships>"
            ),
        )
        archive.writestr(
            "word/document.xml",
            (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>"
                "</w:document>"
            ),
        )
    return stream.getvalue()


def _patch_ai_generation_stubs(monkeypatch: pytest.MonkeyPatch, *, text: str = "AI generated content") -> None:
    """Подменить AI runtime/generate вызовы предсказуемыми заглушками."""

    async def _fake_resolve_runtime(*_args, **_kwargs) -> AIGenerationRuntime:
        return AIGenerationRuntime(
            base_url="https://example-ai.local",
            bearer_token="test-token",
            provider_mode="openai_compatible",
            model="gpt-test",
            temperature=0.2,
            max_tokens=1500,
        )

    async def _fake_generate_text(*_args, **_kwargs) -> AIGeneratedDocument:
        return AIGeneratedDocument(
            text=text,
            usage={"prompt_tokens": 80, "completion_tokens": 220, "total_tokens": 300},
            model="gpt-test",
            provider_mode="openai_compatible",
        )

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime", _fake_resolve_runtime)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime", _fake_resolve_runtime)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_AI_DOCUMENT_GENERATOR.generate_text", _fake_generate_text)


async def _create_ready_docx_file(
    client: AsyncClient,
    token: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    docx_bytes: bytes,
) -> tuple[str, str]:
    """Создать DOCX-файл и довести до READY."""
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    storage_map: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map[key]

    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _get_object_bytes)

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "edit-me.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "size_bytes": len(docx_bytes),
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = str(init_upload.json()["data"]["file_id"])

    async with UnitOfWork() as uow:
        file_row = (
            await uow.session.execute(
                select(File).where(File.id == uuid.UUID(file_id)).limit(1),
            )
        ).scalar_one()
        storage_map[file_row.s3_key] = docx_bytes

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": len(docx_bytes)},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    version_id = str(finish.json()["data"]["current_version_id"])

    result = scan_version.run(version_id)
    assert result["status"] == "ready"
    return file_id, version_id


async def _create_ready_pdf_file(
    client: AsyncClient,
    token: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    pdf_bytes: bytes,
) -> tuple[str, str]:
    """Создать PDF-файл, провести scan и вернуть `(file_id, version_id)`."""
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    storage_map: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map[key]

    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _get_object_bytes)

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "sign-me.pdf",
            "content_type": "application/pdf",
            "size_bytes": len(pdf_bytes),
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = str(init_upload.json()["data"]["file_id"])

    async with UnitOfWork() as uow:
        file_row = (
            await uow.session.execute(
                select(File).where(File.id == uuid.UUID(file_id)).limit(1),
            )
        ).scalar_one()
        storage_map[file_row.s3_key] = pdf_bytes

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": len(pdf_bytes)},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    version_id = str(finish.json()["data"]["current_version_id"])

    result = scan_version.run(version_id)
    assert result["status"] == "ready"
    return file_id, version_id


@pytest.mark.asyncio
async def test_docs_folder_tree_upload_scanning_and_usage(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_get_url",
        lambda **kwargs: "https://example.local/get",
    )

    root = await client.post("/api/v1/docs/folders", json={"name": "Root"}, headers=_headers(token))
    assert root.status_code == 200
    assert root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/docs/folders",
        json={"name": "Child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200
    assert child.json()["ok"] is True
    child_id = child.json()["data"]["id"]

    grandchild = await client.post(
        "/api/v1/docs/folders",
        json={"name": "GrandChild", "parent_id": child_id},
        headers=_headers(token),
    )
    assert grandchild.status_code == 200
    assert grandchild.json()["ok"] is True
    grandchild_id = grandchild.json()["data"]["id"]

    too_deep = await client.post(
        "/api/v1/docs/folders",
        json={"name": "TooDeep", "parent_id": grandchild_id},
        headers=_headers(token),
    )
    assert too_deep.status_code == 200
    assert too_deep.json()["ok"] is False
    assert too_deep.json()["error"]["code"] in {"INVALID_DEPTH", "MAX_DEPTH_EXCEEDED"}

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "spec.txt",
            "content_type": "text/plain",
            "size_bytes": 1024,
            "folder_id": grandchild_id,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 1024},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    assert finish.json()["data"]["status"] == "scanning"
    assert finish.json()["data"]["type"] == "txt"

    # До завершения сканирования скачивание запрещено.
    download = await client.get(f"/api/v1/docs/files/{file_id}/download", headers=_headers(token))
    assert download.status_code == 200
    assert download.json()["ok"] is False
    assert download.json()["error"]["code"] == "FILE_NOT_READY"

    tree = await client.get("/api/v1/docs/tree", headers=_headers(token))
    assert tree.status_code == 200
    assert tree.json()["ok"] is True
    assert any(item["id"] == file_id for item in tree.json()["data"]["files"])

    usage = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert usage.status_code == 200
    assert usage.json()["ok"] is True
    assert usage.json()["data"]["used_bytes"] == 0
    assert usage.json()["data"]["reserved_bytes"] == 1024


@pytest.mark.asyncio
async def test_docs_abort_upload_releases_reserved_and_hides_file(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "cancel-me.pdf",
            "content_type": "application/pdf",
            "size_bytes": 4096,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = str(init_upload.json()["data"]["file_id"])

    usage_before = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert usage_before.status_code == 200
    assert usage_before.json()["ok"] is True
    assert int(usage_before.json()["data"]["reserved_bytes"]) >= 4096

    abort_upload = await client.post(f"/api/v1/docs/files/{file_id}/abort-upload", headers=_headers(token))
    assert abort_upload.status_code == 200
    assert abort_upload.json()["ok"] is True
    assert abort_upload.json()["data"]["status"] == "deleted"

    usage_after = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert usage_after.status_code == 200
    assert usage_after.json()["ok"] is True
    assert int(usage_after.json()["data"]["reserved_bytes"]) == (
        int(usage_before.json()["data"]["reserved_bytes"]) - 4096
    )

    tree = await client.get("/api/v1/docs/tree", headers=_headers(token))
    assert tree.status_code == 200
    assert tree.json()["ok"] is True
    assert all(item["id"] != file_id for item in tree.json()["data"]["files"])


@pytest.mark.asyncio
async def test_docs_abort_upload_for_non_uploading_file_rejected(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "no-abort.txt",
            "content_type": "text/plain",
            "size_bytes": 10,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = str(init_upload.json()["data"]["file_id"])

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 10},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    assert finish.json()["data"]["status"] == "scanning"

    abort_upload = await client.post(f"/api/v1/docs/files/{file_id}/abort-upload", headers=_headers(token))
    assert abort_upload.status_code == 200
    assert abort_upload.json()["ok"] is False
    assert abort_upload.json()["error"]["code"] == "INVALID_STATUS"


@pytest.mark.asyncio
async def test_docs_create_empty_file_and_move_between_folders(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)

    created_objects: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        created_objects[key] = payload

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_get_url",
        lambda **_kwargs: "https://example.local/get",
    )

    folder_a = await client.post("/api/v1/docs/folders", json={"name": "Folder A"}, headers=_headers(token))
    assert folder_a.status_code == 200
    assert folder_a.json()["ok"] is True
    folder_a_id = str(folder_a.json()["data"]["id"])

    folder_b = await client.post("/api/v1/docs/folders", json={"name": "Folder B"}, headers=_headers(token))
    assert folder_b.status_code == 200
    assert folder_b.json()["ok"] is True
    folder_b_id = str(folder_b.json()["data"]["id"])

    create_empty = await client.post(
        "/api/v1/docs/files/create-empty",
        json={"type": "docx", "title": "Пустой документ", "folder_id": folder_a_id},
        headers=_headers(token),
    )
    assert create_empty.status_code == 200
    assert create_empty.json()["ok"] is True
    assert create_empty.json()["data"]["type"] == "docx"
    assert create_empty.json()["data"]["status"] == "ready"
    assert create_empty.json()["data"]["folder_id"] == folder_a_id
    assert int(create_empty.json()["data"]["size"]) > 0
    assert created_objects
    file_id = str(create_empty.json()["data"]["id"])

    async with UnitOfWork() as uow:
        created_file = (
            await uow.session.execute(
                select(File).where(File.id == uuid.UUID(file_id)).limit(1),
            )
        ).scalar_one()
        original_s3_key = created_file.s3_key

    usage = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert usage.status_code == 200
    assert usage.json()["ok"] is True
    assert int(usage.json()["data"]["used_bytes"]) >= int(create_empty.json()["data"]["size"])

    move_to_b = await client.patch(
        f"/api/v1/docs/files/{file_id}",
        json={"folder_id": folder_b_id},
        headers=_headers(token),
    )
    assert move_to_b.status_code == 200
    assert move_to_b.json()["ok"] is True
    assert move_to_b.json()["data"]["folder_id"] == folder_b_id

    move_to_root = await client.patch(
        f"/api/v1/docs/files/{file_id}",
        json={"folder_id": None},
        headers=_headers(token),
    )
    assert move_to_root.status_code == 200
    assert move_to_root.json()["ok"] is True
    assert move_to_root.json()["data"]["folder_id"] is None

    async with UnitOfWork() as uow:
        moved_file = (
            await uow.session.execute(
                select(File).where(File.id == uuid.UUID(file_id)).limit(1),
            )
        ).scalar_one()
        assert moved_file.folder_id is None
        assert moved_file.s3_key == original_s3_key
        assert moved_file.s3_key in created_objects
        assert len(created_objects) == 1

    download = await client.get(f"/api/v1/docs/files/{file_id}/download", headers=_headers(token))
    assert download.status_code == 200
    assert download.json()["ok"] is True
    assert str(download.json()["data"]["url"]).startswith("https://example.local/get")


@pytest.mark.asyncio
async def test_docs_move_file_to_unknown_folder_returns_error(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)
    file_id = await _create_ready_txt_file(client, token, monkeypatch)
    bad_folder_id = str(uuid.uuid4())

    moved = await client.patch(
        f"/api/v1/docs/files/{file_id}",
        json={"folder_id": bad_folder_id},
        headers=_headers(token),
    )
    assert moved.status_code == 200
    assert moved.json()["ok"] is False
    assert moved.json()["error"]["code"] == "FOLDER_NOT_FOUND"


@pytest.mark.asyncio
async def test_docs_move_folder_between_parents_and_reject_too_deep_subtree(client: AsyncClient):
    token = await _register_owner(client)

    root_a = await client.post("/api/v1/docs/folders", json={"name": "Root A"}, headers=_headers(token))
    assert root_a.status_code == 200
    root_a_id = str(root_a.json()["data"]["id"])

    root_b = await client.post("/api/v1/docs/folders", json={"name": "Root B"}, headers=_headers(token))
    assert root_b.status_code == 200
    root_b_id = str(root_b.json()["data"]["id"])

    child_a = await client.post(
        "/api/v1/docs/folders",
        json={"name": "Child A", "parent_id": root_a_id},
        headers=_headers(token),
    )
    assert child_a.status_code == 200
    child_a_id = str(child_a.json()["data"]["id"])

    grandchild_a = await client.post(
        "/api/v1/docs/folders",
        json={"name": "Grandchild A", "parent_id": child_a_id},
        headers=_headers(token),
    )
    assert grandchild_a.status_code == 200

    child_b = await client.post(
        "/api/v1/docs/folders",
        json={"name": "Child B", "parent_id": root_b_id},
        headers=_headers(token),
    )
    assert child_b.status_code == 200
    child_b_id = str(child_b.json()["data"]["id"])

    move_to_root_b = await client.patch(
        f"/api/v1/docs/folders/{child_a_id}",
        json={"parent_id": root_b_id},
        headers=_headers(token),
    )
    assert move_to_root_b.status_code == 200
    assert move_to_root_b.json()["ok"] is True
    assert move_to_root_b.json()["data"]["parent_id"] == root_b_id

    move_back_to_root = await client.patch(
        f"/api/v1/docs/folders/{child_a_id}",
        json={"parent_id": None},
        headers=_headers(token),
    )
    assert move_back_to_root.status_code == 200
    assert move_back_to_root.json()["ok"] is True
    assert move_back_to_root.json()["data"]["parent_id"] is None

    too_deep_move = await client.patch(
        f"/api/v1/docs/folders/{child_a_id}",
        json={"parent_id": child_b_id},
        headers=_headers(token),
    )
    assert too_deep_move.status_code == 200
    assert too_deep_move.json()["ok"] is False
    assert too_deep_move.json()["error"]["code"] in {"INVALID_DEPTH", "MAX_DEPTH_EXCEEDED"}


@pytest.mark.asyncio
async def test_docs_parallel_init_upload_respects_quota(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)

    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one_or_none()
        if free_plan is None:
            from src.modules.billing.seed import upsert_default_plans

            await upsert_default_plans(uow.session)
            free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one()
        free_plan.max_storage_mb = 1
        await uow.commit()

    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )

    payload = {
        "filename": "parallel.txt",
        "content_type": "text/plain",
        "size_bytes": 700 * 1024,
    }

    async def _call_init() -> dict:
        response = await client.post("/api/v1/docs/files/init-upload", json=payload, headers=_headers(token))
        assert response.status_code == 200
        return response.json()

    first, second = await asyncio.gather(_call_init(), _call_init())
    results = [first, second]

    ok_count = sum(1 for item in results if item["ok"] is True)
    err_codes = {item["error"]["code"] for item in results if item["ok"] is False}

    assert ok_count == 1
    assert "QUOTA_EXCEEDED" in err_codes


@pytest.mark.asyncio
async def test_docs_fake_pdf_is_blocked_after_scan(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes",
        lambda **_kwargs: b"this is not a pdf binary",
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "fake.pdf",
            "content_type": "application/pdf",
            "size_bytes": 32,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True

    file_id = init_upload.json()["data"]["file_id"]
    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 32},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    assert finish.json()["data"]["status"] == "scanning"

    version_id = finish.json()["data"]["current_version_id"]
    result = scan_version.run(version_id)
    assert result["status"] == "blocked"

    file_info = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_info.status_code == 200
    assert file_info.json()["ok"] is True
    assert file_info.json()["data"]["status"] == "blocked"

    download = await client.get(f"/api/v1/docs/files/{file_id}/download", headers=_headers(token))
    assert download.status_code == 200
    assert download.json()["ok"] is False
    assert download.json()["error"]["code"] == "FILE_NOT_READY"


@pytest.mark.asyncio
async def test_docs_upload_size_limit_and_not_ready_download(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )

    too_big = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "big.pdf",
            "content_type": "application/pdf",
            "size_bytes": (int(settings.FILE_MAX_UPLOAD_MB) + 1) * 1024 * 1024,
        },
        headers=_headers(token),
    )
    assert too_big.status_code == 200
    assert too_big.json()["ok"] is False
    assert too_big.json()["error"]["code"] == "FILE_TOO_LARGE"

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "draft.pdf",
            "content_type": "application/pdf",
            "size_bytes": 100,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True

    file_id = init_upload.json()["data"]["file_id"]
    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 100},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True

    not_ready = await client.get(f"/api/v1/docs/files/{file_id}/download", headers=_headers(token))
    assert not_ready.status_code == 200
    assert not_ready.json()["ok"] is False
    assert not_ready.json()["error"]["code"] == "FILE_NOT_READY"


@pytest.mark.asyncio
async def test_docs_extension_mime_mismatch_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    bad_init = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "wrong.pdf",
            "content_type": "text/plain",
            "size_bytes": 32,
        },
        headers=_headers(token),
    )
    assert bad_init.status_code == 200
    assert bad_init.json()["ok"] is False
    assert bad_init.json()["error"]["code"] == "INVALID_TYPE"


@pytest.mark.asyncio
async def test_docs_audit_events_for_upload_and_scan(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)

    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr(
        "src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes",
        lambda **_kwargs: b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n",
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "audit.pdf",
            "content_type": "application/pdf",
            "size_bytes": 32,
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = init_upload.json()["data"]["file_id"]

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 32},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    version_id = finish.json()["data"]["current_version_id"]

    _ = scan_version.run(version_id)

    async with UnitOfWork() as uow:
        rows = (
            (
                await uow.session.execute(
                    select(AuditLog).where(AuditLog.entity_type == "docs_file", AuditLog.entity_id == file_id)
                )
            )
            .scalars()
            .all()
        )
        events = {
            str((row.meta or {}).get("event"))
            for row in rows
            if isinstance(row.meta, dict) and (row.meta or {}).get("event")
        }
    assert {"upload_started", "upload_finished", "scan_result"}.issubset(events)


@pytest.mark.asyncio
async def test_docs_save_text_creates_new_version_and_updates_usage_and_audit(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)
    file_id = await _create_ready_txt_file(client, token, monkeypatch, size_bytes=9)

    storage_map: dict[str, bytes] = {}

    def _fake_put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _fake_get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map.get(key, b"seed text")

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _fake_put_object_bytes)
    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _fake_get_object_bytes)

    before_usage = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert before_usage.status_code == 200
    assert before_usage.json()["ok"] is True
    assert int(before_usage.json()["data"]["used_bytes"]) == 9

    old_file = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert old_file.status_code == 200
    old_version_id = old_file.json()["data"]["current_version_id"]
    old_updated_at = old_file.json()["data"]["updated_at"]

    text_payload = "новая версия текста для проверки sprint3"
    save = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": text_payload, "title": "Editable TXT", "expected_updated_at": old_updated_at},
        headers=_headers(token),
    )
    assert save.status_code == 200
    assert save.json()["ok"] is True
    assert save.json()["data"]["status"] == "ready"
    assert save.json()["data"]["current_version_id"] != old_version_id
    assert save.json()["data"]["title"] == "Editable TXT"

    versions = await client.get(f"/api/v1/docs/files/{file_id}/versions", headers=_headers(token))
    assert versions.status_code == 200
    assert versions.json()["ok"] is True
    assert len(versions.json()["data"]) >= 2
    assert versions.json()["data"][0]["id"] == save.json()["data"]["current_version_id"]

    text_out = await client.get(f"/api/v1/docs/files/{file_id}/text", headers=_headers(token))
    assert text_out.status_code == 200
    assert text_out.json()["ok"] is True
    assert text_out.json()["data"]["content"] == text_payload

    after_usage = await client.get("/api/v1/docs/usage", headers=_headers(token))
    assert after_usage.status_code == 200
    assert after_usage.json()["ok"] is True
    assert int(after_usage.json()["data"]["used_bytes"]) == len(text_payload.encode("utf-8"))

    async with UnitOfWork() as uow:
        audit_rows = (
            (
                await uow.session.execute(
                    select(AuditLog).where(
                        AuditLog.entity_id.in_([str(file_id), str(save.json()["data"]["current_version_id"])]),
                    )
                )
            )
            .scalars()
            .all()
        )
    events = {
        str((row.meta or {}).get("event"))
        for row in audit_rows
        if isinstance(row.meta, dict) and (row.meta or {}).get("event")
    }
    assert "text_saved" in events
    assert "version_created" in events


@pytest.mark.asyncio
async def test_docs_save_text_conflict_returns_409(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    file_id = await _create_ready_txt_file(client, token, monkeypatch, size_bytes=9)

    storage_map: dict[str, bytes] = {}

    def _fake_put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _fake_get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map.get(key, b"seed text")

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _fake_put_object_bytes)
    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _fake_get_object_bytes)

    file_before = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_before.status_code == 200
    stale_updated_at = file_before.json()["data"]["updated_at"]

    first_save = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": "first update", "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert first_save.status_code == 200

    second_save = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": "stale update", "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert second_save.status_code == 409
    body = second_save.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_docs_save_text_rate_limit(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    file_id = await _create_ready_txt_file(client, token, monkeypatch, size_bytes=9)

    storage_map: dict[str, bytes] = {}

    def _fake_put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _fake_get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map.get(key, b"seed text")

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _fake_put_object_bytes)
    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _fake_get_object_bytes)
    monkeypatch.setattr(settings, "DOCS_TEXT_SAVE_RPM", 2)

    file_before = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_before.status_code == 200
    expected_updated_at = file_before.json()["data"]["updated_at"]

    first = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": "v1", "expected_updated_at": expected_updated_at},
        headers=_headers(token),
    )
    assert first.status_code == 200
    assert first.json()["ok"] is True
    expected_updated_at = first.json()["data"]["updated_at"]

    second = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": "v2", "expected_updated_at": expected_updated_at},
        headers=_headers(token),
    )
    assert second.status_code == 200
    assert second.json()["ok"] is True
    expected_updated_at = second.json()["data"]["updated_at"]

    third = await client.post(
        f"/api/v1/docs/files/{file_id}/save-text",
        json={"content": "v3", "expected_updated_at": expected_updated_at},
        headers=_headers(token),
    )
    assert third.status_code == 200
    assert third.json()["ok"] is False
    assert third.json()["error"]["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_docs_minio_upload_scan_and_download_integration(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """Интеграционный happy-path: presigned PUT + scan + presigned GET."""
    token = await _register_owner(client)
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "integration.txt",
            "content_type": "text/plain",
            "size_bytes": 12,
        },
        headers=_headers(token),
    )
    if init_upload.status_code != 200 or not init_upload.json().get("ok"):
        pytest.skip("MinIO/S3 integration unavailable in current environment")

    upload_data = init_upload.json()["data"]
    upload_url = upload_data["upload_url"]
    upload_headers = upload_data["upload_headers"]

    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            put_resp = await http.put(upload_url, content=b"hello-docs!!", headers=upload_headers)
    except Exception:
        pytest.skip("Presigned PUT endpoint is unavailable")

    if put_resp.status_code not in {200, 204}:
        pytest.skip("Presigned PUT rejected request in this environment")

    file_id = upload_data["file_id"]
    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": 12},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    assert finish.json()["data"]["status"] == "scanning"

    version_id = finish.json()["data"]["current_version_id"]
    result = scan_version.run(version_id)
    assert result["status"] == "ready"

    download = await client.get(f"/api/v1/docs/files/{file_id}/download", headers=_headers(token))
    assert download.status_code == 200
    assert download.json()["ok"] is True
    download_url = download.json()["data"]["url"]

    async with httpx.AsyncClient(timeout=5.0) as http:
        get_resp = await http.get(download_url)
    assert get_resp.status_code == 200
    assert get_resp.content == b"hello-docs!!"


@pytest.mark.asyncio
async def test_docs_pdf_sign_creates_new_version_and_ready(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    pdf_bytes = _make_pdf_bytes("Sprint4 PDF")
    file_id, source_version_id = await _create_ready_pdf_file(
        client,
        token,
        monkeypatch,
        pdf_bytes=pdf_bytes,
    )

    storage_map: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        if key in storage_map:
            return storage_map[key]
        raise KeyError(key)

    async with UnitOfWork() as uow:
        file_row = (
            await uow.session.execute(
                select(File).where(File.id == uuid.UUID(file_id)).limit(1),
            )
        ).scalar_one()
        src_version = (
            await uow.session.execute(
                select(FileVersion).where(FileVersion.id == uuid.UUID(source_version_id)).limit(1),
            )
        ).scalar_one()
        storage_map[file_row.s3_key] = pdf_bytes
        storage_map[src_version.s3_key] = pdf_bytes

    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _get_object_bytes)
    monkeypatch.setattr("src.modules.docs.routes.pdf_stamp_sign.delay", lambda *_args, **_kwargs: None)

    signature_png = _make_signature_data_url()

    sign_resp = await client.post(
        f"/api/v1/docs/files/{file_id}/pdf/sign",
        json={
            "page": 1,
            "x": 120,
            "y": 140,
            "width": 180,
            "height": 80,
            "image": signature_png,
            "author": "QA",
        },
        headers=_headers(token),
    )
    assert sign_resp.status_code == 200
    assert sign_resp.json()["ok"] is True
    assert sign_resp.json()["data"]["status"] == "scanning"

    result = pdf_stamp_sign.run(
        source_version_id,
        {
            "page": 1,
            "x": 120,
            "y": 140,
            "width": 180,
            "height": 80,
            "image": signature_png,
            "author": "QA",
        },
        None,
    )
    assert result["status"] == "ready"

    file_out = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_out.status_code == 200
    assert file_out.json()["ok"] is True
    assert file_out.json()["data"]["status"] == "ready"
    first_signed_version_id = file_out.json()["data"]["current_version_id"]
    assert first_signed_version_id != source_version_id

    # Повторно: подпись на 5-й странице с другими координатами.
    sign_resp_2 = await client.post(
        f"/api/v1/docs/files/{file_id}/pdf/sign",
        json={
            "page": 5,
            "x": 80,
            "y": 200,
            "width": 140,
            "height": 60,
            "image": signature_png,
            "author": "QA2",
        },
        headers=_headers(token),
    )
    assert sign_resp_2.status_code == 200
    assert sign_resp_2.json()["ok"] is True
    assert sign_resp_2.json()["data"]["status"] == "scanning"

    result_2 = pdf_stamp_sign.run(
        first_signed_version_id,
        {
            "page": 5,
            "x": 80,
            "y": 200,
            "width": 140,
            "height": 60,
            "image": signature_png,
            "author": "QA2",
        },
        None,
    )
    assert result_2["status"] == "ready"

    file_out_2 = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_out_2.status_code == 200
    assert file_out_2.json()["ok"] is True
    assert file_out_2.json()["data"]["status"] == "ready"
    assert file_out_2.json()["data"]["current_version_id"] != first_signed_version_id

    versions = await client.get(f"/api/v1/docs/files/{file_id}/versions", headers=_headers(token))
    assert versions.status_code == 200
    assert versions.json()["ok"] is True
    assert len(versions.json()["data"]) >= 3
    assert versions.json()["data"][0]["meta_json"] is not None
    assert "signatures" in versions.json()["data"][0]["meta_json"]


@pytest.mark.asyncio
async def test_docs_pdf_sign_forbidden_for_not_ready_status(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )

    pdf_bytes = _make_pdf_bytes("Pending")
    init_upload = await client.post(
        "/api/v1/docs/files/init-upload",
        json={
            "filename": "pending-sign.pdf",
            "content_type": "application/pdf",
            "size_bytes": len(pdf_bytes),
        },
        headers=_headers(token),
    )
    assert init_upload.status_code == 200
    assert init_upload.json()["ok"] is True
    file_id = str(init_upload.json()["data"]["file_id"])

    finish = await client.post(
        "/api/v1/docs/files/finish-upload",
        json={"file_id": file_id, "size_bytes": len(pdf_bytes)},
        headers=_headers(token),
    )
    assert finish.status_code == 200
    assert finish.json()["ok"] is True
    assert finish.json()["data"]["status"] == "scanning"

    signature_png = _make_signature_data_url()
    sign_resp = await client.post(
        f"/api/v1/docs/files/{file_id}/pdf/sign",
        json={
            "page": 1,
            "x": 100,
            "y": 100,
            "width": 120,
            "height": 60,
            "image": signature_png,
        },
        headers=_headers(token),
    )
    assert sign_resp.status_code == 200
    assert sign_resp.json()["ok"] is False
    assert sign_resp.json()["error"]["code"] == "FILE_NOT_READY"


@pytest.mark.asyncio
async def test_docs_open_docx_returns_editor_config(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    docx_bytes = _make_docx_bytes("Open DOCX")
    file_id, _ = await _create_ready_docx_file(client, token, monkeypatch, docx_bytes=docx_bytes)

    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_ENABLED", True)
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL", "http://onlyoffice:80")
    monkeypatch.setattr(
        settings,
        "DOCS_ONLYOFFICE_CALLBACK_URL",
        "http://api:8000/api/v1/docs/integrations/onlyoffice/callback",
    )
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_JWT_SECRET", "")

    response = await client.post(
        f"/api/v1/docs/files/{file_id}/open-docx",
        headers=_headers(token),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    data = response.json()["data"]
    assert data["document_server_url"] == "http://onlyoffice:80"
    assert data["config"]["document"]["fileType"] == "docx"
    assert data["config"]["editorConfig"]["callbackUrl"]
    assert "state=" in data["config"]["editorConfig"]["callbackUrl"]


@pytest.mark.asyncio
async def test_docs_onlyoffice_callback_creates_new_version(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    original_docx = _make_docx_bytes("Original DOCX")
    updated_docx = _make_docx_bytes("Updated DOCX")
    file_id, source_version_id = await _create_ready_docx_file(client, token, monkeypatch, docx_bytes=original_docx)

    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_ENABLED", True)
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL", "http://onlyoffice:80")
    monkeypatch.setattr(
        settings,
        "DOCS_ONLYOFFICE_CALLBACK_URL",
        "http://api:8000/api/v1/docs/integrations/onlyoffice/callback",
    )
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_JWT_SECRET", "")

    storage_map: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        if key in storage_map:
            return storage_map[key]
        raise KeyError(key)

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _get_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())
    monkeypatch.setattr("src.modules.docs.routes.scan_version.delay", lambda *_args, **_kwargs: None)

    async def _download_onlyoffice_file(*_args, **_kwargs):
        return updated_docx

    monkeypatch.setattr(
        "src.modules.docs.service.DocsService._download_onlyoffice_file",
        _download_onlyoffice_file,
    )

    open_docx = await client.post(f"/api/v1/docs/files/{file_id}/open-docx", headers=_headers(token))
    assert open_docx.status_code == 200
    assert open_docx.json()["ok"] is True
    callback_url = open_docx.json()["data"]["config"]["editorConfig"]["callbackUrl"]
    state_token = parse_qs(urlparse(callback_url).query).get("state", [""])[0]
    assert state_token

    callback = await client.post(
        f"/api/v1/docs/integrations/onlyoffice/callback?state={state_token}",
        json={
            "status": 2,
            "url": "http://onlyoffice.local/updated.docx",
            "users": ["user1"],
            "actions": [{"type": 0, "userid": "user1"}],
        },
    )
    assert callback.status_code == 200
    assert callback.json()["error"] == 0

    file_after = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_after.status_code == 200
    assert file_after.json()["ok"] is True
    assert file_after.json()["data"]["status"] == "scanning"
    new_version_id = file_after.json()["data"]["current_version_id"]
    assert new_version_id != source_version_id

    scan_result = scan_version.run(new_version_id)
    assert scan_result["status"] == "ready"

    versions = await client.get(f"/api/v1/docs/files/{file_id}/versions", headers=_headers(token))
    assert versions.status_code == 200
    assert versions.json()["ok"] is True
    assert len(versions.json()["data"]) >= 2
    assert versions.json()["data"][0]["meta_json"] is not None
    assert "onlyoffice" in versions.json()["data"][0]["meta_json"]


@pytest.mark.asyncio
async def test_docs_onlyoffice_callback_stale_session_rejected(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    original_docx = _make_docx_bytes("Original DOCX")
    updated_docx = _make_docx_bytes("Updated DOCX")
    file_id, _source_version_id = await _create_ready_docx_file(client, token, monkeypatch, docx_bytes=original_docx)

    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_ENABLED", True)
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL", "http://onlyoffice:80")
    monkeypatch.setattr(
        settings,
        "DOCS_ONLYOFFICE_CALLBACK_URL",
        "http://api:8000/api/v1/docs/integrations/onlyoffice/callback",
    )
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_JWT_SECRET", "")

    monkeypatch.setattr("src.modules.docs.routes.scan_version.delay", lambda *_args, **_kwargs: None)

    async def _download_onlyoffice_file(*_args, **_kwargs):
        return updated_docx

    monkeypatch.setattr(
        "src.modules.docs.service.DocsService._download_onlyoffice_file",
        _download_onlyoffice_file,
    )

    open_docx = await client.post(f"/api/v1/docs/files/{file_id}/open-docx", headers=_headers(token))
    assert open_docx.status_code == 200
    callback_url = open_docx.json()["data"]["config"]["editorConfig"]["callbackUrl"]
    state_token = parse_qs(urlparse(callback_url).query).get("state", [""])[0]
    assert state_token

    first_callback = await client.post(
        f"/api/v1/docs/integrations/onlyoffice/callback?state={state_token}",
        json={"status": 2, "url": "http://onlyoffice.local/updated.docx"},
    )
    assert first_callback.status_code == 200

    stale_callback = await client.post(
        f"/api/v1/docs/integrations/onlyoffice/callback?state={state_token}",
        json={"status": 2, "url": "http://onlyoffice.local/updated.docx"},
    )
    assert stale_callback.status_code == 409
    assert stale_callback.json()["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_docs_onlyoffice_callback_without_signature_rejected(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)
    docx_bytes = _make_docx_bytes("Secure DOCX")
    file_id, _ = await _create_ready_docx_file(client, token, monkeypatch, docx_bytes=docx_bytes)

    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_ENABLED", True)
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL", "http://onlyoffice:80")
    monkeypatch.setattr(
        settings,
        "DOCS_ONLYOFFICE_CALLBACK_URL",
        "http://api:8000/api/v1/docs/integrations/onlyoffice/callback",
    )
    monkeypatch.setattr(settings, "DOCS_ONLYOFFICE_JWT_SECRET", "onlyoffice-secret")

    open_docx = await client.post(f"/api/v1/docs/files/{file_id}/open-docx", headers=_headers(token))
    assert open_docx.status_code == 200
    assert open_docx.json()["ok"] is True
    callback_url = open_docx.json()["data"]["config"]["editorConfig"]["callbackUrl"]
    state_token = parse_qs(urlparse(callback_url).query).get("state", [""])[0]
    assert state_token

    callback = await client.post(
        f"/api/v1/docs/integrations/onlyoffice/callback?state={state_token}",
        json={
            "status": 2,
            "url": "http://onlyoffice.local/updated.docx",
        },
    )
    assert callback.status_code == 401


@pytest.mark.asyncio
async def test_docs_ai_generate_txt_pipeline_ready(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _patch_ai_generation_stubs(monkeypatch, text="AI сгенерировал текстовый документ")

    async def _allow_limits(*_args, **_kwargs):
        return True, None

    async def _fake_spend_tokens(*_args, **_kwargs):
        return None

    monkeypatch.setattr("src.modules.docs.service.check_ai_limits", _allow_limits)
    monkeypatch.setattr("src.modules.docs.tasks.check_ai_limits", _allow_limits)
    monkeypatch.setattr("src.modules.docs.tasks.spend_tokens", _fake_spend_tokens)
    monkeypatch.setattr("src.modules.docs.routes.ai_generate.delay", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("src.modules.docs.routes.scan_version.delay", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())

    storage_map: dict[str, bytes] = {}

    def _put_object_bytes(*, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        _ = bucket, content_type
        storage_map[key] = payload

    def _get_object_bytes(*, bucket: str, key: str) -> bytes:
        _ = bucket
        return storage_map[key]

    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.put_object_bytes", _put_object_bytes)
    monkeypatch.setattr("src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes", _get_object_bytes)

    create_resp = await client.post(
        "/api/v1/docs/files/ai/generate",
        json={
            "type": "txt",
            "prompt": "Сделай краткий регламент по использованию CRM для сотрудников.",
            "title": "AI регламент",
        },
        headers=_headers(token),
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["ok"] is True
    job_id = str(create_resp.json()["data"]["job_id"])
    file_id = str(create_resp.json()["data"]["file_id"])

    task_result = await run_ai_generate_inline(job_id=job_id, task_id="test-inline")
    assert task_result["status"] == "scanning", task_result

    file_scanning = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_scanning.status_code == 200
    assert file_scanning.json()["ok"] is True
    assert file_scanning.json()["data"]["status"] == "scanning"
    version_id = file_scanning.json()["data"]["current_version_id"]
    assert version_id

    scan_result = scan_version.run(str(version_id))
    assert scan_result["status"] == "ready"

    file_ready = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_ready.status_code == 200
    assert file_ready.json()["ok"] is True
    assert file_ready.json()["data"]["status"] == "ready"
    assert file_ready.json()["data"]["size"] > 20

    job_ready = await client.get(f"/api/v1/docs/files/ai/jobs/{job_id}", headers=_headers(token))
    assert job_ready.status_code == 200
    assert job_ready.json()["ok"] is True
    assert job_ready.json()["data"]["status"] == "ready"
    assert int(job_ready.json()["data"]["total_tokens"]) > 0

    jobs_list = await client.get("/api/v1/docs/files/ai/jobs?limit=10", headers=_headers(token))
    assert jobs_list.status_code == 200
    assert jobs_list.json()["ok"] is True
    assert any(str(item["id"]) == job_id for item in jobs_list.json()["data"])


@pytest.mark.asyncio
async def test_docs_ai_generate_rejected_by_ai_limit(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _patch_ai_generation_stubs(monkeypatch, text="stub")

    async def _deny_limits(*_args, **_kwargs):
        return False, {"code": "AI_USER_RATE_LIMIT", "message": "Превышен лимит запросов сотрудника к AI"}

    monkeypatch.setattr("src.modules.docs.service.check_ai_limits", _deny_limits)

    response = await client.post(
        "/api/v1/docs/files/ai/generate",
        json={"type": "docx", "prompt": "Сгенерируй курс по продажам"},
        headers=_headers(token),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is False
    assert response.json()["error"]["code"] == "AI_USER_RATE_LIMIT"


@pytest.mark.asyncio
async def test_docs_ai_generate_docx_allows_regular_prompt_with_free_request_limit(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)

    async def _fake_runtime(*_args, **_kwargs):
        from src.modules.docs.ai_generator import AIGenerationRuntime

        return AIGenerationRuntime(
            base_url="https://example.local",
            bearer_token="test-token",
            provider_mode="openai_compatible",
            model="gpt-test",
            temperature=0.2,
            max_tokens=2000,
        )

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime", _fake_runtime)
    monkeypatch.setattr("src.modules.docs.routes.ai_generate.delay", lambda *_args, **_kwargs: None)

    response = await client.post(
        "/api/v1/docs/files/ai/generate",
        json={
            "type": "docx",
            "prompt": (
                "Подготовь понятное коммерческое предложение для внедрения CRM в отдел продаж. "
                "Нужно кратко описать этапы запуска, сроки, ожидаемый результат и оставить "
                "место под реквизиты и стоимость."
            ),
            "title": "Коммерческое предложение",
        },
        headers=_headers(token),
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["data"]["estimated_request_tokens"] <= 2000


@pytest.mark.asyncio
async def test_docs_ai_generate_deduplicates_same_recent_request(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
):
    token = await _register_owner(client)

    async def _fake_runtime(*_args, **_kwargs):
        from src.modules.docs.ai_generator import AIGenerationRuntime

        return AIGenerationRuntime(
            base_url="https://example.local",
            bearer_token="test-token",
            provider_mode="openai_compatible",
            model="gpt-test",
            temperature=0.2,
            max_tokens=3000,
        )

    async def _allow_limits(*_args, **_kwargs):
        return True, None

    monkeypatch.setattr("src.modules.docs.service.DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime", _fake_runtime)
    monkeypatch.setattr("src.modules.docs.service.check_ai_limits", _allow_limits)
    monkeypatch.setattr("src.modules.docs.routes.ai_generate.delay", lambda *_args, **_kwargs: None)

    payload = {
        "type": "docx",
        "prompt": "Подготовь базовый договор на услуги с типовыми разделами и местом под реквизиты.",
        "title": "Договор на услуги",
        "template": "Договор",
    }

    first = await client.post("/api/v1/docs/files/ai/generate", json=payload, headers=_headers(token))
    assert first.status_code == 200
    assert first.json()["ok"] is True

    second = await client.post("/api/v1/docs/files/ai/generate", json=payload, headers=_headers(token))
    assert second.status_code == 200
    assert second.json()["ok"] is True

    first_data = first.json()["data"]
    second_data = second.json()["data"]
    assert second_data["job_id"] == first_data["job_id"]
    assert second_data["file_id"] == first_data["file_id"]

    jobs_list = await client.get("/api/v1/docs/files/ai/jobs?limit=10", headers=_headers(token))
    assert jobs_list.status_code == 200
    assert jobs_list.json()["ok"] is True
    matching_jobs = [item for item in jobs_list.json()["data"] if item["title"] == "Договор на услуги"]
    assert len(matching_jobs) == 1


@pytest.mark.asyncio
async def test_docs_ai_job_can_be_stopped_and_deleted(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _patch_ai_generation_stubs(monkeypatch, text="stub")

    async def _allow_limits(*_args, **_kwargs):
        return True, None

    monkeypatch.setattr("src.modules.docs.service.check_ai_limits", _allow_limits)
    monkeypatch.setattr("src.modules.docs.routes.ai_generate.delay", lambda *_args, **_kwargs: None)

    create_resp = await client.post(
        "/api/v1/docs/files/ai/generate",
        json={"type": "docx", "prompt": "Подготовь тестовый документ", "title": "Остановить меня"},
        headers=_headers(token),
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["ok"] is True
    job_id = str(create_resp.json()["data"]["job_id"])
    file_id = str(create_resp.json()["data"]["file_id"])

    stop_resp = await client.post(f"/api/v1/docs/files/ai/jobs/{job_id}/stop", headers=_headers(token))
    assert stop_resp.status_code == 200
    assert stop_resp.json()["ok"] is True
    assert stop_resp.json()["data"]["status"] == "failed"
    assert stop_resp.json()["data"]["error_message"] == "Остановлено пользователем"

    file_resp = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_resp.status_code == 200
    assert file_resp.json()["ok"] is True
    assert file_resp.json()["data"]["status"] == "blocked"

    delete_resp = await client.delete(f"/api/v1/docs/files/ai/jobs/{job_id}", headers=_headers(token))
    assert delete_resp.status_code == 200
    assert delete_resp.json()["ok"] is True

    get_deleted = await client.get(f"/api/v1/docs/files/ai/jobs/{job_id}", headers=_headers(token))
    assert get_deleted.status_code == 200
    assert get_deleted.json()["ok"] is False
    assert get_deleted.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_docs_ai_job_cannot_be_deleted_while_active(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _patch_ai_generation_stubs(monkeypatch, text="stub")

    async def _allow_limits(*_args, **_kwargs):
        return True, None

    monkeypatch.setattr("src.modules.docs.service.check_ai_limits", _allow_limits)
    monkeypatch.setattr("src.modules.docs.routes.ai_generate.delay", lambda *_args, **_kwargs: None)

    create_resp = await client.post(
        "/api/v1/docs/files/ai/generate",
        json={"type": "docx", "prompt": "Подготовь тестовый документ", "title": "Активная задача"},
        headers=_headers(token),
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["ok"] is True
    job_id = str(create_resp.json()["data"]["job_id"])

    delete_resp = await client.delete(f"/api/v1/docs/files/ai/jobs/{job_id}", headers=_headers(token))
    assert delete_resp.status_code == 200
    assert delete_resp.json()["ok"] is False
    assert delete_resp.json()["error"]["code"] == "JOB_STILL_ACTIVE"


@pytest.mark.asyncio
async def test_docs_upload_smoke_20_init_finish(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    _disable_scan_queue(monkeypatch)
    monkeypatch.setattr(
        "src.modules.docs.service.DEFAULT_STORAGE_PROVIDER.generate_presigned_put_url",
        lambda **kwargs: ("https://example.local/put", {"Content-Type": kwargs["content_type"]}),
    )
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())
    monkeypatch.setattr(
        "src.modules.docs.tasks.DEFAULT_STORAGE_PROVIDER.get_object_bytes",
        lambda **_kwargs: b"smoke text payload",
    )

    for idx in range(20):
        init = await client.post(
            "/api/v1/docs/files/init-upload",
            json={
                "filename": f"smoke-{idx}.txt",
                "content_type": "text/plain",
                "size_bytes": 17,
            },
            headers=_headers(token),
        )
        assert init.status_code == 200
        assert init.json()["ok"] is True
        file_id = str(init.json()["data"]["file_id"])

        finish = await client.post(
            "/api/v1/docs/files/finish-upload",
            json={"file_id": file_id, "size_bytes": 17},
            headers=_headers(token),
        )
        assert finish.status_code == 200
        assert finish.json()["ok"] is True
        version_id = str(finish.json()["data"]["current_version_id"])

        scan_result = scan_version.run(version_id)
        assert scan_result["status"] == "ready"


@pytest.mark.asyncio
async def test_docs_retention_cleanup_deletes_old_versions(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    token = await _register_owner(client)
    file_id = await _create_ready_txt_file(client, token, monkeypatch, size_bytes=9)
    file_before = await client.get(f"/api/v1/docs/files/{file_id}", headers=_headers(token))
    assert file_before.status_code == 200
    expected_updated_at = file_before.json()["data"]["updated_at"]

    for idx in range(3):
        save = await client.post(
            f"/api/v1/docs/files/{file_id}/save-text",
            json={"content": f"version {idx}", "expected_updated_at": expected_updated_at},
            headers=_headers(token),
        )
        assert save.status_code == 200
        assert save.json()["ok"] is True
        expected_updated_at = save.json()["data"]["updated_at"]

    async with UnitOfWork() as uow:
        versions_before = (
            (
                await uow.session.execute(
                    select(FileVersion)
                    .where(FileVersion.file_id == uuid.UUID(file_id))
                    .order_by(FileVersion.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        current_version_id = str(
            (
                await uow.session.execute(
                    select(File).where(File.id == uuid.UUID(file_id)).limit(1),
                )
            )
            .scalar_one()
            .current_version_id
        )
        for row in versions_before:
            if str(row.id) == current_version_id:
                continue
            row.created_at = row.created_at - timedelta(days=370)
        await uow.commit()

    class _FakeS3Client:
        def delete_object(self, **_kwargs):
            return None

    monkeypatch.setattr(settings, "DOCS_RETENTION_DAYS", 1)
    monkeypatch.setattr(settings, "DOCS_RETENTION_KEEP_LATEST", 1)
    monkeypatch.setattr(settings, "DOCS_RETENTION_BATCH_SIZE", 50)
    monkeypatch.setattr("src.modules.docs.tasks.sync_session_factory", _build_test_sync_session_factory())
    monkeypatch.setattr("src.modules.files.storage.get_s3_client", lambda: _FakeS3Client())

    cleanup_result = cleanup_old_doc_versions.run()
    assert cleanup_result["status"] == "ok"
    assert int(cleanup_result["deleted"]) >= 1

    versions_after = await client.get(f"/api/v1/docs/files/{file_id}/versions", headers=_headers(token))
    assert versions_after.status_code == 200
    assert versions_after.json()["ok"] is True
    assert len(versions_after.json()["data"]) < len(versions_before)
