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
            "accepted_privacy_policy": True,
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
    d = await client.post(
        "/api/v1/reports/dashboards",
        json={"name": "My dashboard", "description": "Desc"},
        headers=_headers(token),
    )
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

    du = await client.patch(
        f"/api/v1/reports/dashboards/{dash_id}",
        json={"description": "New"},
        headers=_headers(token),
    )
    assert du.status_code == 200

    dd = await client.delete(f"/api/v1/reports/dashboards/{dash_id}", headers=_headers(token))
    assert dd.status_code == 200


@pytest.mark.asyncio
async def test_reports_not_found_and_validation(client: AsyncClient):
    token = await _register_owner(client)

    # Invalid dashboard name (blank after trim) must be rejected.
    bad_dashboard = await client.post(
        "/api/v1/reports/dashboards",
        json={"name": "   ", "description": "bad"},
        headers=_headers(token),
    )
    assert bad_dashboard.status_code == 422

    # Missing dashboard for widget create should return domain NOT_FOUND response.
    missing_dash_id = str(uuid.uuid4())
    missing_widget = await client.post(
        f"/api/v1/reports/dashboards/{missing_dash_id}/widgets",
        json={"title": "W", "widget_type": "metric", "config": {"aggregation": "count"}},
        headers=_headers(token),
    )
    assert missing_widget.status_code == 200
    assert missing_widget.json()["ok"] is False
    assert missing_widget.json()["error"]["code"] == "NOT_FOUND"

    # Invalid widget type / config validation.
    d = await client.post("/api/v1/reports/dashboards", json={"name": "V"}, headers=_headers(token))
    assert d.status_code == 200 and d.json()["ok"] is True
    dash_id = d.json()["data"]["id"]

    bad_widget_type = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/widgets",
        json={"title": "W", "widget_type": "invalid_widget"},
        headers=_headers(token),
    )
    assert bad_widget_type.status_code == 422

    bad_aggregation = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/widgets",
        json={
            "title": "W2",
            "widget_type": "metric",
            "config": {"aggregation": "median"},
        },
        headers=_headers(token),
    )
    assert bad_aggregation.status_code == 422

    bad_limit = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/widgets",
        json={
            "title": "W3",
            "widget_type": "table",
            "config": {"limit": 999},
        },
        headers=_headers(token),
    )
    assert bad_limit.status_code == 422

    # table analytics for unknown table id -> NOT_FOUND payload.
    unknown_table = await client.post(
        "/api/v1/reports/table-analytics",
        json={"table_id": str(uuid.uuid4()), "column_ids": []},
        headers=_headers(token),
    )
    assert unknown_table.status_code == 200
    assert unknown_table.json()["ok"] is False
    assert unknown_table.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_reports_employee_read_only_access(client: AsyncClient):
    owner_token = await _register_owner(client)
    invite_email = f"emp-{uuid.uuid4().hex[:8]}@example.com"

    inv = await client.post(
        "/api/v1/orgs/invites",
        json={"email": invite_email, "role": "employee"},
        headers=_headers(owner_token),
    )
    assert inv.status_code == 201
    invite_token = inv.json()["data"]["token"]

    acc = await client.post(
        "/api/v1/orgs/invites/accept",
        json={
            "token": invite_token,
            "password": "StrongPass123!",
            "first_name": "Emp",
            "last_name": "User",
        },
    )
    assert acc.status_code == 200
    employee_token = acc.json()["data"]["access_token"]

    # Owner creates dashboard.
    d = await client.post(
        "/api/v1/reports/dashboards",
        json={"name": "Owner dashboard", "description": "for read"},
        headers=_headers(owner_token),
    )
    assert d.status_code == 200 and d.json()["ok"] is True
    dash_id = d.json()["data"]["id"]

    # Employee can read dashboards list and dashboard data.
    list_resp = await client.get("/api/v1/reports/dashboards", headers=_headers(employee_token))
    assert list_resp.status_code == 200
    assert list_resp.json()["ok"] is True
    assert any(item["id"] == dash_id for item in list_resp.json()["data"])

    data_resp = await client.get(f"/api/v1/reports/dashboards/{dash_id}/data", headers=_headers(employee_token))
    assert data_resp.status_code == 200
    assert data_resp.json()["ok"] is True

    # Employee cannot create dashboards.
    create_forbidden = await client.post(
        "/api/v1/reports/dashboards",
        json={"name": "Forbidden"},
        headers=_headers(employee_token),
    )
    assert create_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_reports_schema_and_query_preview(client: AsyncClient):
    token = await _register_owner(client)

    t = await client.post("/api/v1/tables/", json={"name": "Sales"}, headers=_headers(token))
    assert t.status_code == 200
    table_id = t.json()["data"]["id"]

    amount = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    status = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "select", "config": {"options": ["new", "done"]}},
        headers=_headers(token),
    )
    created = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Created", "field_type": "date"},
        headers=_headers(token),
    )
    active = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Active", "field_type": "boolean"},
        headers=_headers(token),
    )
    assert amount.status_code == status.status_code == created.status_code == active.status_code == 200
    amount_col_id = amount.json()["data"]["id"]
    status_col_id = status.json()["data"]["id"]
    created_col_id = created.json()["data"]["id"]
    active_col_id = active.json()["data"]["id"]

    for payload in (
        {amount_col_id: 100, status_col_id: "new", created_col_id: "2026-03-01", active_col_id: True},
        {amount_col_id: 150, status_col_id: "done", created_col_id: "2026-03-03", active_col_id: False},
        {amount_col_id: 200, status_col_id: "done", created_col_id: "2026-03-05", active_col_id: True},
    ):
        resp = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": payload}, headers=_headers(token))
        assert resp.status_code == 200

    schema = await client.get(f"/api/v1/reports/tables/{table_id}/schema", headers=_headers(token))
    assert schema.status_code == 200
    assert schema.json()["ok"] is True
    assert schema.json()["data"]["default_metric_column_id"] == amount_col_id
    assert schema.json()["data"]["default_time_column_id"] == created_col_id

    preview = await client.post(
        "/api/v1/reports/query-preview",
        json={
            "table_id": table_id,
            "widget_type": "bar",
            "metrics": [{"key": "sum_amount", "aggregation": "sum", "column_id": amount_col_id, "label": "Сумма"}],
            "group_by_column_id": status_col_id,
            "filters": [{"column_id": active_col_id, "op": "eq", "value": True}],
            "sort": {"by": "metric", "metric_key": "sum_amount", "direction": "desc"},
            "limit": 10,
        },
        headers=_headers(token),
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["ok"] is True
    points = body["data"]["data"]["points"]
    assert points[0]["x"] == "done"
    assert points[0]["y"] == 200
    assert points[1]["x"] == "new"
    assert points[1]["y"] == 100


@pytest.mark.asyncio
async def test_reports_dashboard_preview_applies_global_filters(client: AsyncClient):
    token = await _register_owner(client)

    table = await client.post("/api/v1/tables/", json={"name": "Orders"}, headers=_headers(token))
    assert table.status_code == 200
    table_id = table.json()["data"]["id"]

    amount = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Amount", "field_type": "number"},
        headers=_headers(token),
    )
    status = await client.post(
        f"/api/v1/tables/{table_id}/columns",
        json={"name": "Status", "field_type": "select", "config": {"options": ["new", "done"]}},
        headers=_headers(token),
    )
    assert amount.status_code == status.status_code == 200
    amount_col_id = amount.json()["data"]["id"]
    status_col_id = status.json()["data"]["id"]

    for payload in (
        {amount_col_id: 10, status_col_id: "new"},
        {amount_col_id: 20, status_col_id: "done"},
        {amount_col_id: 30, status_col_id: "done"},
    ):
        resp = await client.post(f"/api/v1/tables/{table_id}/records/", json={"data": payload}, headers=_headers(token))
        assert resp.status_code == 200

    dashboard = await client.post(
        "/api/v1/reports/dashboards",
        json={"name": "Orders dashboard"},
        headers=_headers(token),
    )
    assert dashboard.status_code == 200
    dash_id = dashboard.json()["data"]["id"]

    widget = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/widgets",
        json={
            "title": "Status totals",
            "widget_type": "bar",
            "table_id": table_id,
            "config": {
                "aggregation": "sum",
                "value_column_id": amount_col_id,
                "group_by_column_id": status_col_id,
                "metrics": [{"key": "sum_amount", "aggregation": "sum", "column_id": amount_col_id, "label": "Сумма"}],
            },
            "position": 0,
        },
        headers=_headers(token),
    )
    assert widget.status_code == 200

    preview = await client.post(
        f"/api/v1/reports/dashboards/{dash_id}/preview",
        json={"table_id": table_id, "filters": [{"column_id": status_col_id, "op": "eq", "value": "done"}]},
        headers=_headers(token),
    )
    assert preview.status_code == 200
    payload = preview.json()["data"]["items"][0]["data"]["points"]
    assert payload == [{"x": "done", "y": 50}]
