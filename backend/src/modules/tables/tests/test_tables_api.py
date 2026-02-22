import uuid

import pytest
from httpx import AsyncClient


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
        json={"data": {col_id: "Ivan Updated"}},
        headers=_headers(token),
    )
    assert upd.status_code == 200

    dele = await client.delete(f"/api/v1/tables/{table_id}/records/{rec_id}", headers=_headers(token))
    assert dele.status_code == 200


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
async def test_reports_summary(client: AsyncClient):
    token = await _register_owner(client)
    resp = await client.get("/api/v1/reports/summary", headers=_headers(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "tables_count" in data["data"]
    assert "records_count" in data["data"]
    assert "columns_count" in data["data"]
