import uuid

import pytest
from httpx import AsyncClient

def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _login_sa(client: AsyncClient) -> str:
    r = await client.post("/api/v1/superadmin/login", json={"email": "admin@test.local", "password": "12345678"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True, body
    return body["data"]["access_token"]


async def _register_owner(client: AsyncClient, *, org_name: str) -> tuple[str, str]:
    email = f"tbl-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": org_name,
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]
    org = await client.get("/api/v1/orgs/current", headers=_h(token))
    assert org.status_code == 200
    org_id = org.json()["data"]["id"]
    return token, org_id


async def _create_table_with_data(client: AsyncClient, token: str, *, name: str) -> tuple[str, str]:
    t = await client.post("/api/v1/tables/", json={"name": name}, headers=_h(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    col = await client.post(f"/api/v1/tables/{table_id}/columns", json={"name": "Title", "field_type": "text"}, headers=_h(token))
    assert col.status_code == 200
    col_id = col.json()["data"]["id"]

    rec = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": {col_id: "Hello"}}, headers=_h(token))
    assert rec.status_code == 200
    rec_id = rec.json()["data"]["id"]
    return table_id, rec_id


@pytest.mark.asyncio
async def test_superadmin_tables_readonly_scoped_to_org(client: AsyncClient):
    sa = await _login_sa(client)

    tok1, org1 = await _register_owner(client, org_name="Org One")
    tok2, org2 = await _register_owner(client, org_name="Org Two")
    table1, _ = await _create_table_with_data(client, tok1, name="Table One")
    table2, _ = await _create_table_with_data(client, tok2, name="Table Two")

    # org1 tables list should include table1 and not table2
    r1 = await client.get(f"/api/v1/superadmin/orgs/{org1}/tables?limit=50&offset=0", headers=_h(sa))
    assert r1.status_code == 200
    items = r1.json()["data"]["items"]
    ids = {x["id"] for x in items}
    assert table1 in ids
    assert table2 not in ids

    # Detail wrong org must not work
    bad = await client.get(f"/api/v1/superadmin/orgs/{org1}/tables/{table2}", headers=_h(sa))
    assert bad.status_code == 200
    assert bad.json()["ok"] is False


@pytest.mark.asyncio
async def test_superadmin_table_records_and_export(client: AsyncClient):
    sa = await _login_sa(client)
    tok, org_id = await _register_owner(client, org_name="Org Export")
    table_id, _ = await _create_table_with_data(client, tok, name="Exportable")

    recs = await client.get(
        f"/api/v1/superadmin/orgs/{org_id}/tables/{table_id}/records?limit=10&offset=0",
        headers=_h(sa),
    )
    assert recs.status_code == 200
    page = recs.json()["data"]
    assert page["total"] >= 1
    assert len(page["items"]) >= 1

    csv = await client.get(f"/api/v1/superadmin/orgs/{org_id}/tables/{table_id}/export/csv", headers=_h(sa))
    assert csv.status_code == 200
    assert "text/csv" in csv.headers.get("content-type", "")

    xlsx = await client.get(f"/api/v1/superadmin/orgs/{org_id}/tables/{table_id}/export/xlsx", headers=_h(sa))
    assert xlsx.status_code == 200
    assert "application/vnd.openxmlformats" in xlsx.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_superadmin_tables_invalid_ids_are_safe_api_errors(client: AsyncClient):
    sa = await _login_sa(client)

    bad_list = await client.get("/api/v1/superadmin/orgs/not-a-uuid/tables", headers=_h(sa))
    assert bad_list.status_code == 200
    assert bad_list.json()["ok"] is False
    assert bad_list.json()["error"]["code"] == "INVALID_ID"

    bad_detail = await client.get(
        "/api/v1/superadmin/orgs/not-a-uuid/tables/not-a-uuid",
        headers=_h(sa),
    )
    assert bad_detail.status_code == 200
    assert bad_detail.json()["ok"] is False
    assert bad_detail.json()["error"]["code"] == "INVALID_ID"

    bad_records = await client.get(
        "/api/v1/superadmin/orgs/not-a-uuid/tables/not-a-uuid/records",
        headers=_h(sa),
    )
    assert bad_records.status_code == 200
    assert bad_records.json()["ok"] is False
    assert bad_records.json()["error"]["code"] == "INVALID_ID"

    bad_csv = await client.get(
        "/api/v1/superadmin/orgs/not-a-uuid/tables/not-a-uuid/export/csv",
        headers=_h(sa),
    )
    assert bad_csv.status_code == 200
    assert bad_csv.json()["ok"] is False
    assert bad_csv.json()["error"]["code"] == "INVALID_ID"

    bad_xlsx = await client.get(
        "/api/v1/superadmin/orgs/not-a-uuid/tables/not-a-uuid/export/xlsx",
        headers=_h(sa),
    )
    assert bad_xlsx.status_code == 200
    assert bad_xlsx.json()["ok"] is False
    assert bad_xlsx.json()["error"]["code"] == "INVALID_ID"


@pytest.mark.asyncio
async def test_superadmin_tables_limit_validation(client: AsyncClient):
    sa = await _login_sa(client)
    owner_token, org_id = await _register_owner(client, org_name="Org Limits")
    table_id, _ = await _create_table_with_data(client, owner_token, name="Tmp")
    # list limit out of allowed range -> FastAPI query validation
    too_large_list = await client.get(
        f"/api/v1/superadmin/orgs/{org_id}/tables?limit=1000&offset=0",
        headers=_h(sa),
    )
    assert too_large_list.status_code == 422

    # records limit out of allowed range -> FastAPI query validation
    too_large_records = await client.get(
        f"/api/v1/superadmin/orgs/{org_id}/tables/{table_id}/records?limit=10000&offset=0",
        headers=_h(sa),
    )
    assert too_large_records.status_code == 422
