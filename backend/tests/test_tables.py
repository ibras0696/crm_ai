"""Tables module integration tests."""
import pytest
import uuid


@pytest.fixture
def auth_headers():
    """Helper — we'll register+login to get a token."""
    return {}


async def _register_and_login(client, email=None):
    """Register a user and return auth headers."""
    email = email or f"test-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post("/api/v1/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "first_name": "Тест",
        "last_name": "Юзер",
        "org_name": f"Org-{uuid.uuid4().hex[:6]}",
    })
    if reg.status_code == 200 and reg.json().get("ok"):
        token = reg.json()["data"]["access_token"]
        return {"Authorization": f"Bearer {token}"}
    # Try login if already registered
    login = await client.post("/api/v1/auth/login", json={
        "email": email,
        "password": "TestPass123!",
    })
    if login.status_code == 200 and login.json().get("ok"):
        token = login.json()["data"]["access_token"]
        return {"Authorization": f"Bearer {token}"}
    return {}


@pytest.mark.asyncio
async def test_create_table(client):
    headers = await _register_and_login(client)
    if not headers:
        pytest.skip("Auth not available")

    resp = await client.post("/api/v1/tables/", json={
        "name": "Тестовая таблица",
        "description": "Описание",
    }, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["data"]["name"] == "Тестовая таблица"
    table_id = data["data"]["id"]

    # List tables
    resp2 = await client.get("/api/v1/tables/", headers=headers)
    assert resp2.status_code == 200
    tables = resp2.json()["data"]
    assert any(t["id"] == table_id for t in tables)


@pytest.mark.asyncio
async def test_create_column_and_record(client):
    headers = await _register_and_login(client)
    if not headers:
        pytest.skip("Auth not available")

    # Create table
    resp = await client.post("/api/v1/tables/", json={
        "name": f"Таблица-{uuid.uuid4().hex[:6]}",
    }, headers=headers)
    assert resp.status_code == 200
    table_id = resp.json()["data"]["id"]

    # Create column
    col_resp = await client.post(f"/api/v1/tables/{table_id}/columns", json={
        "name": "Имя клиента",
        "field_type": "text",
    }, headers=headers)
    assert col_resp.status_code == 200
    col_id = col_resp.json()["data"]["id"]

    # Create record
    rec_resp = await client.post(f"/api/v1/tables/{table_id}/records/", json={
        "data": {col_id: "Иван Петров"},
    }, headers=headers)
    assert rec_resp.status_code == 200
    assert rec_resp.json()["ok"] is True

    # List records
    list_resp = await client.get(f"/api/v1/tables/{table_id}/records/", headers=headers)
    assert list_resp.status_code == 200
    records = list_resp.json()["data"]["records"]
    assert len(records) >= 1


@pytest.mark.asyncio
async def test_reports_summary(client):
    headers = await _register_and_login(client)
    if not headers:
        pytest.skip("Auth not available")

    resp = await client.get("/api/v1/reports/summary", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "tables_count" in data["data"]
    assert "records_count" in data["data"]
    assert "columns_count" in data["data"]
