import uuid

import pytest
from httpx import AsyncClient


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient) -> str:
    email = f"reports-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": f"Org-{uuid.uuid4().hex[:6]}",
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_reports_dashboard_crud_and_data(client: AsyncClient):
    token = await _register_owner(client)

    # Create a table with one column and one record.
    t = await client.post("/api/v1/tables/", json={"name": "Sales"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    c = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    assert c.status_code == 200
    amount_col_id = c.json()["data"]["id"]

    r = await client.post(
        f"/api/v1/tables/{table_id}/records/",
        json={"data": {amount_col_id: 100}},
        headers=_headers(token),
    )
    assert r.status_code == 200

    # Dashboard CRUD
    d = await client.post("/api/v1/reports/dashboards", json={"name": "My dashboard", "description": "Desc"}, headers=_headers(token))
    assert d.status_code == 200
    dash_id = d.json()["data"]["id"]

    w = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/widgets",
        json={
            "title": "Count",
            "widget_type": "metric",
            "table_id": table_id,
            "config": {"aggregation": "count"},
            "position": 0,
        },
        headers=_headers(token),
    )
    assert w.status_code == 200
    widget_id = w.json()["data"]["id"]

    data = await client.get(f"/api/v1/reports/dashboards/{dash_id}/data", headers=_headers(token))
    assert data.status_code == 200
    items = data.json()["data"]["items"]
    assert len(items) >= 1

    wu = await client.patch(
        f"/api/v1/reports/dashboards/{dash_id}/widgets/{widget_id}",
        json={"title": "Count updated"},
        headers=_headers(token),
    )
    assert wu.status_code == 200

    wd = await client.delete(f"/api/v1/reports/dashboards/{dash_id}/widgets/{widget_id}", headers=_headers(token))
    assert wd.status_code == 200

    du = await client.patch(f"/api/v1/reports/dashboards/{dash_id}", json={"description": "New"}, headers=_headers(token))
    assert du.status_code == 200

    dd = await client.delete(f"/api/v1/reports/dashboards/{dash_id}", headers=_headers(token))
    assert dd.status_code == 200

