import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import Plan


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"tables-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Test",
            "last_name": "User",
            "org_name": f"Org-{uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_create_table_and_list(client: AsyncClient):
    token = await _register_owner(client)

    resp = await client.post(
        "/api/v1/tables/",
        json={"name": "Test table", "description": "Description"},
        headers=_headers(token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    table_id = data["data"]["id"]

    resp2 = await client.get("/api/v1/tables/", headers=_headers(token))
    assert resp2.status_code == 200
    tables = resp2.json()["data"]
    assert any(t["id"] == table_id for t in tables)


@pytest.mark.asyncio
async def test_create_column_and_record(client: AsyncClient):
    token = await _register_owner(client)

    resp = await client.post("/api/v1/tables/", json={"name": f"Table-{uuid.uuid4().hex[:6]}"}, headers=_headers(token))
    assert resp.status_code == 200
    table_id = resp.json()["data"]["id"]

    col_resp = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Client name", "field_type": "text"},
        headers=_headers(token),
    )
    assert col_resp.status_code == 200
    col_id = col_resp.json()["data"]["id"]

    rec_resp = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {col_id: "Ivan Petrov"}},
        headers=_headers(token),
    )
    assert rec_resp.status_code == 200
    assert rec_resp.json()["ok"] is True
    rec_id = rec_resp.json()["data"]["id"]

    list_resp = await client.get(f"/api/v1/tables/{table_id}/records/?limit=50&offset=0", headers=_headers(token))
    assert list_resp.status_code == 200
    records = list_resp.json()["data"]["records"]
    assert len(records) >= 1

    get_resp = await client.get(f"/api/v1/tables/{table_id}/records/{rec_id}", headers=_headers(token))
    assert get_resp.status_code == 200

    upd = await client.patch(
        f"/api/v1/tables/{table_id}/records/{rec_id}",
        json={"data": {col_id: "Ivan Updated"}, "expected_updated_at": get_resp.json()["data"]["updated_at"]},
        headers=_headers(token),
    )
    assert upd.status_code == 200

    dele = await client.delete(f"/api/v1/tables/{table_id}/records/{rec_id}", headers=_headers(token))
    assert dele.status_code == 200


@pytest.mark.asyncio
async def test_update_record_conflict_returns_409(client: AsyncClient):
    token = await _register_owner(client)

    resp = await client.post("/api/v1/tables/", json={"name": f"Table-{uuid.uuid4().hex[:6]}"}, headers=_headers(token))
    assert resp.status_code == 200
    table_id = resp.json()["data"]["id"]

    col_resp = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Client name", "field_type": "text"},
        headers=_headers(token),
    )
    assert col_resp.status_code == 200
    col_id = col_resp.json()["data"]["id"]

    rec_resp = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {col_id: "Ivan Petrov"}},
        headers=_headers(token),
    )
    assert rec_resp.status_code == 200
    rec_id = rec_resp.json()["data"]["id"]
    stale_updated_at = rec_resp.json()["data"]["updated_at"]

    first_update = await client.patch(
        f"/api/v1/tables/{table_id}/records/{rec_id}",
        json={"data": {col_id: "First"}, "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert first_update.status_code == 200

    conflict = await client.patch(
        f"/api/v1/tables/{table_id}/records/{rec_id}",
        json={"data": {col_id: "Second"}, "expected_updated_at": stale_updated_at},
        headers=_headers(token),
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "CONFLICT"


@pytest.mark.asyncio
async def test_export_csv_and_xlsx(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Export table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    c = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    assert c.status_code == 200
    col_id = c.json()["data"]["id"]

    r = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {col_id: 123}},
        headers=_headers(token),
    )
    assert r.status_code == 200

    csv_resp = await client.get(f"/api/v1/tables/{table_id}/export/csv", headers=_headers(token))
    assert csv_resp.status_code == 200
    assert "text/csv" in (csv_resp.headers.get("content-type") or "")
    assert (csv_resp.headers.get("content-disposition") or "").startswith("attachment;")
    assert len(csv_resp.content) > 0

    xlsx_resp = await client.get(f"/api/v1/tables/{table_id}/export/xlsx", headers=_headers(token))
    assert xlsx_resp.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in (
        xlsx_resp.headers.get("content-type") or ""
    )
    assert (xlsx_resp.headers.get("content-disposition") or "").startswith("attachment;")
    assert len(xlsx_resp.content) > 100


@pytest.mark.asyncio
async def test_folders_views_filter_and_move(client: AsyncClient):
    token = await _register_owner(client)

    # Folder CRUD
    f = await client.post("/api/v1/tables/folders/", json={"name": "Sales"}, headers=_headers(token))
    assert f.status_code == 200
    folder_id = f.json()["data"]["id"]

    fu = await client.patch(f"/api/v1/tables/folders/{folder_id}", json={"name": "Sales updated"}, headers=_headers(token))
    assert fu.status_code == 200

    flist = await client.get("/api/v1/tables/folders/", headers=_headers(token))
    assert flist.status_code == 200
    assert any(x["id"] == folder_id for x in flist.json()["data"])

    # Table in folder
    t = await client.post("/api/v1/tables/", json={"name": "Leads", "folder_id": folder_id}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    tg = await client.get(f"/api/v1/tables/{table_id}", headers=_headers(token))
    assert tg.status_code == 200

    tu = await client.patch(f"/api/v1/tables/{table_id}", json={"description": "Updated"}, headers=_headers(token))
    assert tu.status_code == 200

    # Create a view
    v = await client.post(
        f"/api/v1/tables/{table_id}/views/",
        json={"name": "My view", "view_type": "grid", "filters": None, "sorts": None},
        headers=_headers(token),
    )
    assert v.status_code == 200
    view_id = v.json()["data"]["id"]

    vlist = await client.get(f"/api/v1/tables/{table_id}/views/", headers=_headers(token))
    assert vlist.status_code == 200
    assert any(x["id"] == view_id for x in vlist.json()["data"])

    # Add a column + two records then move them.
    c = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "text"},
        headers=_headers(token),
    )
    assert c.status_code == 200
    col_id = c.json()["data"]["id"]

    cu = await client.patch(
        f"/api/v1/tables/{table_id}/columns/{col_id}",
        json={"name": "Stage"},
        headers=_headers(token),
    )
    assert cu.status_code == 200

    r1 = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {col_id: "New"}}, headers=_headers(token))
    r2 = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {col_id: "Won"}}, headers=_headers(token))
    assert r1.status_code == 200 and r2.status_code == 200
    rec2_id = r2.json()["data"]["id"]

    mv = await client.post(
        f"/api/v1/tables/{table_id}/records/{rec2_id}/move",
        json={"direction": "up"},
        headers=_headers(token),
    )
    assert mv.status_code == 200

    # Filter endpoint (in-memory)
    flt = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={"filters": {col_id: {"op": "contains", "value": "w"}}},
        headers=_headers(token),
    )
    assert flt.status_code == 200
    got = flt.json()["data"]["records"]
    assert any(x["id"] == rec2_id for x in got)

    # Delete view
    vd = await client.delete(f"/api/v1/tables/{table_id}/views/{view_id}", headers=_headers(token))
    assert vd.status_code == 200

    # CSV import (basic)
    imp_table = await client.post("/api/v1/tables/", json={"name": "Import table"}, headers=_headers(token))
    assert imp_table.status_code == 200
    imp_table_id = imp_table.json()["data"]["id"]
    imp_col = await client.post(
        f"/api/v1/tables/{imp_table_id}/columns",
        json={"name": "Name", "field_type": "text"},
        headers=_headers(token),
    )
    assert imp_col.status_code == 200
    csv_content = "Name\nAlice\nBob\n"
    imp = await client.post(
        f"/api/v1/tables/{imp_table_id}/import/csv",
        files={"file": ("data.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=_headers(token),
    )
    assert imp.status_code == 200
    assert imp.json()["data"]["records_created"] >= 2

    # Cleanup some endpoints (delete folder/table/column).
    cd = await client.delete(f"/api/v1/tables/{table_id}/columns/{col_id}", headers=_headers(token))
    assert cd.status_code == 200

    td = await client.delete(f"/api/v1/tables/{table_id}", headers=_headers(token))
    assert td.status_code == 200

    fd = await client.delete(f"/api/v1/tables/folders/{folder_id}", headers=_headers(token))
    assert fd.status_code == 200


@pytest.mark.asyncio
async def test_folder_depth_limit(client: AsyncClient):
    token = await _register_owner(client)

    root = await client.post("/api/v1/tables/folders/", json={"name": "L0"}, headers=_headers(token))
    assert root.status_code == 200
    assert root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    level1 = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "L1", "parent_id": root_id},
        headers=_headers(token),
    )
    assert level1.status_code == 200
    assert level1.json()["ok"] is True
    level1_id = level1.json()["data"]["id"]

    level2 = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "L2", "parent_id": level1_id},
        headers=_headers(token),
    )
    assert level2.status_code == 200
    assert level2.json()["ok"] is True
    level2_id = level2.json()["data"]["id"]

    too_deep = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "L3", "parent_id": level2_id},
        headers=_headers(token),
    )
    assert too_deep.status_code == 200
    assert too_deep.json()["ok"] is False
    assert too_deep.json()["error"]["code"] == "MAX_DEPTH_EXCEEDED"


@pytest.mark.asyncio
async def test_reports_summary(client: AsyncClient):
    token = await _register_owner(client)
    resp = await client.get("/api/v1/reports/summary", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "tables_count" in data["data"]
    assert "records_count" in data["data"]
    assert "columns_count" in data["data"]


@pytest.mark.asyncio
async def test_table_and_record_limits_from_plan(client: AsyncClient):
    token = await _register_owner(client)

    # Tighten free limits in test DB.
    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one_or_none()
        if free_plan is None:
            from src.modules.billing.seed import upsert_default_plans

            await upsert_default_plans(uow.session)
            free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one()
        free_plan.max_tables = 1
        free_plan.max_records = 2
        await uow.commit()

    t1 = await client.post("/api/v1/tables/", json={"name": "T1"}, headers=_headers(token))
    assert t1.status_code == 200
    assert t1.json()["ok"] is True
    table_id = t1.json()["data"]["id"]

    # second table should be blocked by tariff limit.
    t2 = await client.post("/api/v1/tables/", json={"name": "T2"}, headers=_headers(token))
    assert t2.status_code == 200
    assert t2.json()["ok"] is False
    assert t2.json()["error"]["code"] == "TABLE_LIMIT_REACHED"

    r1 = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {"a": "1"}}, headers=_headers(token))
    r2 = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {"a": "2"}}, headers=_headers(token))
    assert r1.status_code == 200 and r1.json()["ok"] is True
    assert r2.status_code == 200 and r2.json()["ok"] is True

    r3 = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {"a": "3"}}, headers=_headers(token))
    assert r3.status_code == 200
    assert r3.json()["ok"] is False
    assert r3.json()["error"]["code"] == "RECORD_LIMIT_REACHED"


@pytest.mark.asyncio
async def test_table_and_folder_name_validation(client: AsyncClient):
    token = await _register_owner(client)

    too_long = "a" * 121
    bad_table = await client.post("/api/v1/tables/", json={"name": too_long}, headers=_headers(token))
    assert bad_table.status_code == 422

    bad_folder = await client.post("/api/v1/tables/folders/", json={"name": too_long}, headers=_headers(token))
    assert bad_folder.status_code == 422

    blank_table = await client.post("/api/v1/tables/", json={"name": "   "}, headers=_headers(token))
    assert blank_table.status_code == 422

    blank_folder = await client.post("/api/v1/tables/folders/", json={"name": "   "}, headers=_headers(token))
    assert blank_folder.status_code == 422


@pytest.mark.asyncio
async def test_rename_table_and_move_folder_tree(client: AsyncClient):
    token = await _register_owner(client)

    root = await client.post("/api/v1/tables/folders/", json={"name": "Root"}, headers=_headers(token))
    assert root.status_code == 200 and root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "Child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200 and child.json()["ok"] is True
    child_id = child.json()["data"]["id"]

    table = await client.post(
        "/api/v1/tables/",
        json={"name": "Initial table", "folder_id": child_id},
        headers=_headers(token),
    )
    assert table.status_code == 200 and table.json()["ok"] is True
    table_id = table.json()["data"]["id"]

    # Table rename should work and preserve folder binding.
    renamed = await client.patch(
        f"/api/v1/tables/{table_id}",
        json={"name": "Renamed table"},
        headers=_headers(token),
    )
    assert renamed.status_code == 200
    assert renamed.json()["ok"] is True
    assert renamed.json()["data"]["name"] == "Renamed table"
    assert renamed.json()["data"]["folder_id"] == child_id

    # Move full folder subtree to root.
    moved = await client.patch(
        f"/api/v1/tables/folders/{child_id}",
        json={"parent_id": None},
        headers=_headers(token),
    )
    assert moved.status_code == 200
    assert moved.json()["ok"] is True
    assert moved.json()["data"]["parent_id"] is None

    # Table should still remain linked to moved folder.
    got_table = await client.get(f"/api/v1/tables/{table_id}", headers=_headers(token))
    assert got_table.status_code == 200
    assert got_table.json()["ok"] is True
    assert got_table.json()["data"]["folder_id"] == child_id


@pytest.mark.asyncio
async def test_move_folder_to_descendant_is_rejected(client: AsyncClient):
    token = await _register_owner(client)

    root = await client.post("/api/v1/tables/folders/", json={"name": "Root"}, headers=_headers(token))
    assert root.status_code == 200 and root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "Child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200 and child.json()["ok"] is True
    child_id = child.json()["data"]["id"]

    # Cannot move root under its descendant.
    invalid_move = await client.patch(
        f"/api/v1/tables/folders/{root_id}",
        json={"parent_id": child_id},
        headers=_headers(token),
    )
    assert invalid_move.status_code == 200
    assert invalid_move.json()["ok"] is False
    assert invalid_move.json()["error"]["code"] == "INVALID_PARENT"


@pytest.mark.asyncio
async def test_import_csv_respects_record_limit(client: AsyncClient):
    token = await _register_owner(client)

    async with UnitOfWork() as uow:
        free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one_or_none()
        if free_plan is None:
            from src.modules.billing.seed import upsert_default_plans

            await upsert_default_plans(uow.session)
            free_plan = (await uow.session.execute(select(Plan).where(Plan.name == "free"))).scalar_one()
        free_plan.max_tables = 5
        free_plan.max_records = 2
        await uow.commit()

    t = await client.post("/api/v1/tables/", json={"name": "Import limit"}, headers=_headers(token))
    assert t.status_code == 200 and t.json()["ok"] is True
    table_id = t.json()["data"]["id"]

    # Already 1 record.
    created = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {"a": "one"}}, headers=_headers(token))
    assert created.status_code == 200 and created.json()["ok"] is True

    csv_content = "Название\nv2\nv3\n"
    imp = await client.post(
        f"/api/v1/tables/{table_id}/import/csv",
        files={"file": ("data.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=_headers(token),
    )
    assert imp.status_code == 200
    assert imp.json()["ok"] is False
    assert imp.json()["error"]["code"] == "RECORD_LIMIT_REACHED"
