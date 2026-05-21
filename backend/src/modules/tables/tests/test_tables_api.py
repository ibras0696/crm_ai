import json
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

    fu = await client.patch(
        f"/api/v1/tables/folders/{folder_id}", json={"name": "Sales updated"}, headers=_headers(token)
    )
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

    r1 = await client.post(
        f"/api/v1/tables/{table_id}/records/", json={"data": {col_id: "New"}}, headers=_headers(token)
    )
    r2 = await client.post(
        f"/api/v1/tables/{table_id}/records/", json={"data": {col_id: "Won"}}, headers=_headers(token)
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
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
    assert r1.status_code == 200
    assert r1.json()["ok"] is True
    assert r2.status_code == 200
    assert r2.json()["ok"] is True

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
    assert root.status_code == 200
    assert root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "Child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200
    assert child.json()["ok"] is True
    child_id = child.json()["data"]["id"]

    table = await client.post(
        "/api/v1/tables/",
        json={"name": "Initial table", "folder_id": child_id},
        headers=_headers(token),
    )
    assert table.status_code == 200
    assert table.json()["ok"] is True
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
    assert root.status_code == 200
    assert root.json()["ok"] is True
    root_id = root.json()["data"]["id"]

    child = await client.post(
        "/api/v1/tables/folders/",
        json={"name": "Child", "parent_id": root_id},
        headers=_headers(token),
    )
    assert child.status_code == 200
    assert child.json()["ok"] is True
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
    assert t.status_code == 200
    assert t.json()["ok"] is True
    table_id = t.json()["data"]["id"]

    # Already 1 record.
    created = await client.post(
        f"/api/v1/tables/{table_id}/records/", json={"data": {"a": "one"}}, headers=_headers(token)
    )
    assert created.status_code == 200
    assert created.json()["ok"] is True

    csv_content = "Название\nv2\nv3\n"
    imp = await client.post(
        f"/api/v1/tables/{table_id}/import/csv",
        files={"file": ("data.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=_headers(token),
    )
    assert imp.status_code == 200
    assert imp.json()["ok"] is False
    assert imp.json()["error"]["code"] == "RECORD_LIMIT_REACHED"


@pytest.mark.asyncio
async def test_views_default_and_update(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Views table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    v1 = await client.post(
        f"/api/v1/tables/{table_id}/views/",
        json={
            "name": "Default view",
            "view_type": "grid",
            "is_default": True,
            "filters": [{"col_id": "x", "op": "contains", "value": "q"}],
            "sorts": [{"col_id": "x", "dir": "asc"}],
        },
        headers=_headers(token),
    )
    assert v1.status_code == 200
    assert v1.json()["data"]["is_default"] is True
    view1_id = v1.json()["data"]["id"]

    v2 = await client.post(
        f"/api/v1/tables/{table_id}/views/",
        json={"name": "Second", "view_type": "grid"},
        headers=_headers(token),
    )
    assert v2.status_code == 200
    view2_id = v2.json()["data"]["id"]

    mark_default = await client.patch(
        f"/api/v1/tables/{table_id}/views/{view2_id}",
        json={"is_default": True},
        headers=_headers(token),
    )
    assert mark_default.status_code == 200
    assert mark_default.json()["data"]["is_default"] is True

    views = await client.get(f"/api/v1/tables/{table_id}/views/", headers=_headers(token))
    assert views.status_code == 200
    rows = views.json()["data"]
    defaults = [x["id"] for x in rows if x["is_default"]]
    assert defaults == [view2_id]
    assert any(x["id"] == view1_id for x in rows)


@pytest.mark.asyncio
async def test_bulk_update_and_bulk_delete_records(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Bulk table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    c = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "text"},
        headers=_headers(token),
    )
    assert c.status_code == 200
    col_id = c.json()["data"]["id"]

    ids: list[str] = []
    for value in ["new", "new", "old"]:
        rec = await client.post(
            f"/api/v1/tables/{table_id}/records/",
            json={"data": {col_id: value}},
            headers=_headers(token),
        )
        assert rec.status_code == 200
        ids.append(rec.json()["data"]["id"])

    upd = await client.post(
        f"/api/v1/tables/{table_id}/records/actions/bulk-update",
        json={"record_ids": ids[:2], "data": {col_id: "done"}},
        headers=_headers(token),
    )
    assert upd.status_code == 200
    assert upd.json()["data"]["updated"] == 2

    listing = await client.get(f"/api/v1/tables/{table_id}/records/?limit=50&offset=0", headers=_headers(token))
    assert listing.status_code == 200
    rows = listing.json()["data"]["records"]
    changed = [r for r in rows if r["id"] in ids[:2]]
    assert all(r["data"][col_id] == "done" for r in changed)

    deleted = await client.post(
        f"/api/v1/tables/{table_id}/records/actions/bulk-delete",
        json={"record_ids": ids[:2]},
        headers=_headers(token),
    )
    assert deleted.status_code == 200
    assert deleted.json()["data"]["deleted"] == 2

    listing2 = await client.get(f"/api/v1/tables/{table_id}/records/?limit=50&offset=0", headers=_headers(token))
    assert listing2.status_code == 200
    assert listing2.json()["data"]["total"] == 1


@pytest.mark.asyncio
async def test_filter_operators_and_multi_sort(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Filter table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    amount_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    status_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "text"},
        headers=_headers(token),
    )
    assert amount_col.status_code == 200
    assert status_col.status_code == 200
    amount_id = amount_col.json()["data"]["id"]
    status_id = status_col.json()["data"]["id"]

    rows = [
        {amount_id: "10", status_id: "new"},
        {amount_id: "25", status_id: "done"},
        {amount_id: "15", status_id: ""},
    ]
    for payload in rows:
        rec = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": payload}, headers=_headers(token))
        assert rec.status_code == 200

    gt_resp = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={"filters": [{"col_id": amount_id, "op": "gt", "value": 12}]},
        headers=_headers(token),
    )
    assert gt_resp.status_code == 200
    assert gt_resp.json()["data"]["total"] == 2

    empty_resp = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={"filters": [{"col_id": status_id, "op": "is_empty"}]},
        headers=_headers(token),
    )
    assert empty_resp.status_code == 200
    assert empty_resp.json()["data"]["total"] == 1

    in_resp = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={"filters": [{"col_id": status_id, "op": "in", "value": ["new", "done"]}]},
        headers=_headers(token),
    )
    assert in_resp.status_code == 200
    assert in_resp.json()["data"]["total"] == 2

    sorted_resp = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={
            "sorts": [
                {"col_id": status_id, "dir": "asc"},
                {"col_id": amount_id, "dir": "desc"},
            ]
        },
        headers=_headers(token),
    )
    assert sorted_resp.status_code == 200
    rows_sorted = sorted_resp.json()["data"]["records"]
    assert len(rows_sorted) == 3


@pytest.mark.asyncio
async def test_import_csv_replace_mode(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Import replace table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    # Primary "Название" column already exists by default.
    await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {}},
        headers=_headers(token),
    )
    await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {}},
        headers=_headers(token),
    )

    csv_content = "Название\nAlice\nBob\n"
    imp = await client.post(
        f"/api/v1/tables/{table_id}/import/csv?mode=replace",
        files={"file": ("replace.csv", csv_content.encode("utf-8"), "text/csv")},
        headers=_headers(token),
    )
    assert imp.status_code == 200
    assert imp.json()["ok"] is True
    assert imp.json()["data"]["mode"] == "replace"
    assert imp.json()["data"]["deleted_before"] >= 2
    assert imp.json()["data"]["records_created"] == 2


@pytest.mark.asyncio
async def test_formula_preview_and_relation_config_validation(client: AsyncClient):
    token = await _register_owner(client)

    main_table = await client.post("/api/v1/tables/", json={"name": "Deals"}, headers=_headers(token))
    assert main_table.status_code == 200
    main_table_id = main_table.json()["data"]["id"]
    primary_col_id = main_table.json()["data"]["columns"][0]["id"]

    related_table = await client.post("/api/v1/tables/", json={"name": "Companies"}, headers=_headers(token))
    assert related_table.status_code == 200
    related_table_id = related_table.json()["data"]["id"]

    relation = await client.post(
        f"/api/v1/tables/{main_table_id}/columns",
        json={
            "name": "Company",
            "field_type": "relation",
            "config": {"related_table_id": related_table_id, "multiple": False},
        },
        headers=_headers(token),
    )
    assert relation.status_code == 200
    assert relation.json()["ok"] is True
    assert relation.json()["data"]["field_type"] == "relation"

    invalid_relation = await client.post(
        f"/api/v1/tables/{main_table_id}/columns",
        json={"name": "Bad relation", "field_type": "relation", "config": {}},
        headers=_headers(token),
    )
    assert invalid_relation.status_code == 200
    assert invalid_relation.json()["ok"] is False
    assert invalid_relation.json()["error"]["code"] == "INVALID_COLUMN_CONFIG"

    preview = await client.post(
        f"/api/v1/tables/{main_table_id}/formula/preview",
        json={"expression": f'CONCAT("Deal: ", {{{primary_col_id}}})', "sample_row": {primary_col_id: "Alpha"}},
        headers=_headers(token),
    )
    assert preview.status_code == 200
    assert preview.json()["ok"] is True
    assert preview.json()["data"]["referenced_column_ids"] == [primary_col_id]
    assert preview.json()["data"]["value_preview"] == "Deal: Alpha"
    assert preview.json()["data"]["is_valid"] is True
    assert preview.json()["data"]["error"] is None

    bad_preview = await client.post(
        f"/api/v1/tables/{main_table_id}/formula/preview",
        json={"expression": "IF(", "sample_row": {}},
        headers=_headers(token),
    )
    assert bad_preview.status_code == 200
    assert bad_preview.json()["ok"] is True
    assert bad_preview.json()["data"]["is_valid"] is False
    assert isinstance(bad_preview.json()["data"]["error"], str)


@pytest.mark.asyncio
async def test_formula_columns_are_computed_in_list_and_filter(client: AsyncClient):
    token = await _register_owner(client)

    table_resp = await client.post("/api/v1/tables/", json={"name": "Formula table"}, headers=_headers(token))
    assert table_resp.status_code == 200
    table_id = table_resp.json()["data"]["id"]
    primary_col_id = table_resp.json()["data"]["columns"][0]["id"]

    amount_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    assert amount_col.status_code == 200
    amount_col_id = amount_col.json()["data"]["id"]

    start_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Start date", "field_type": "date"},
        headers=_headers(token),
    )
    assert start_col.status_code == 200
    start_col_id = start_col.json()["data"]["id"]

    end_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "End date", "field_type": "date"},
        headers=_headers(token),
    )
    assert end_col.status_code == 200
    end_col_id = end_col.json()["data"]["id"]

    score_formula = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={
            "name": "Deal label",
            "field_type": "formula",
            "config": {"expression": f'CONCAT({{{primary_col_id}}}, ":", ROUND({{{amount_col_id}}}, 0))'},
        },
        headers=_headers(token),
    )
    assert score_formula.status_code == 200
    score_formula_id = score_formula.json()["data"]["id"]

    status_formula = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={
            "name": "Status formula",
            "field_type": "formula",
            "config": {"expression": f'IF(GT({{{amount_col_id}}}, 100), "High", "Low")'},
        },
        headers=_headers(token),
    )
    assert status_formula.status_code == 200
    status_formula_id = status_formula.json()["data"]["id"]

    duration_formula = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={
            "name": "Duration days",
            "field_type": "formula",
            "config": {"expression": f"DATE_DIFF({{{start_col_id}}}, {{{end_col_id}}}, 'days')"},
        },
        headers=_headers(token),
    )
    assert duration_formula.status_code == 200
    duration_formula_id = duration_formula.json()["data"]["id"]

    record_resp = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={
            "data": {
                primary_col_id: "Deal A",
                amount_col_id: 150.4,
                start_col_id: "2026-01-01",
                end_col_id: "2026-01-06",
            }
        },
        headers=_headers(token),
    )
    assert record_resp.status_code == 200
    rec_id = record_resp.json()["data"]["id"]
    updated_at = record_resp.json()["data"]["updated_at"]
    row = record_resp.json()["data"]["data"]
    assert row[score_formula_id] == "Deal A:150.0"
    assert row[status_formula_id] == "High"
    assert float(row[duration_formula_id]) == 5.0

    tamper_formula = await client.patch(
        f"/api/v1/tables/{table_id}/records/{rec_id}",
        json={
            "data": {
                amount_col_id: 10,
                status_formula_id: "manual override",
            },
            "expected_updated_at": updated_at,
        },
        headers=_headers(token),
    )
    assert tamper_formula.status_code == 200
    tampered_row = tamper_formula.json()["data"]["data"]
    assert tampered_row[status_formula_id] == "Low"
    assert tampered_row[status_formula_id] != "manual override"

    filtered = await client.post(
        f"/api/v1/tables/{table_id}/filter?limit=50&offset=0",
        json={"filters": []},
        headers=_headers(token),
    )
    assert filtered.status_code == 200
    assert filtered.json()["ok"] is True
    row_filtered = filtered.json()["data"]["records"][0]["data"]
    assert row_filtered[score_formula_id] == "Deal A:10.0"
    assert row_filtered[status_formula_id] == "Low"


@pytest.mark.asyncio
async def test_record_history_and_rollback_last(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "History table"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "text"},
        headers=_headers(token),
    )
    assert col.status_code == 200
    col_id = col.json()["data"]["id"]

    created = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {col_id: "new"}},
        headers=_headers(token),
    )
    assert created.status_code == 200
    rec_id = created.json()["data"]["id"]
    updated_at = created.json()["data"]["updated_at"]

    updated = await client.patch(
        f"/api/v1/tables/{table_id}/records/{rec_id}",
        json={"data": {col_id: "won"}, "expected_updated_at": updated_at},
        headers=_headers(token),
    )
    assert updated.status_code == 200

    history = await client.get(f"/api/v1/tables/{table_id}/records/{rec_id}/history", headers=_headers(token))
    assert history.status_code == 200
    assert history.json()["ok"] is True
    assert history.json()["data"]["total"] >= 2
    assert any(col_id in (item.get("changed_columns") or []) for item in history.json()["data"]["items"])

    rollback = await client.post(
        f"/api/v1/tables/{table_id}/records/{rec_id}/history/rollback-last",
        headers=_headers(token),
    )
    assert rollback.status_code == 200
    assert rollback.json()["ok"] is True
    assert rollback.json()["data"]["record"]["data"][col_id] == "new"


@pytest.mark.asyncio
async def test_csv_preview_and_commit_with_mapping(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "CSV wizard"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]
    primary_col_id = t.json()["data"]["columns"][0]["id"]

    amount_col = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    assert amount_col.status_code == 200
    amount_col_id = amount_col.json()["data"]["id"]

    csv_content = "Client,Sum\nAlice,10\nBob,bad\nCharlie,15\n"
    mapping_payload = {"Client": primary_col_id, "Sum": amount_col_id}

    preview = await client.post(
        f"/api/v1/tables/{table_id}/import/csv/preview?mode=append",
        files={
            "file": ("data.csv", csv_content.encode("utf-8"), "text/csv"),
            "mapping_json": (None, json.dumps(mapping_payload)),
        },
        headers=_headers(token),
    )
    assert preview.status_code == 200
    assert preview.json()["ok"] is True
    assert preview.json()["data"]["valid_rows"] == 2
    assert preview.json()["data"]["invalid_rows"] == 1

    strict_commit = await client.post(
        f"/api/v1/tables/{table_id}/import/csv/commit?mode=append&strict=true",
        files={
            "file": ("data.csv", csv_content.encode("utf-8"), "text/csv"),
            "mapping_json": (None, json.dumps(mapping_payload)),
        },
        headers=_headers(token),
    )
    assert strict_commit.status_code == 200
    assert strict_commit.json()["ok"] is False
    assert strict_commit.json()["error"]["code"] == "CSV_VALIDATION_FAILED"

    commit = await client.post(
        f"/api/v1/tables/{table_id}/import/csv/commit?mode=append",
        files={
            "file": ("data.csv", csv_content.encode("utf-8"), "text/csv"),
            "mapping_json": (None, json.dumps(mapping_payload)),
        },
        headers=_headers(token),
    )
    assert commit.status_code == 200
    assert commit.json()["ok"] is True
    assert commit.json()["data"]["records_created"] == 2
    assert commit.json()["data"]["records_skipped"] == 1

    records_after = await client.get(f"/api/v1/tables/{table_id}/records/?limit=50&offset=0", headers=_headers(token))
    assert records_after.status_code == 200
    assert records_after.json()["ok"] is True
    imported_record_id = records_after.json()["data"]["records"][0]["id"]

    history = await client.get(
        f"/api/v1/tables/{table_id}/records/{imported_record_id}/history?limit=20&offset=0",
        headers=_headers(token),
    )
    assert history.status_code == 200
    assert history.json()["ok"] is True
    assert any((item.get("source") or "") == "records.import_csv_commit" for item in history.json()["data"]["items"])


@pytest.mark.asyncio
async def test_relation_lookup_rollup_and_relation_options(client: AsyncClient):
    token = await _register_owner(client)

    companies = await client.post("/api/v1/tables/", json={"name": "Companies"}, headers=_headers(token))
    assert companies.status_code == 200
    companies_table_id = companies.json()["data"]["id"]
    companies_name_col_id = companies.json()["data"]["columns"][0]["id"]
    companies_revenue_col = await client.post(
        f"/api/v1/tables/{companies_table_id}/columns",
        json={"name": "Revenue", "field_type": "number"},
        headers=_headers(token),
    )
    assert companies_revenue_col.status_code == 200
    companies_revenue_col_id = companies_revenue_col.json()["data"]["id"]

    c1 = await client.post(
        f"/api/v1/tables/{companies_table_id}/records/",
        json={"data": {companies_name_col_id: "Acme", companies_revenue_col_id: 100}},
        headers=_headers(token),
    )
    c2 = await client.post(
        f"/api/v1/tables/{companies_table_id}/records/",
        json={"data": {companies_name_col_id: "Globex", companies_revenue_col_id: 200}},
        headers=_headers(token),
    )
    assert c1.status_code == 200
    assert c2.status_code == 200
    company1_id = c1.json()["data"]["id"]
    company2_id = c2.json()["data"]["id"]

    deals = await client.post("/api/v1/tables/", json={"name": "Deals"}, headers=_headers(token))
    assert deals.status_code == 200
    deals_table_id = deals.json()["data"]["id"]

    relation = await client.post(
        f"/api/v1/tables/{deals_table_id}/columns",
        json={
            "name": "Companies relation",
            "field_type": "relation",
            "config": {
                "related_table_id": companies_table_id,
                "multiple": True,
                "related_column_id": companies_name_col_id,
            },
        },
        headers=_headers(token),
    )
    assert relation.status_code == 200
    relation_col_id = relation.json()["data"]["id"]

    lookup = await client.post(
        f"/api/v1/tables/{deals_table_id}/columns",
        json={
            "name": "Company names",
            "field_type": "lookup",
            "config": {"relation_column_id": relation_col_id, "lookup_column_id": companies_name_col_id},
        },
        headers=_headers(token),
    )
    assert lookup.status_code == 200
    lookup_col_id = lookup.json()["data"]["id"]

    rollup = await client.post(
        f"/api/v1/tables/{deals_table_id}/columns",
        json={
            "name": "Revenue sum",
            "field_type": "rollup",
            "config": {
                "relation_column_id": relation_col_id,
                "lookup_column_id": companies_revenue_col_id,
                "aggregation": "sum",
            },
        },
        headers=_headers(token),
    )
    assert rollup.status_code == 200
    rollup_col_id = rollup.json()["data"]["id"]

    deal_record = await client.post(
        f"/api/v1/tables/{deals_table_id}/records/",
        json={"data": {relation_col_id: [company1_id, company2_id]}},
        headers=_headers(token),
    )
    assert deal_record.status_code == 200
    assert deal_record.json()["ok"] is True

    options = await client.get(
        f"/api/v1/tables/{deals_table_id}/columns/{relation_col_id}/relation-options?limit=10",
        headers=_headers(token),
    )
    assert options.status_code == 200
    assert options.json()["ok"] is True
    option_labels = [x["label"] for x in options.json()["data"]]
    assert "Acme" in option_labels
    assert "Globex" in option_labels

    filtered = await client.post(
        f"/api/v1/tables/{deals_table_id}/filter?limit=50&offset=0",
        json={"filters": []},
        headers=_headers(token),
    )
    assert filtered.status_code == 200
    assert filtered.json()["ok"] is True
    row = filtered.json()["data"]["records"][0]
    assert sorted(row["data"][lookup_col_id]) == ["Acme", "Globex"]
    assert float(row["data"][rollup_col_id]) == 300.0
