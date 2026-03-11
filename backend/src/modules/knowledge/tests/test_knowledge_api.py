import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import Plan


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _set_free_plan_records_limit(limit: int) -> None:
    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one_or_none()
        if free_plan is None:
            free_plan = Plan(
                name="free",
                display_name="Бесплатный",
                price_monthly=0,
                price_yearly=0,
                max_members=10,
                max_tables=10,
                max_records=limit,
                max_storage_mb=500,
                has_ai=True,
                ai_max_tokens_per_request=2000,
                ai_tokens_per_day=20000,
                ai_rpm_per_user=30,
                is_active=True,
            )
            uow.session.add(free_plan)
        else:
            free_plan.max_records = limit
        await uow.commit()


@pytest.mark.asyncio
async def test_knowledge_pages_crud_flow(client: AsyncClient):
    email = f"kb-owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Owner",
            "org_name": "Knowledge Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    create = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Первая страница", "content": "Контент"},
        headers=_headers(token),
    )
    assert create.status_code == 200
    assert create.json()["ok"] is True
    page_id = create.json()["data"]["id"]
    assert create.json()["data"]["slug"] == "первая-страница"

    listed = await client.get("/api/v1/knowledge/pages", headers=_headers(token))
    assert listed.status_code == 200
    assert listed.json()["ok"] is True
    assert any(x["id"] == page_id for x in listed.json()["data"])

    loaded = await client.get(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert loaded.status_code == 200
    assert loaded.json()["ok"] is True
    assert loaded.json()["data"]["title"] == "Первая страница"

    updated = await client.patch(
        f"/api/v1/knowledge/pages/{page_id}",
        json={
            "title": "Обновленная страница",
            "is_published": False,
            "expected_updated_at": loaded.json()["data"]["updated_at"],
        },
        headers=_headers(token),
    )
    assert updated.status_code == 200
    assert updated.json()["ok"] is True
    assert updated.json()["data"]["title"] == "Обновленная страница"
    assert updated.json()["data"]["slug"] == "обновленная-страница"
    assert updated.json()["data"]["is_published"] is False

    deleted = await client.delete(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = await client.get(f"/api/v1/knowledge/pages/{page_id}", headers=_headers(token))
    assert missing.status_code == 200
    assert missing.json()["ok"] is False
    assert missing.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_knowledge_pages_enforce_plan_limit(client: AsyncClient):
    email = f"kb-limit-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Limit",
            "org_name": "Knowledge Limit Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    await _set_free_plan_records_limit(1)
    try:
        first = await client.post(
            "/api/v1/knowledge/pages",
            json={"title": "Первая", "content": "ok"},
            headers=_headers(token),
        )
        assert first.status_code == 200
        assert first.json()["ok"] is True

        second = await client.post(
            "/api/v1/knowledge/pages",
            json={"title": "Вторая", "content": "overflow"},
            headers=_headers(token),
        )
        assert second.status_code == 422
        body = second.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "KNOWLEDGE_LIMIT_REACHED"
    finally:
        await _set_free_plan_records_limit(10000)


@pytest.mark.asyncio
async def test_delete_root_page_removes_full_subtree(client: AsyncClient):
    email = f"kb-tree-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Tree",
            "org_name": "Knowledge Tree Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    root = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Root", "content": "root"},
        headers=_headers(token),
    )
    assert root.status_code == 200
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Child", "content": "child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200
    child_id = child.json()["data"]["id"]

    grandchild = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Grandchild", "content": "grandchild", "parent_id": child_id},
        headers=_headers(token),
    )
    assert grandchild.status_code == 200
    grandchild_id = grandchild.json()["data"]["id"]

    deleted = await client.delete(f"/api/v1/knowledge/pages/{root_id}", headers=_headers(token))
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    listed = await client.get("/api/v1/knowledge/pages", headers=_headers(token))
    assert listed.status_code == 200
    assert listed.json()["ok"] is True
    ids = {p["id"] for p in listed.json()["data"]}
    assert root_id not in ids
    assert child_id not in ids
    assert grandchild_id not in ids


@pytest.mark.asyncio
async def test_move_page_to_another_parent_and_prevent_cycles(client: AsyncClient):
    email = f"kb-move-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Move",
            "org_name": "Knowledge Move Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    root_a = await client.post("/api/v1/knowledge/pages", json={"title": "A"}, headers=_headers(token))
    root_b = await client.post("/api/v1/knowledge/pages", json={"title": "B"}, headers=_headers(token))
    assert root_a.status_code == 200
    assert root_b.status_code == 200
    root_a_id = root_a.json()["data"]["id"]
    root_b_id = root_b.json()["data"]["id"]

    child = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Child", "parent_id": root_a_id},
        headers=_headers(token),
    )
    assert child.status_code == 200
    child_id = child.json()["data"]["id"]

    moved = await client.patch(
        f"/api/v1/knowledge/pages/{child_id}",
        json={"parent_id": root_b_id, "expected_updated_at": child.json()["data"]["updated_at"]},
        headers=_headers(token),
    )
    assert moved.status_code == 200
    assert moved.json()["ok"] is True
    assert moved.json()["data"]["parent_id"] == root_b_id

    invalid = await client.patch(
        f"/api/v1/knowledge/pages/{root_b_id}",
        json={"parent_id": child_id, "expected_updated_at": root_b.json()["data"]["updated_at"]},
        headers=_headers(token),
    )
    assert invalid.status_code == 400
    body = invalid.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "INVALID_PARENT"


@pytest.mark.asyncio
async def test_knowledge_page_conflict_returns_409(client: AsyncClient):
    email = f"kb-conflict-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "KB",
            "last_name": "Conflict",
            "org_name": "Knowledge Conflict Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    created = await client.post(
        "/api/v1/knowledge/pages",
        json={"title": "Страница", "content": "v1"},
        headers=_headers(token),
    )
    assert created.status_code == 200
    page_id = created.json()["data"]["id"]
    stale_updated_at = created.json()["data"]["updated_at"]

    first = await client.patch(
        f"/api/v1/knowledge/pages/{page_id}",
        json={"title": "v2", "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert first.status_code == 200

    conflict = await client.patch(
        f"/api/v1/knowledge/pages/{page_id}",
        json={"title": "v3", "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "CONFLICT"
